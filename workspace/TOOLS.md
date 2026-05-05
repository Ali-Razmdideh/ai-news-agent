# TOOLS — local environment notes

## Runtime
- Python 3.12, pip-managed dependencies (`requirements.txt`).
- SQLite via stdlib `sqlite3` + `sqlite-vec` extension.
- Embeddings via Voyage AI (`voyage-3-lite`).
- HTTP via `httpx` (SSRF-guarded, timeouts, retries in `core/http.py`).

## Filesystem (sandboxed)
- DB: `/data/news.db` (Docker volume).
- Logs: stdout (JSON, structured via `core/log.py`).
- FS writes outside `/data` and `/tmp` MUST fail (container is read-only root).

## Env vars (names only — values are loaded from `.env` / Docker secrets)
- `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`,
  `TELEGRAM_DISCUSSION_GROUP_ID`, `ADMIN_TG_USER_ID`, `GITHUB_TOKEN`,
  `VOYAGE_API_KEY`, `AI_NEWS_DB`, `DAILY_TOKEN_BUDGET`,
  `MAX_POSTS_PER_HOUR`, `QA_PER_USER_PER_HOUR`, `TIMEZONE`, `DRY_RUN`.

## Skill conventions
- Every skill is `workspace/skills/<name>/SKILL.md`.
- Skill logic lives in `core/skills/<module>.py`; invoked with
  `python3 -m core.skills.<module>` (requires `PYTHONPATH=/app`).
- Skills MUST exit non-zero on error; stdout is JSON.
- Skills MUST NOT print secrets; `core/log.py` handles redaction.

## Network egress
- Allowlisted hosts only — see `core/http.py`.
- All requests go through `safe_fetch_text`/`safe_fetch_json` (SSRF-guarded).
