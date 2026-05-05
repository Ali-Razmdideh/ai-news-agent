"""
Skill: collect-rss

Walks every feed defined in config/feeds.yaml (path overridable via the
FEEDS_YAML env var) and ingests entries into the items table. Supports both
RSS 2.0 and Atom transparently.

Output (JSON, one line on stdout):  { collected, fresh, errors }
"""

import os

import re
from core import safe_fetch_text, log, insert_items, run_skill, xml_match
from core.db import CollectedItem


def parse_simple_yaml(text: str) -> list[dict]:
    """Tiny YAML subset: handles lists of {name, url} pairs only."""
    out = []
    cur: dict = {}
    for raw in text.split("\n"):
        line = re.sub(r"#.*$", "", raw).rstrip()
        if not line.strip():
            continue
        if line.startswith("- "):
            if cur.get("name") and cur.get("url"):
                out.append(cur)
            cur = {}
            m = re.match(r"^- name:\s*(.+)$", line)
            if m:
                cur["name"] = m.group(1).strip()
        else:
            m = re.match(r"^\s*(name|url):\s*(.+)$", line)
            if m:
                cur[m.group(1)] = m.group(2).strip()
    if cur.get("name") and cur.get("url"):
        out.append(cur)
    return out


def parse_feed(xml: str) -> list[dict]:
    out = []
    # ── RSS 2.0 ──────────────────────────────────────────────────────────────
    for raw in xml.split("<item")[1:]:
        if not raw.startswith(">") and not raw.startswith(" "):
            continue
        block = raw.split("</item>")[0]
        title = xml_match(block, r"<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</title>")
        link = xml_match(block, r"<link>([^<]+)</link>")
        guid = xml_match(block, r"<guid[^>]*>([^<]+)</guid>") or link
        desc = xml_match(
            block, r"<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</description>"
        )
        pub = xml_match(block, r"<pubDate>([^<]+)</pubDate>")
        if title and link:
            out.append(
                {
                    "id": guid,
                    "title": title,
                    "link": link,
                    "summary": desc,
                    "published": pub,
                }
            )
    if out:
        return out
    # ── Atom fallback ─────────────────────────────────────────────────────────
    for raw in xml.split("<entry")[1:]:
        if not raw.startswith(">") and not raw.startswith(" "):
            continue
        block = raw.split("</entry>")[0]
        title = re.sub(
            r"\s+",
            " ",
            xml_match(
                block, r"<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</title>"
            ),
        )
        link = xml_match(block, r'<link[^>]*href="([^"]+)"')
        entry_id = xml_match(block, r"<id>([^<]+)</id>") or link
        summary = xml_match(
            block,
            r"<(?:summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</(?:summary|content)>",
        )
        updated = xml_match(
            block, r"<(?:updated|published)>([^<]+)</(?:updated|published)>"
        )
        if title and link:
            out.append(
                {
                    "id": entry_id,
                    "title": title,
                    "link": link,
                    "summary": summary,
                    "published": updated,
                }
            )
    return out


def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:4000]


def main():
    path = os.environ.get("FEEDS_YAML", "/app/config/feeds.yaml")
    with open(path, "r", encoding="utf-8") as f:
        feeds = parse_simple_yaml(f.read())

    rows: list[CollectedItem] = []
    errors = 0

    for feed in feeds:
        try:
            xml = safe_fetch_text(
                feed["url"], timeout_ms=15_000, max_bytes=4 * 1024 * 1024
            )
            for e in parse_feed(xml):
                rows.append(
                    CollectedItem(
                        source=f"rss:{feed['name']}",
                        source_id=e["id"],
                        url=e["link"],
                        title=e["title"],
                        raw_body=strip_html(e["summary"]),
                        published_at=e["published"],
                    )
                )
        except Exception as e:
            errors += 1
            log.warn({"feed": feed["name"], "err": str(e)}, "rss_feed_failed")

    result = insert_items(rows)
    result["errors"] = errors
    return result


if __name__ == "__main__":
    run_skill("collect-rss", main)
