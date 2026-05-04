---
name: collect-rss
description: Pull AI lab and researcher RSS feeds (config/feeds.yaml). Insert new items into the items DB.
user-invocable: false
disable-model-invocation: true
metadata:
  openclaw:
    requires:
      bins: ["node"]
      env: ["AI_NEWS_DB"]
      os: ["linux", "darwin"]
---

Run `node {baseDir}/run.js`. Output: `{collected, new, errors}`.
