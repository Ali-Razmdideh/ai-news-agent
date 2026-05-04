import { loadEnv } from "./env.js";
import { safeFetchJson } from "./http.js";
import { log } from "./log.js";

const ALLOW_EXTRA = ["api.telegram.org"];

type TgResponse<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string };

async function tgCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const env = loadEnv();
  if (env.DRY_RUN === 1) {
    log.info({ method, body }, "telegram_dry_run");
    return { dryRun: true } as unknown as T;
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await safeFetchJson<TgResponse<T>>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    allowExtra: ALLOW_EXTRA,
    timeoutMs: 10_000,
  });
  if (!res.ok) throw new Error(`telegram_${res.error_code}:${res.description}`);
  return res.result;
}

export async function sendMessage(opts: {
  chatId: string | number;
  text: string;
  parseMode?: "MarkdownV2" | "HTML";
  replyToMessageId?: number;
  disableWebPagePreview?: boolean;
}): Promise<{ message_id: number }> {
  return tgCall("sendMessage", {
    chat_id: opts.chatId,
    text: opts.text,
    parse_mode: opts.parseMode ?? "MarkdownV2",
    reply_to_message_id: opts.replyToMessageId,
    disable_web_page_preview: opts.disableWebPagePreview ?? false,
    allow_sending_without_reply: true,
  });
}

export async function getMe(): Promise<{ id: number; username: string }> {
  return tgCall("getMe", {});
}
