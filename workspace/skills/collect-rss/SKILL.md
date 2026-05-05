---
name: collect-rss
description: Pull AI lab and researcher RSS feeds (config/feeds.yaml). Insert new items into the items DB.
user-invocable: false
disable-model-invocation: true
metadata:
  openclaw:
    requires:
      bins: ["python3"]
      env: ["AI_NEWS_DB"]
      os: ["linux", "darwin"]
---

Run `python3 {baseDir}/run.py`. Output: `{collected, new, errors}`.
