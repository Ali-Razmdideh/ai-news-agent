import { openDb, tx, safeFetchText, log } from "@ai-news/core";

const FEED = "https://export.arxiv.org/api/query?search_query=" +
  "cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.CV" +
  "&sortBy=submittedDate&sortOrder=descending&max_results=80";

type Entry = { id: string; title: string; summary: string; published: string; authors: string };

function parseAtom(xml: string): Entry[] {
  const out: Entry[] = [];
  const entries = xml.split("<entry>").slice(1);
  for (const raw of entries) {
    const block = raw.split("</entry>")[0] ?? "";
    const id = match(block, /<id>([^<]+)<\/id>/);
    const title = match(block, /<title>([\s\S]*?)<\/title>/).replace(/\s+/g, " ").trim();
    const summary = match(block, /<summary>([\s\S]*?)<\/summary>/).trim();
    const published = match(block, /<published>([^<]+)<\/published>/);
    const authors = [...block.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).join(", ");
    if (id && title) out.push({ id, title, summary, published, authors });
  }
  return out;
}

function match(s: string, re: RegExp): string {
  return (s.match(re)?.[1] ?? "").trim();
}

async function main(): Promise<void> {
  const xml = await safeFetchText(FEED, { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 });
  const entries = parseAtom(xml);
  const db = openDb();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO items (source, source_id, url, title, raw_body, authors, published_at)
     VALUES ('arxiv', ?, ?, ?, ?, ?, ?)`,
  );
  let n = 0;
  tx(() => {
    for (const e of entries) {
      const arxivId = (e.id.split("/abs/")[1] ?? e.id).split("v")[0] ?? e.id;
      const r = ins.run(arxivId, e.id, e.title, e.summary, e.authors, e.published);
      if ((r.changes ?? 0) > 0) n++;
    }
  });
  const out = { collected: entries.length, new: n };
  log.info(out, "collect_arxiv_done");
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((e) => {
  log.error({ err: String(e) }, "collect_arxiv_failed");
  process.exit(1);
});
