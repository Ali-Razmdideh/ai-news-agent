import { safeFetchJson, log, insertItems, runSkill, type CollectedItem } from "@ai-news/core";

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

runSkill("collect-hn", async () => {
  const rows: CollectedItem[] = [];
  for (const q of QUERIES) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(q)}&numericFilters=points>50&hitsPerPage=20`;
    try {
      const res = await safeFetchJson<{ hits: Hit[] }>(url, {
        allowExtra: ["hn.algolia.com"],
        timeoutMs: 15_000,
      });
      for (const h of res.hits) {
        if (!h.url || !h.title) continue;
        rows.push({
          source: "hn",
          source_id: h.objectID,
          url: h.url,
          title: h.title,
          raw_body: h.story_text ?? "",
          authors: h.author,
          published_at: h.created_at,
        });
      }
    } catch (e) {
      log.warn({ q, err: String(e) }, "hn_query_failed");
    }
  }
  return insertItems(rows);
});
