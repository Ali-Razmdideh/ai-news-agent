/**
 * Skill: search-corpus
 *
 * Hybrid retrieval over the items DB for the QA agent. Combines:
 *   • FTS5 keyword search over title + tldr + body  (fast, recall-heavy)
 *   • Embedding similarity over the last 500 indexed items  (precision)
 * The two result sets are merged on item_id with FTS rows pinned to a
 * floor score of 1.0 and embedding-only matches gated by a similarity
 * threshold.
 *
 * Output (JSON, one line on stdout):
 *   { matches: [{ item_id, url, title, score, snippet }, ...] }
 *
 * No LLM calls; no DB writes. Pure retrieval.
 */
import { openDb, embed, cosine, log, runSkill, cliArg } from "@ai-news/core";

type Match = { item_id: number; url: string; title: string; score: number; snippet: string };

/**
 * FTS5 quirks: bare punctuation breaks the parser, and queries with too
 * many tokens degrade quickly. Strip the meta chars, drop short tokens,
 * cap to 8 terms, and OR them — recall-heavy by design because the
 * embedding rerank handles precision.
 */
function sanitizeFtsQuery(q: string): string {
  return q
    .replace(/["()*]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
    .join(" OR ");
}

runSkill("search-corpus", async () => {
  const q = cliArg("q");
  if (!q) throw new Error("missing --q");
  // Clamp k so a malformed prompt can't ask for thousands of rows.
  const k = Math.max(1, Math.min(20, Number(cliArg("k") ?? 8)));
  // Optional anchor: the parent post the user replied to. If passed, we
  // boost it in the final ranking so its summary always makes the top-k.
  const parent = cliArg("parent-item-id");

  const db = openDb();

  // ── FTS candidates ─────────────────────────────────────────────────────
  // 4× over-fetch so the merge step has options. items_fts.rowid pins
  // back to items.rowid (== items.id for unindexed FTS contentless tables).
  const ftsRows = db
    .prepare(
      `SELECT it.id AS item_id, it.url, it.title, sm.tldr
       FROM items_fts f
       JOIN items it ON it.rowid = f.rowid
       LEFT JOIN summaries sm ON sm.item_id = it.id
       WHERE items_fts MATCH ? LIMIT ?`,
    )
    .all(sanitizeFtsQuery(q), k * 4) as Array<{ item_id: number; url: string; title: string; tldr: string | null }>;

  // ── Embedding candidates ───────────────────────────────────────────────
  // The 500-row recency cap keeps cosine math under a millisecond on JS
  // arrays. If the corpus grows past ~10k items we'd swap for sqlite-vec
  // and a real ANN index.
  const vecRows = db
    .prepare(
      `SELECT it.id AS item_id, it.url, it.title, sm.tldr, e.vec_json
       FROM embeddings e
       JOIN items it ON it.id = e.item_id
       LEFT JOIN summaries sm ON sm.item_id = it.id
       ORDER BY e.created_at DESC
       LIMIT 500`,
    )
    .all() as Array<{ item_id: number; url: string; title: string; tldr: string | null; vec_json: string }>;

  // Embedding the query is best-effort — if Voyage / the proxy is down we
  // still get FTS-only results, which is degraded but useful.
  let qVec: number[] | undefined;
  try {
    [qVec] = await embed([q]);
  } catch (e) {
    log.warn({ err: String(e) }, "embed_failed");
  }

  // ── Merge ──────────────────────────────────────────────────────────────
  const merged = new Map<number, Match>();
  // FTS hits start at score 1.0 — they're the floor; embeddings can only
  // promote them, never demote.
  for (const r of ftsRows) {
    merged.set(r.item_id, {
      item_id: r.item_id,
      url: r.url,
      title: r.title,
      score: 1.0,
      snippet: (r.tldr ?? r.title).slice(0, 400),
    });
  }
  if (qVec) {
    for (const r of vecRows) {
      const sim = cosine(qVec, JSON.parse(r.vec_json) as number[]);
      const cur = merged.get(r.item_id);
      if (cur) {
        cur.score = Math.max(cur.score, sim);
      } else if (sim > 0.25) {
        // 0.25 threshold prunes far-from-query embedding-only candidates;
        // tuned empirically against Voyage-3-lite output dim 256.
        merged.set(r.item_id, {
          item_id: r.item_id,
          url: r.url,
          title: r.title,
          score: sim,
          snippet: (r.tldr ?? r.title).slice(0, 400),
        });
      }
    }
  }

  // Top-k by score, then optional parent-boost.
  let matches = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, k);
  if (parent) {
    const parentId = Number(parent);
    if (Number.isFinite(parentId)) {
      // +0.5 is enough to lift the parent past most ties without
      // overwhelming a strongly-matching unrelated hit.
      matches = matches.map((m) => (m.item_id === parentId ? { ...m, score: m.score + 0.5 } : m));
      matches.sort((a, b) => b.score - a.score);
    }
  }

  return { matches };
});
