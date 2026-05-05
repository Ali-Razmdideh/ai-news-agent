"""
Skill: search-corpus

Hybrid retrieval over the items DB for the QA agent. Combines:
  • FTS5 keyword search over title + tldr + body  (fast, recall-heavy)
  • Embedding similarity over the last 500 indexed items  (precision)

The two result sets are merged: FTS rows are pinned to a floor score of
1.0; embedding-only matches are gated by a 0.25 similarity threshold.

Output (JSON, one line on stdout):
  { matches: [{ item_id, url, title, score, snippet }, ...] }

No LLM calls; no DB writes. Pure retrieval.
"""
import sys
import os

sys.path.insert(0, os.environ.get("AI_NEWS_CORE", "/app"))

import json
from core import open_db, embed, cosine, log, run_skill, cli_arg


def sanitize_fts_query(q: str) -> str:
    """Strip FTS5 meta-chars, drop short tokens, OR-join up to 8 terms."""
    import re
    tokens = re.sub(r'["()*]', " ", q).split()
    tokens = [t for t in tokens if len(t) >= 2][:8]
    return " OR ".join(tokens)


def main():
    q = cli_arg("q")
    if not q:
        raise ValueError("missing --q")
    k = max(1, min(20, int(cli_arg("k") or "8")))
    parent = cli_arg("parent-item-id")

    db = open_db()

    # ── FTS candidates ────────────────────────────────────────────────────────
    fts_rows = db.execute(
        """SELECT it.id AS item_id, it.url, it.title, sm.tldr
           FROM items_fts f
           JOIN items it ON it.rowid = f.rowid
           LEFT JOIN summaries sm ON sm.item_id = it.id
           WHERE items_fts MATCH ? LIMIT ?""",
        (sanitize_fts_query(q), k * 4),
    ).fetchall()

    # ── Embedding candidates ──────────────────────────────────────────────────
    vec_rows = db.execute(
        """SELECT it.id AS item_id, it.url, it.title, sm.tldr, e.vec_json
           FROM embeddings e
           JOIN items it ON it.id = e.item_id
           LEFT JOIN summaries sm ON sm.item_id = it.id
           ORDER BY e.created_at DESC LIMIT 500""",
    ).fetchall()

    # Embed the query — best-effort; FTS-only results on failure.
    q_vec = None
    try:
        q_vec = embed([q])[0]
    except Exception as e:
        log.warn({"err": str(e)}, "embed_failed")

    # ── Merge ─────────────────────────────────────────────────────────────────
    merged: dict[int, dict] = {}
    for r in fts_rows:
        merged[r["item_id"]] = {
            "item_id": r["item_id"],
            "url": r["url"],
            "title": r["title"],
            "score": 1.0,
            "snippet": (r["tldr"] or r["title"] or "")[:400],
        }
    if q_vec:
        for r in vec_rows:
            sim = cosine(q_vec, json.loads(r["vec_json"]))
            if r["item_id"] in merged:
                merged[r["item_id"]]["score"] = max(merged[r["item_id"]]["score"], sim)
            elif sim > 0.25:
                merged[r["item_id"]] = {
                    "item_id": r["item_id"],
                    "url": r["url"],
                    "title": r["title"],
                    "score": sim,
                    "snippet": (r["tldr"] or r["title"] or "")[:400],
                }

    matches = sorted(merged.values(), key=lambda x: x["score"], reverse=True)[:k]

    # Optional parent-boost: +0.5 lifts the parent past most ties.
    if parent and parent.isdigit():
        parent_id = int(parent)
        for m in matches:
            if m["item_id"] == parent_id:
                m["score"] += 0.5
        matches.sort(key=lambda x: x["score"], reverse=True)

    return {"matches": matches}


run_skill("search-corpus", main)
