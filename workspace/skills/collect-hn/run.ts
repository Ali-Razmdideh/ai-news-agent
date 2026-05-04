import { openDb, tx, safeFetchJson, log } from "@ai-news/core";

type Hit = {
  objectID: string;
  title: string;
  url: string | null;
  story_text: string | null;
  author: string;
  points: number;
  created_at: string;
};

const QUERIES = ["AI", "LLM", "agent", "transformer", "RAG", "embedding"];

async function main(): Promise<void> {
  const db = openDb();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO items (source, source_id, url, title, raw_body, authors, published_at)
     VALUES ('hn', ?, ?, ?, ?, ?, ?)`,
  );
  let collected = 0, fresh = 0;
  for (const q of QUERIES) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(q)}&numericFilters=points>50&hitsPerPage=20`;
    try {
      const res = await safeFetchJson<{ hits: Hit[] }>(url, {
        allowExtra: ["hn.algolia.com"],
        timeoutMs: 15_000,
      });
      collected += res.hits.length;
      tx(() => {
        for (const h of res.hits) {
          if (!h.url || !h.title) continue;
          const r = ins.run(h.objectID, h.url, h.title, h.story_text ?? "", h.author, h.created_at);
          if ((r.changes ?? 0) > 0) fresh++;
        }
      });
    } catch (e) {
      log.warn({ q, err: String(e) }, "hn_query_failed");
    }
  }
  const out = { collected, new: fresh };
  log.info(out, "collect_hn_done");
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((e) => {
  log.error({ err: String(e) }, "collect_hn_failed");
  process.exit(1);
});
