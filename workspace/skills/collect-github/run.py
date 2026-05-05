"""
Skill: collect-github

Walks curated AI/ML repository topics on GitHub and pulls top-starred new
repos created in the last 7 days. One HTTPS call per topic; failures on
individual topics are logged and skipped.

Output (JSON, one line on stdout):  { collected, fresh }

Auth: optional GITHUB_TOKEN (read-only PAT). Without it the unauthenticated
rate limit (60 req/hr per IP) applies.
"""
import sys
import os

sys.path.insert(0, os.environ.get("AI_NEWS_CORE", "/app"))

from datetime import datetime, timezone, timedelta
from core import safe_fetch_json, load_env, log, insert_items, run_skill
from core.db import CollectedItem

TOPICS = ["llm", "ai-agents", "machine-learning", "deep-learning", "rag",
          "transformer", "diffusion", "embeddings"]


def date_n_days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d")


def main():
    env = load_env()
    since = date_n_days_ago(7)

    headers = {"accept": "application/vnd.github+json", "user-agent": "ai-news-bot"}
    if env.GITHUB_TOKEN:
        headers["authorization"] = f"Bearer {env.GITHUB_TOKEN}"

    collected = []
    for topic in TOPICS:
        q = f"topic:{topic} created:>{since} stars:>50"
        url = f"https://api.github.com/search/repositories?q={q}&sort=stars&order=desc&per_page=20"
        try:
            res = safe_fetch_json(url, headers=headers, timeout_ms=15_000)
            collected.extend(res.get("items", []))
        except Exception as e:
            log.warn({"topic": topic, "err": str(e)}, "github_topic_failed")

    rows = [
        CollectedItem(
            source="github",
            source_id=str(r["id"]),
            url=r["html_url"],
            title=f"{r['full_name']} ({r['stargazers_count']}★)",
            raw_body=f"{r.get('description') or ''}\n\nTopics: {', '.join(r.get('topics') or [])}",
            authors=r["owner"]["login"],
            published_at=r["pushed_at"],
        )
        for r in collected
    ]
    return insert_items(rows)


run_skill("collect-github", main)
