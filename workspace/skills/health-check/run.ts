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

function firstMatch(re: RegExp, text: string): string | undefined {
  const m = text.match(re);
  return m ? m[1] : undefined;
}

async function run(): Promise<void> {
  const checks: Check[] = [];
  const errors: string[] = [];

  let env: ReturnType<typeof loadEnv> | undefined;
  try {
    env = loadEnv();
    checks.push({ name: "env", ok: true });
  } catch (e) {
    checks.push({ name: "env", ok: false, detail: String(e) });
    errors.push(`env:${String(e)}`);
  }

  try {
    const db = openDb();
    const m = db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
    if (m.n < 1) throw new Error("no migrations applied");
    checks.push({ name: "db", ok: true, detail: `migrations=${m.n}` });
  } catch (e) {
    checks.push({ name: "db", ok: false, detail: String(e) });
    errors.push(`db:${String(e)}`);
  }

  try {
    const cfgPath = process.env.OPENCLAW_CONFIG ?? resolve(process.cwd(), "config/openclaw.config.json5");
    const raw = readFileSync(cfgPath, "utf8");
    const dm = firstMatch(/dmPolicy\s*:\s*"([^"]+)"/, raw);
    const gp = firstMatch(/groupPolicy\s*:\s*"([^"]+)"/, raw);
    if (dm !== "allowlist") throw new Error(`dmPolicy=${dm}`);
    if (gp !== "allowlist") throw new Error(`groupPolicy=${gp}`);
    checks.push({ name: "allowlist_config", ok: true, detail: `dm=${dm} group=${gp}` });
  } catch (e) {
    checks.push({ name: "allowlist_config", ok: false, detail: String(e) });
    errors.push(`allowlist_config:${String(e)}`);
  }

  try {
    const used = tokensToday();
    const over = isOverBudget();
    checks.push({ name: "budget", ok: !over, detail: `tokens_today=${used} over=${over}` });
    if (over) errors.push("budget_exceeded");
  } catch (e) {
    checks.push({ name: "budget", ok: false, detail: String(e) });
    errors.push(`budget:${String(e)}`);
  }

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

  const ok = errors.length === 0;
  process.stdout.write(JSON.stringify({ ok, checks, errors }) + "\n");

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

run().catch((e) => {
  log.error({ err: String(e) }, "health_check_crashed");
  process.exit(2);
});
