---
name: post-telegram
description: Send a single MarkdownV2 message to the configured Telegram channel or as a reply in the discussion group. Records posts.
user-invocable: false
disable-model-invocation: true
metadata:
  openclaw:
    requires:
      bins: ["node"]
      env: ["AI_NEWS_DB", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID", "TELEGRAM_DISCUSSION_GROUP_ID", "ADMIN_TG_USER_ID"]
      os: ["linux", "darwin"]
---

Run `node {baseDir}/run.js --kind item --item-id <n>`
or  `node {baseDir}/run.js --kind reply --chat-id <c> --reply-to <m> --text "<text>"`
or  `node {baseDir}/run.js --kind admin --text "<msg>"`.

Refuses any chat-id outside the configured allowlist (defense-in-depth even
if openclaw config drifts).
