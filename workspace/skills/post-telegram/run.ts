import { openDb, sendMessage, formatItemMessage, escapeMdV2, loadEnv, log } from "@ai-news/core";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function assertAllowedChat(chatId: string): void {
  const env = loadEnv();
  const allowed = new Set([env.TELEGRAM_CHANNEL_ID, env.TELEGRAM_DISCUSSION_GROUP_ID, env.ADMIN_TG_USER_ID]);
  if (!allowed.has(String(chatId))) {
    throw new Error(`refused_chat_id:${chatId}`);
  }
}

async function postItem(itemId: number): Promise<void> {
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
    .get(itemId) as
    | { id: number; url: string; title: string; source: string; score: number; topic: string; tldr: string; bullets_json: string }
    | undefined;
  if (!row) {
    log.info({ itemId }, "post_skipped_already_posted_or_missing");
    return;
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
  const res = (await sendMessage({
    chatId: env.TELEGRAM_CHANNEL_ID,
    text,
    parseMode: "MarkdownV2",
    disableWebPagePreview: false,
  })) as { message_id?: number };
  if (res?.message_id) {
    db.prepare(
      `INSERT OR IGNORE INTO posts (item_id, telegram_msg_id, chat_id, kind) VALUES (?, ?, ?, 'item')`,
    ).run(itemId, res.message_id, env.TELEGRAM_CHANNEL_ID);
  }
  log.info({ itemId, msg: res?.message_id }, "post_item_done");
  process.stdout.write(JSON.stringify({ itemId, msg_id: res?.message_id ?? null }) + "\n");
}

async function postReply(chatId: string, replyTo: number, text: string): Promise<void> {
  assertAllowedChat(chatId);
  const res = (await sendMessage({
    chatId,
    text: escapeMdV2(text).slice(0, 3500),
    parseMode: "MarkdownV2",
    replyToMessageId: replyTo,
  })) as { message_id?: number };
  process.stdout.write(JSON.stringify({ msg_id: res?.message_id ?? null }) + "\n");
}

async function postAdmin(text: string): Promise<void> {
  const env = loadEnv();
  assertAllowedChat(env.ADMIN_TG_USER_ID);
  const res = (await sendMessage({
    chatId: env.ADMIN_TG_USER_ID,
    text: escapeMdV2(text).slice(0, 3500),
    parseMode: "MarkdownV2",
  })) as { message_id?: number };
  process.stdout.write(JSON.stringify({ msg_id: res?.message_id ?? null }) + "\n");
}

async function main(): Promise<void> {
  const kind = arg("kind") ?? "item";
  if (kind === "item") {
    const id = Number(arg("item-id"));
    if (!Number.isFinite(id)) throw new Error("missing --item-id");
    await postItem(id);
  } else if (kind === "reply") {
    const chat = arg("chat-id");
    const m = Number(arg("reply-to"));
    const text = arg("text") ?? "";
    if (!chat || !Number.isFinite(m) || !text) throw new Error("missing reply args");
    await postReply(chat, m, text);
  } else if (kind === "admin") {
    await postAdmin(arg("text") ?? "");
  } else {
    throw new Error(`unknown_kind:${kind}`);
  }
}

main().catch((e) => {
  log.error({ err: String(e) }, "post_telegram_failed");
  process.exit(1);
});
