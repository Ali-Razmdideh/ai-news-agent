import { safeFetchText, insertItems, runSkill, xmlMatch } from "@ai-news/core";

const FEED = "https://export.arxiv.org/api/query?search_query=" +
  "cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.CV" +
  "&sortBy=submittedDate&sortOrder=descending&max_results=80";

type Entry = { id: string; title: string; summary: string; published: string; authors: string };

function parseAtom(xml: string): Entry[] {
  const out: Entry[] = [];
  for (const raw of xml.split("<entry>").slice(1)) {
    const block = raw.split("</entry>")[0] ?? "";
    const id = xmlMatch(block, /<id>([^<]+)<\/id>/);
    const title = xmlMatch(block, /<title>([\s\S]*?)<\/title>/).replace(/\s+/g, " ");
    const summary = xmlMatch(block, /<summary>([\s\S]*?)<\/summary>/);
    const published = xmlMatch(block, /<published>([^<]+)<\/published>/);
    const authors = [...block.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).join(", ");
    if (id && title) out.push({ id, title, summary, published, authors });
  }
  return out;
}

runSkill("collect-arxiv", async () => {
  const xml = await safeFetchText(FEED, { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 });
  const entries = parseAtom(xml);
  return insertItems(
    entries.map((e) => ({
      source: "arxiv",
      source_id: (e.id.split("/abs/")[1] ?? e.id).split("v")[0] ?? e.id,
      url: e.id,
      title: e.title,
      raw_body: e.summary,
      authors: e.authors,
      published_at: e.published,
    })),
  );
});
