/**
 * Skill: collect-hn
 *
 * Polls the Algolia Hacker News API for recent stories matching a small
 * set of AI-adjacent keywords, with a points threshold to filter low-signal
 * submissions. Each query is independent — one slow/failed query doesn't
 * block the others.
 *
 * Output (JSON, one line on stdout):  { collected, fresh }
 *
 * No auth needed; Algolia HN is public.
 */
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

// Each query is broad on purpose; the score-relevance stage filters hard
// later. Better to over-collect cheap (no LLM) than miss a signal item.
const QUERIES = ["AI", "LLM", "agent", "transformer", "RAG", "embedding"];

runSkill("collect-hn", async () => {
  // Accumulate rows across all queries first, then a single insertItems()
  // batch — that hits SQLite once with a transaction wrapping all writes
  // instead of one transaction per query.
  const rows: CollectedItem[] = [];
  for (const q of QUERIES) {
    // numericFilters>50 trims out near-zero-vote stories. The api host
    // isn't on the default allowlist so we pass it via allowExtra.
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(q)}&numericFilters=points>50&hitsPerPage=20`;
    try {
      const res = await safeFetchJson<{ hits: Hit[] }>(url, {
        allowExtra: ["hn.algolia.com"],
        timeoutMs: 15_000,
      });
      for (const h of res.hits) {
        // HN "Ask HN" / "Show HN" posts have no external URL — we skip
        // them to avoid posting bare HN threads.
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
