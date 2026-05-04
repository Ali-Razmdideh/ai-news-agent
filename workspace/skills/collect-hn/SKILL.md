---
name: collect-hn
description: Pull AI-tagged Hacker News stories from the last 24h via Algolia.
user-invocable: false
disable-model-invocation: true
metadata:
  openclaw:
    requires:
      bins: ["node"]
      env: ["AI_NEWS_DB"]
      os: ["linux", "darwin"]
---
Run `node {baseDir}/run.js`. Output: `{collected, new}`.
