"""
Skill: collect-hn

Polls the Algolia Hacker News API for recent stories matching AI-adjacent
keywords, with a points threshold to filter low-signal submissions.

Output (JSON, one line on stdout):  { collected, fresh }

No auth needed; Algolia HN is public.
"""
import sys
import os

sys.path.insert(0, os.environ.get("AI_NEWS_CORE", "/app"))

from core import safe_fetch_json, log, insert_items, run_skill
from core.db import CollectedItem

QUERIES = ["AI", "LLM", "agent", "transformer", "RAG", "embedding"]


def main():
    rows: list[CollectedItem] = []
    for q in QUERIES:
        url = (
            f"https://hn.algolia.com/api/v1/search_by_date"
            f"?tags=story&query={q}&numericFilters=points>50&hitsPerPage=20"
        )
        try:
            res = safe_fetch_json(url, allow_extra=["hn.algolia.com"], timeout_ms=15_000)
            for h in res.get("hits", []):
                if not h.get("url") or not h.get("title"):
                    continue
                rows.append(CollectedItem(
                    source="hn",
                    source_id=h["objectID"],
                    url=h["url"],
                    title=h["title"],
                    raw_body=h.get("story_text") or "",
                    authors=h.get("author"),
                    published_at=h.get("created_at"),
                ))
        except Exception as e:
            log.warn({"q": q, "err": str(e)}, "hn_query_failed")
    return insert_items(rows)


run_skill("collect-hn", main)
