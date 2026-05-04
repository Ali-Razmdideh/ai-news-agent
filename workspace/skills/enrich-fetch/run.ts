import { openDb, safeFetchText, log } from "@ai-news/core";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

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

async function main(): Promise<void> {
  const itemId = Number(arg("item-id"));
  if (!Number.isFinite(itemId)) throw new Error("missing --item-id");
  const db = openDb();
  const row = db.prepare("SELECT id, url, raw_body FROM items WHERE id = ?").get(itemId) as
    | { id: number; url: string; raw_body: string | null }
    | undefined;
  if (!row) throw new Error(`item_not_found:${itemId}`);
  if (row.raw_body && row.raw_body.length > 200) {
    process.stdout.write(JSON.stringify({ id: itemId, fetched: false, reason: "already_has_body" }) + "\n");
    return;
  }
  const html = await safeFetchText(row.url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
  const text = htmlToText(html);
  db.prepare("UPDATE items SET raw_body = ? WHERE id = ?").run(text, itemId);
  log.info({ id: itemId, bytes: text.length }, "enrich_fetch_done");
  process.stdout.write(JSON.stringify({ id: itemId, fetched: true, bytes: text.length }) + "\n");
}

main().catch((e) => {
  log.error({ err: String(e) }, "enrich_fetch_failed");
  process.exit(1);
});
