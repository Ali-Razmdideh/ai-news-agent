---
name: search-corpus
description: Hybrid FTS5 + sqlite-vec retrieval over indexed items. Returns top-k chunks for QA grounding.
user-invocable: false
metadata:
  openclaw:
    requires:
      bins: ["node"]
      env: ["AI_NEWS_DB"]
      os: ["linux", "darwin"]
---

Run `node {baseDir}/run.js --q "<question>" [--parent-item-id <n>] [--k 8]`. Returns `{matches: [{item_id, url, title, score, snippet}]}`.
