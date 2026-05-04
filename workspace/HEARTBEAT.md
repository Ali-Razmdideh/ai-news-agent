# HEARTBEAT (run on every cron tick before pipeline)

1. `health-check`: verify env vars present, DB writable, Anthropic reachable,
   Telegram `getMe` 200 OK, `dmPolicy=allowlist` in live config.
2. If any check fails: DM admin with the failing check, skip this tick, return.
3. If `usage_today >= DAILY_TOKEN_BUDGET`: DM admin once per day, skip LLM
   skills, allow collectors to keep ingesting.
