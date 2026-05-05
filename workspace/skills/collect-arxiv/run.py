"""
Skill: collect-arxiv

Polls the arXiv Atom feed for the latest papers in cs.AI / cs.LG / cs.CL /
cs.CV (max_results=80, sorted by submission date) and inserts them into the
shared `items` table. Idempotent — re-running on the same window is a no-op
because (source, source_id) is UNIQUE.

Output (JSON, one line on stdout):  { collected, fresh }

No LLM calls. No Telegram side-effects. Pure HTTP + SQLite.
"""
import sys
import os

sys.path.insert(0, os.environ.get("AI_NEWS_CORE", "/app"))

import re
from core import safe_fetch_text, insert_items, run_skill, xml_match
from core.db import CollectedItem

# arXiv Atom API — sorted by submittedDate DESC so newest papers come first.
FEED = (
    "https://export.arxiv.org/api/query?search_query="
    "cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.CV"
    "&sortBy=submittedDate&sortOrder=descending&max_results=80"
)


def parse_atom(xml: str) -> list[dict]:
    """Hand-rolled Atom parser — the arXiv schema is stable enough."""
    out = []
    for raw in xml.split("<entry>")[1:]:
        block = raw.split("</entry>")[0]
        entry_id = xml_match(block, r"<id>([^<]+)</id>")
        title = re.sub(r"\s+", " ", xml_match(block, r"<title>([\s\S]*?)</title>"))
        summary = xml_match(block, r"<summary>([\s\S]*?)</summary>")
        published = xml_match(block, r"<published>([^<]+)</published>")
        authors = ", ".join(m.group(1) for m in re.finditer(r"<name>([^<]+)</name>", block))
        if entry_id and title:
            out.append({"id": entry_id, "title": title, "summary": summary,
                        "published": published, "authors": authors})
    return out


def main():
    xml = safe_fetch_text(FEED, timeout_ms=20_000, max_bytes=4 * 1024 * 1024)
    entries = parse_atom(xml)
    rows = []
    for e in entries:
        # Strip version suffix ("v2") so a revision doesn't appear as new.
        arxiv_id = e["id"].split("/abs/")[-1].split("v")[0] or e["id"]
        rows.append(CollectedItem(
            source="arxiv",
            source_id=arxiv_id,
            url=e["id"],
            title=e["title"],
            raw_body=e["summary"],
            authors=e["authors"],
            published_at=e["published"],
        ))
    return insert_items(rows)


run_skill("collect-arxiv", main)
