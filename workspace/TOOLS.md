# TOOLS — local environment notes

## Runtime
- Node 22+, pnpm 9, TypeScript 5.6 strict.
- SQLite via `better-sqlite3` + `sqlite-vec` extension.
- Embeddings via Voyage AI (`voyage-3-lite`).

## Filesystem (sandboxed)
- DB: `/data/news.db` (Docker volume).
- Logs: stdout (JSON, pino).
- FS writes outside `/data` and `/tmp` MUST fail (container is read-only root).

## Env vars (names only — values are loaded from `.env` / Docker secrets)
- `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`,
  `TELEGRAM_DISCUSSION_GROUP_ID`, `ADMIN_TG_USER_ID`, `GITHUB_TOKEN`,
  `VOYAGE_API_KEY`, `AI_NEWS_DB`, `DAILY_TOKEN_BUDGET`,
  `MAX_POSTS_PER_HOUR`, `QA_PER_USER_PER_HOUR`, `TIMEZONE`, `DRY_RUN`.

## Skill conventions
- Every skill is `workspace/skills/<name>/{SKILL.md, run.ts}`.
- Skills MUST exit non-zero on error; stdout is JSON.
- Skills MUST NOT print secrets; `packages/core/log.ts` handles redaction.

## Network egress
- Allowlisted hosts only — see `packages/core/http.ts`.
- All `fetch()` calls go through `safeFetch()` (SSRF-guarded, timeouts, retries).
