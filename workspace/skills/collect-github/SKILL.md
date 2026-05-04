---
name: collect-github
description: Fetch GitHub repos created in the last 7 days with stars>50 in AI/ML topics; insert new ones into the items DB.
user-invocable: false
disable-model-invocation: true
metadata:
  openclaw:
    requires:
      bins: ["node"]
      env: ["AI_NEWS_DB", "GITHUB_TOKEN"]
      os: ["linux", "darwin"]
---

Run `node {baseDir}/run.js`. Uses a read-only PAT (`public_repo` scope only). Output: `{collected, new}`.
