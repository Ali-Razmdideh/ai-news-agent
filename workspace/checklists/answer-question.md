# Checklist: answer-question

Triggered by `qa` agent on a Telegram reply in the allowlisted discussion group
that @-mentions the bot.

1. `access.ts` recheck: chat-id matches `TELEGRAM_DISCUSSION_GROUP_ID`,
   user-id is in `accessGroup:trusted-readers`. Else drop silently.
2. Per-user rate limit: ≤ `QA_PER_USER_PER_HOUR` queries per user-id (from `qa_log`).
3. Resolve parent: extract item-id from the replied-to post (stored in
   `posts.telegram_msg_id`). If parent is not a bot post, refuse.
4. `search-corpus` with `parent_item_id` + question → top-k chunks
   (FTS5 + sqlite-vec, k=8, MMR for diversity).
5. If best score < retrieval threshold: reply "no source on file" and stop.
6. Build prompt: system = SOUL voice + grounding rule; user-block = question;
   evidence-block = retrieved chunks wrapped in `<source id="...">…</source>`.
7. Call Haiku. If output cites a source-id not in evidence: retry once with
   Sonnet + stricter system. If still ungrounded: refuse.
8. `post-telegram` reply-in-thread, citing item URLs.
9. Insert `qa_log` row (user_id, question, answer, model, tokens, ts).
