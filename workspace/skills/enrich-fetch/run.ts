/**
 * Skill: enrich-fetch
 *
 * Given an item-id, fetches the item's URL, strips HTML to plain text, and
 * stores the result in `items.raw_body`. Used when a collector produces a
 * "thin" item — typically RSS feeds that ship only a title + link, or HN
 * stories pointing at a remote article.
 *
 * Output (JSON, one line on stdout):
 *   { id, fetched: true,  bytes }                 — body populated
 *   { id, fetched: false, reason }                — skipped (already had body)
 *
 * Network egress is gated by the SSRF allowlist in `packages/core/http.ts`.
 * No LLM calls; this skill is `disable-model-invocation: true` because it
 * triggers outbound fetches and we don't want a prompt-injected redirect
 * to be able to invoke it directly.
 */
import { openDb, safeFetchText, runSkill, cliArg } from "@ai-news/core";

/**
 * Minimal HTML-to-text. Drops <script>/<style> bodies, strips remaining
 * tags, decodes the few entities that show up in practice, collapses
 * whitespace, and caps at 16 KB. We deliberately avoid a real DOM parser:
 * we only need a coarse "what's the article say" signal for the LLM.
 */
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

  // Idempotency guard: if we already have a meaningful body, don't burn
  // another HTTPS request. The 200-char floor means we still re-fetch
  // when the collector wrote only a thin snippet.
  if (row.raw_body && row.raw_body.length > 200) {
    return { id: itemId, fetched: false, reason: "already_has_body" as const };
  }

  // Fetch + scrub + persist.
  const text = htmlToText(
    await safeFetchText(row.url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 }),
  );
  db.prepare("UPDATE items SET raw_body = ? WHERE id = ?").run(text, itemId);
  return { id: itemId, fetched: true, bytes: text.length };
});
