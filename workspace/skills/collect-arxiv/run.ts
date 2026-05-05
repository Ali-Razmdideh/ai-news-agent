/**
 * Skill: collect-arxiv
 *
 * Polls the arXiv Atom feed for the latest papers in cs.AI / cs.LG / cs.CL /
 * cs.CV (max_results=80, sorted by submission date) and inserts them into the
 * shared `items` table via `insertItems()`. Idempotent — re-running on the
 * same window is a no-op because `(source, source_id)` is UNIQUE.
 *
 * Output (JSON, one line on stdout):  { collected, fresh }
 *
 * No LLM calls. No Telegram side-effects. Pure HTTP + SQLite.
 */
import { safeFetchText, insertItems, runSkill, xmlMatch } from "@ai-news/core";

// arXiv Atom API. We sort by submittedDate DESC so we always see the newest
// papers first; downstream stages dedupe and pick by id/published_at.
const FEED = "https://export.arxiv.org/api/query?search_query=" +
  "cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.CV" +
  "&sortBy=submittedDate&sortOrder=descending&max_results=80";

type Entry = { id: string; title: string; summary: string; published: string; authors: string };

// Hand-rolled Atom parser — pulling in a full XML library for one feed is
// overkill. The arXiv schema is stable; if it ever changes meaningfully
// the integration test will catch it before any real data is mis-stored.
function parseAtom(xml: string): Entry[] {
  const out: Entry[] = [];
  for (const raw of xml.split("<entry>").slice(1)) {
    const block = raw.split("</entry>")[0] ?? "";
    const id = xmlMatch(block, /<id>([^<]+)<\/id>/);
    const title = xmlMatch(block, /<title>([\s\S]*?)<\/title>/).replace(/\s+/g, " ");
    const summary = xmlMatch(block, /<summary>([\s\S]*?)<\/summary>/);
    const published = xmlMatch(block, /<published>([^<]+)<\/published>/);
    // Multiple <author><name>...</name></author> blocks per entry — flatten.
    const authors = [...block.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).join(", ");
    if (id && title) out.push({ id, title, summary, published, authors });
  }
  return out;
}

runSkill("collect-arxiv", async () => {
  // Fetch + parse + insert. The skill returns one stats line; the caller
  // (cron / pipeline) reads stdout for orchestration.
  const xml = await safeFetchText(FEED, { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 });
  const entries = parseAtom(xml);
  return insertItems(
    entries.map((e) => ({
      source: "arxiv",
      // Strip the version suffix ("v2", "v3") so a paper revision doesn't
      // appear as a brand-new item — we want the v1 id to remain canonical.
      source_id: (e.id.split("/abs/")[1] ?? e.id).split("v")[0] ?? e.id,
      url: e.id,
      title: e.title,
      raw_body: e.summary,
      authors: e.authors,
      published_at: e.published,
    })),
  );
});
