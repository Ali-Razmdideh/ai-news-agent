# USER (main session only — MUST NOT load in QA / group / channel sessions)

- **Owner Telegram user-id**: `${ADMIN_TG_USER_ID}` (from env at runtime).
- **Timezone**: `Asia/Tehran`.
- **Preferred topics (high weight)**: agents, tool-use, evals, RAG, inference
  efficiency, post-training, open-weight releases, security/prompt-injection.
- **Lower weight**: pure robotics, hardware/silicon launches, narrow vision tasks.
- **Cadence**: per-item posts as they arrive (rate-limited), daily digest 08:00,
  weekly "rising" digest Saturday 10:00.
- **Language**: English primary; Persian TLDR opt-in via `/lang fa`.
