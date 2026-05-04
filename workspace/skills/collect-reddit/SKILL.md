---
name: collect-reddit
description: Pull top-of-day posts from r/MachineLearning and r/LocalLLaMA via public JSON.
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
