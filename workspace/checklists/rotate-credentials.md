# Checklist: rotate-credentials (weekly)

1. DM admin: list of credentials nearing rotation due-date (Anthropic key,
   Telegram bot token, GitHub PAT, Voyage key). Due dates in `credentials.yaml`.
2. Admin replies `/rotate <name>` → bot generates a one-line "how to rotate"
   reminder (no automation; rotation is manual on provider sites).
3. After admin updates `.env` and `docker compose up -d`, `health-check` runs
   on boot and confirms the new key works (Anthropic `models.list`,
   Telegram `getMe`, GitHub `/user`).
4. If any check fails after rotation: roll back via `git -C config restore`
   and DM admin.
