---
name: summarize-tldr
description: Produce 2-4 sentence TLDR + 3 bullets + why-it-matters. Tier `low` default, escalates to `mid` if confidence<0.7, `high` for code-heavy items. Provider/model configurable via env (LLM_PROVIDER, MODEL_LOW/MID/HIGH).
user-invocable: false
metadata:
  openclaw:
    requires:
      bins: ["node"]
      env: ["AI_NEWS_DB"]
      anyEnv: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]
      os: ["linux", "darwin"]
---

Run `node {baseDir}/run.js --item-id <n>`. Persists to `summaries`.
