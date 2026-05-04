---
name: collect-arxiv
description: Fetch new cs.AI/cs.LG/cs.CL/cs.CV papers from arXiv (last 24h) and write them to the items DB. Returns counts.
user-invocable: false
disable-model-invocation: true
metadata:
  openclaw:
    requires:
      bins: ["node"]
      env: ["AI_NEWS_DB"]
      os: ["linux", "darwin"]
---

Run `node {baseDir}/run.js`. Stdout JSON: `{collected, new}`.
Pure script — no LLM, no Telegram. Only writes to DB.
