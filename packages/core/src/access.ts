import { loadEnv } from "./env.js";
import { log } from "./log.js";
import { openDb } from "./db.js";

export type Update = {
  chatId: string | number;
  userId: string | number;
  kind: "dm" | "group" | "channel";
  isMention?: boolean;
};

export type Decision = { allow: true } | { allow: false; reason: string };

/**
 * Second-layer allowlist. Re-validates EVERY inbound update before any agent
 * code runs, regardless of what openclaw.config.json5 says. If the gateway
 * config drifts, this stops the leak.
 */
export function checkInbound(u: Update): Decision {
  const env = loadEnv();
  const userId = String(u.userId);
  const chatId = String(u.chatId);
  const adminId = env.ADMIN_TG_USER_ID;
  const channelId = env.TELEGRAM_CHANNEL_ID;
  const groupId = env.TELEGRAM_DISCUSSION_GROUP_ID;

  if (u.kind === "dm") {
    if (userId !== adminId) return deny("dm_not_admin", { userId });
    return { allow: true };
  }

  if (u.kind === "channel") {
    return deny("channel_is_post_only", { chatId });
  }

  if (u.kind === "group") {
    if (chatId !== groupId) return deny("group_not_allowlisted", { chatId });
    if (!u.isMention) return deny("group_no_mention", { chatId, userId });
    if (!isTrustedReader(userId)) return deny("user_not_trusted", { userId });
    return { allow: true };
  }

  return deny("unknown_kind", { kind: u.kind });
}

export function isAdmin(userId: string | number): boolean {
  return String(userId) === loadEnv().ADMIN_TG_USER_ID;
}

export function isTrustedReader(userId: string | number): boolean {
  if (isAdmin(userId)) return true;
  const db = openDb();
  const row = db
    .prepare("SELECT 1 FROM trusted_readers WHERE user_id = ?")
    .get(String(userId));
  return !!row;
}

export function addTrustedReader(userId: string | number, by: string): void {
  openDb()
    .prepare(
      "INSERT OR IGNORE INTO trusted_readers (user_id, added_by, added_at) VALUES (?, ?, datetime('now'))",
    )
    .run(String(userId), by);
}

export function removeTrustedReader(userId: string | number): void {
  openDb().prepare("DELETE FROM trusted_readers WHERE user_id = ?").run(String(userId));
}

function deny(reason: string, ctx: Record<string, unknown>): Decision {
  log.warn({ reason, ...ctx }, "access_denied");
  bumpDenyMetric(reason);
  return { allow: false, reason };
}

function bumpDenyMetric(reason: string): void {
  try {
    openDb()
      .prepare(
        `INSERT INTO access_denies (reason, ts, count)
         VALUES (?, datetime('now'), 1)
         ON CONFLICT(reason, day) DO UPDATE SET count = count + 1`,
      )
      .run(reason);
  } catch {
    // best-effort metric; never throw out of access check
  }
}
