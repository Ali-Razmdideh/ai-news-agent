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
  assertAllowedChat(env.TELEGRAM_CHANNEL_ID);
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
  if (res?.message_id) {
    db.prepare(
      `INSERT OR IGNORE INTO posts (item_id, telegram_msg_id, chat_id, kind) VALUES (?, ?, ?, 'item')`,
    ).run(itemId, res.message_id, env.TELEGRAM_CHANNEL_ID);
  }
  return { itemId, msg_id: res?.message_id ?? null };
}

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
