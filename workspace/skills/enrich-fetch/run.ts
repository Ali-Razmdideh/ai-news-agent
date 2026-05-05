import { openDb, safeFetchText, runSkill, cliArg } from "@ai-news/core";

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16_000);
}

runSkill("enrich-fetch", async () => {
  const itemId = Number(cliArg("item-id"));
  if (!Number.isFinite(itemId)) throw new Error("missing --item-id");
  const db = openDb();
  const row = db.prepare("SELECT id, url, raw_body FROM items WHERE id = ?").get(itemId) as
    | { id: number; url: string; raw_body: string | null }
    | undefined;
  if (!row) throw new Error(`item_not_found:${itemId}`);
  if (row.raw_body && row.raw_body.length > 200) {
    return { id: itemId, fetched: false, reason: "already_has_body" as const };
  }
  const text = htmlToText(await safeFetchText(row.url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 }));
  db.prepare("UPDATE items SET raw_body = ? WHERE id = ?").run(text, itemId);
  return { id: itemId, fetched: true, bytes: text.length };
});
