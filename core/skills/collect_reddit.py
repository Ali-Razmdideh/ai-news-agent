"""
Skill: collect-reddit

Pulls top-of-day posts from high-signal AI/ML subreddits via Reddit's
public listing JSON. Posts are filtered by upvote floor before insertion.

Output (JSON, one line on stdout):  { collected, fresh }

No auth — public listing endpoint. Custom user-agent required (Reddit
blocks default UAs).
"""

from core import safe_fetch_json, log, insert_items, run_skill
from core.db import CollectedItem
from core.skill import to_iso

SUBS = ["MachineLearning", "LocalLLaMA"]


def main():
    rows: list[CollectedItem] = []
    for sub in SUBS:
        url = f"https://www.reddit.com/r/{sub}/top.json?t=day&limit=25"
        try:
            res = safe_fetch_json(
                url,
                headers={"user-agent": "ai-news-bot/0.1"},
                timeout_ms=15_000,
            )
            for child in res["data"]["children"]:
                d = child["data"]
                if d.get("ups", 0) < 50:
                    continue
                link = (
                    d["url"]
                    if d["url"].startswith("http")
                    else f"https://www.reddit.com{d['permalink']}"
                )
                rows.append(
                    CollectedItem(
                        source=f"reddit:{sub}",
                        source_id=d["id"],
                        url=link,
                        title=d["title"],
                        raw_body=d.get("selftext", ""),
                        authors=d.get("author"),
                        published_at=to_iso(d["created_utc"]),
                    )
                )
        except Exception as e:
            log.warn({"sub": sub, "err": str(e)}, "reddit_failed")
    return insert_items(rows)


if __name__ == "__main__":
    run_skill("collect-reddit", main)
