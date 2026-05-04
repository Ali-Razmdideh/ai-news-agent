# Checklist: publish-digest

Triggered by cron `ai-news-collect` (every 30 min) or `ai-news-digest` (08:00).

1. `health-check` — abort tick if red.
2. In parallel: `collect-arxiv`, `collect-github`, `collect-rss`, `collect-hn`,
   `collect-reddit`. Each writes new rows to `items`.
3. For each new item without a row in `scores`: `score-relevance`.
4. Drop items with score < 6.
5. For each survivor without `summaries.tldr`:
   a. If `items.raw_body` is empty: `enrich-fetch`.
   b. `summarize-tldr` (Haiku). If self-confidence < 0.7: retry with Sonnet.
   c. If `scores.code_heavy = 1`: re-summarize with Opus.
6. Compute embedding via `voyage-3-lite`; upsert into `embeddings`.
7. Cluster-merge near-duplicates (cosine ≥ 0.92) — keep highest score.
8. Burst control: at most `MAX_POSTS_PER_HOUR` posts; remainder roll into the
   08:00 digest.
9. `post-telegram` per item to `TELEGRAM_CHANNEL_ID`. Insert into `posts`.
10. Emit one-line stats: `{collected, scored, kept, posted, dropped, errors}`.
