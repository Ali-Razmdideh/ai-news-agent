/**
 * Skill: health-check
 *
 * One-shot self-test. Verifies, in order:
 *   1. Env parses (zod-validated by loadEnv).
 *   2. SQLite opens, migrations applied.
 *   3. openclaw.config.json5 still has dmPolicy=allowlist and
 *      groupPolicy=(allowlist|disabled). This is the iron-rule guard:
 *      if config drifts to anything more permissive, refuse to start.
 *   4. Today's token usage is under DAILY_TOKEN_BUDGET.
 *   5. Telegram bot reachable (/getMe), unless DRY_RUN=1.
 *
 * Output (JSON, one line on stdout):  { ok, checks: [...], errors: [...] }
 *
 * On any failure, DMs the admin and exits 1 so the cron tick skips. On
 * unexpected crashes (e.g. `loadEnv` throwing before we can DM) exits 2.
 *
 * Bespoke main() rather than runSkill() because we need to keep going on
 * individual check failures and emit a structured report.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadEnv,
  openDb,
  log,
  tokensToday,
  isOverBudget,
  getMe,
  sendMessage,
  escapeMdV2,
} from "@ai-news/core";

type Check = { name: string; ok: boolean; detail?: string };

/** Pull the first capture group out of a regex match, or undefined. */
function firstMatch(re: RegExp, text: string): string | undefined {
  const m = text.match(re);
  return m ? m[1] : undefined;
}

async function run(): Promise<void> {
  const checks: Check[] = [];
  const errors: string[] = [];

  // ── 1. env ─────────────────────────────────────────────────────────────
  // We capture `env` for use further down (DRY_RUN, ADMIN_TG_USER_ID) but
  // tolerate parse failure so subsequent checks can still report.
  let env: ReturnType<typeof loadEnv> | undefined;
  try {
    env = loadEnv();
    checks.push({ name: "env", ok: true });
  } catch (e) {
    checks.push({ name: "env", ok: false, detail: String(e) });
    errors.push(`env:${String(e)}`);
  }

  // ── 2. db ──────────────────────────────────────────────────────────────
  // openDb runs migrations; if the count is zero something is very wrong.
  try {
    const db = openDb();
    const m = db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
    if (m.n < 1) throw new Error("no migrations applied");
    checks.push({ name: "db", ok: true, detail: `migrations=${m.n}` });
  } catch (e) {
    checks.push({ name: "db", ok: false, detail: String(e) });
    errors.push(`db:${String(e)}`);
  }

  // ── 3. allowlist config ────────────────────────────────────────────────
  // Iron rule: dmPolicy and groupPolicy must remain locked down. We do a
  // line-grep instead of parsing JSON5 because we want this to work even
  // if there's a parse error elsewhere in the file.
  try {
    const cfgPath = process.env.OPENCLAW_CONFIG ?? resolve(process.cwd(), "config/openclaw.config.json5");
    const raw = readFileSync(cfgPath, "utf8");
    const dm = firstMatch(/dmPolicy\s*:\s*"([^"]+)"/, raw);
    const gp = firstMatch(/groupPolicy\s*:\s*"([^"]+)"/, raw);
    if (dm !== "allowlist") throw new Error(`dmPolicy=${dm}`);
    // groupPolicy=disabled is acceptable (single-admin setup with no group);
    // anything else (e.g. "open") would be a regression and must fail.
    if (gp !== "allowlist" && gp !== "disabled") throw new Error(`groupPolicy=${gp}`);
    checks.push({ name: "allowlist_config", ok: true, detail: `dm=${dm} group=${gp}` });
  } catch (e) {
    checks.push({ name: "allowlist_config", ok: false, detail: String(e) });
    errors.push(`allowlist_config:${String(e)}`);
  }

  // ── 4. budget ──────────────────────────────────────────────────────────
  // Soft circuit-breaker: over-budget isn't fatal, but we report it so
  // the cron tick skips LLM-using stages today.
  try {
    const used = tokensToday();
    const over = isOverBudget();
    checks.push({ name: "budget", ok: !over, detail: `tokens_today=${used} over=${over}` });
    if (over) errors.push("budget_exceeded");
  } catch (e) {
    checks.push({ name: "budget", ok: false, detail: String(e) });
    errors.push(`budget:${String(e)}`);
  }

  // ── 5. telegram reachability ──────────────────────────────────────────
  // Skipped under DRY_RUN so dev runs don't fail when there's no real
  // bot token configured.
  try {
    if (env?.DRY_RUN === 1) {
      checks.push({ name: "telegram", ok: true, detail: "skipped (DRY_RUN)" });
    } else {
      const me = await getMe();
      checks.push({ name: "telegram", ok: true, detail: `bot=${me.username ?? me.id}` });
    }
  } catch (e) {
    checks.push({ name: "telegram", ok: false, detail: String(e) });
    errors.push(`telegram:${String(e)}`);
  }

  // ── Report ─────────────────────────────────────────────────────────────
  const ok = errors.length === 0;
  process.stdout.write(JSON.stringify({ ok, checks, errors }) + "\n");

  // Failure path: notify the admin (best-effort — we don't want a Telegram
  // outage to mask the *real* failure that brought us here).
  if (!ok && env && env.DRY_RUN !== 1) {
    try {
      const lines = errors.map((e) => `• ${e}`).join("\n");
      await sendMessage({
        chatId: env.ADMIN_TG_USER_ID,
        text: `*health\\-check failed*\n${escapeMdV2(lines)}`,
        parseMode: "MarkdownV2",
      });
    } catch (e) {
      log.error({ err: String(e) }, "admin_dm_failed");
    }
  }

  if (!ok) process.exit(1);
}

// Wrap in catch so unexpected crashes (e.g. fs.readFileSync throwing
// before the inner try) get a distinct exit code 2 rather than the
// soft-fail 1 used by reportable check failures.
run().catch((e) => {
  log.error({ err: String(e) }, "health_check_crashed");
  process.exit(2);
});
