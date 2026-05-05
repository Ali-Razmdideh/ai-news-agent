/**
 * Skill: post-telegram
 *
 * The single outbound surface for everything the bot says. Three modes:
 *   • --kind item   --item-id N             → post a fully-prepared item
 *                                             (must have score + summary)
 *                                             to the broadcast channel.
 *   • --kind reply  --chat-id C --reply-to M
 *                   --text "<text>"         → reply in the discussion group.
 *   • --kind admin  --text "<text>"         → DM the admin user.
 *
 * Output (JSON, one line on stdout):  { itemId?, msg_id }
 *
 * Defense-in-depth allowlist: even if openclaw.config drifts, this skill
 * refuses any chat-id outside the configured channel, group, or admin.
 * The skill itself is `disable-model-invocation: true` so a prompt-injected
 * fetch can never trick the model into invoking it.
 */
import {
  openDb,
  sendMessage,
  formatItemMessage,
  escapeMdV2,
  loadEnv,
  log,
  runSkill,
  cliArg,
} from "@ai-news/core";

/**
 * Hard allowlist on every send. The set is built from env each call so
 * any test / dev rotation of channel ids takes effect without restart.
 */
function assertAllowedChat(chatId: string): void {
  const env = loadEnv();
  const allowed = new Set([env.TELEGRAM_CHANNEL_ID, env.TELEGRAM_DISCUSSION_GROUP_ID, env.ADMIN_TG_USER_ID]);
  if (!allowed.has(String(chatId))) throw new Error(`refused_chat_id:${chatId}`);
}

type ItemRow = {
  id: number;
  url: string;
  title: string;
  source: string;
  score: number;
  topic: string;
  tldr: string;
  bullets_json: string;
};

/**
 * Mode: post a curated item to the broadcast channel.
 *
 * The query is the idempotency contract — it returns no row if the item
 * is already posted (LEFT JOIN posts) or missing a score/summary (INNER
 * JOIN). So a re-run on the same item is a safe no-op.
 */
async function postItem(itemId: number) {
  const db = openDb();
  const row = db
    .prepare(
      `SELECT i.id, i.url, i.title, i.source, sc.score, sc.topic, sm.tldr, sm.bullets_json
       FROM items i
       JOIN scores sc ON sc.item_id = i.id
       JOIN summaries sm ON sm.item_id = i.id
       LEFT JOIN posts p ON p.item_id = i.id
       WHERE i.id = ? AND p.item_id IS NULL`,
    )
    .get(itemId) as ItemRow | undefined;
  if (!row) {
    log.info({ itemId }, "post_skipped_already_posted_or_missing");
    return { itemId, msg_id: null };
  }

  const env = loadEnv();
  // Belt-and-suspenders: the channel id is sourced from env, but we still
  // funnel it through the allowlist — keeps the audit trail consistent
  // and catches misconfigured envs at send-time, not silently in Telegram.
  assertAllowedChat(env.TELEGRAM_CHANNEL_ID);

  // formatItemMessage handles the MarkdownV2 escaping + URL escaping.
  const text = formatItemMessage({
    title: row.title,
    source: row.source,
    topic: row.topic,
    score: row.score,
    tldr: row.tldr,
    bullets: JSON.parse(row.bullets_json) as string[],
    url: row.url,
  });

  const res = await sendMessage({ chatId: env.TELEGRAM_CHANNEL_ID, text, parseMode: "MarkdownV2" });

  // Record the post so the dedup query above sees it next time. We only
  // write on a real message_id — DRY_RUN responses don't have one, which
  // means dry-run posts won't pollute the dedup state.
  if (res?.message_id) {
    db.prepare(
      `INSERT OR IGNORE INTO posts (item_id, telegram_msg_id, chat_id, kind) VALUES (?, ?, ?, 'item')`,
    ).run(itemId, res.message_id, env.TELEGRAM_CHANNEL_ID);
  }
  return { itemId, msg_id: res?.message_id ?? null };
}

/**
 * Mode: reply in the linked discussion group. Used by the `qa` agent.
 * Free-form text → escapeMdV2 → cap at 3500 (Telegram's per-message
 * limit is 4096; we leave headroom for parse failures).
 */
async function postReply(chatId: string, replyTo: number, text: string) {
  assertAllowedChat(chatId);
  const res = await sendMessage({
    chatId,
    text: escapeMdV2(text).slice(0, 3500),
    parseMode: "MarkdownV2",
    replyToMessageId: replyTo,
  });
  return { msg_id: res?.message_id ?? null };
}

/**
 * Mode: admin DM. Used by health-check, the budget circuit-breaker, and
 * for cost reports. Same length cap as reply.
 */
async function postAdmin(text: string) {
  const env = loadEnv();
  assertAllowedChat(env.ADMIN_TG_USER_ID);
  const res = await sendMessage({
    chatId: env.ADMIN_TG_USER_ID,
    text: escapeMdV2(text).slice(0, 3500),
    parseMode: "MarkdownV2",
  });
  return { msg_id: res?.message_id ?? null };
}

runSkill("post-telegram", async () => {
  // Mode dispatch via --kind. Default is "item" because that's the cron
  // pipeline's hottest path.
  const kind = cliArg("kind") ?? "item";
  if (kind === "item") {
    const id = Number(cliArg("item-id"));
    if (!Number.isFinite(id)) throw new Error("missing --item-id");
    return postItem(id);
  }
  if (kind === "reply") {
    const chat = cliArg("chat-id");
    const m = Number(cliArg("reply-to"));
    const text = cliArg("text") ?? "";
    if (!chat || !Number.isFinite(m) || !text) throw new Error("missing reply args");
    return postReply(chat, m, text);
  }
  if (kind === "admin") {
    return postAdmin(cliArg("text") ?? "");
  }
  throw new Error(`unknown_kind:${kind}`);
});
