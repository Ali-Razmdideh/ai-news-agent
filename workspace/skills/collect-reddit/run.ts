import { safeFetchJson, log, insertItems, runSkill, type CollectedItem } from "@ai-news/core";

type Listing = {
  data: {
    children: Array<{
      data: {
        id: string;
        title: string;
        url: string;
        selftext: string;
        author: string;
        created_utc: number;
        ups: number;
        permalink: string;
      };
    }>;
  };
};

const SUBS = ["MachineLearning", "LocalLLaMA"];

runSkill("collect-reddit", async () => {
  const rows: CollectedItem[] = [];
  for (const sub of SUBS) {
    const url = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`;
    try {
      const res = await safeFetchJson<Listing>(url, {
        headers: { "user-agent": "ai-news-bot/0.1" },
        timeoutMs: 15_000,
      });
      for (const c of res.data.children) {
        if (c.data.ups < 50) continue;
        const link = c.data.url.startsWith("http") ? c.data.url : `https://www.reddit.com${c.data.permalink}`;
        rows.push({
          source: `reddit:${sub}`,
          source_id: c.data.id,
          url: link,
          title: c.data.title,
          raw_body: c.data.selftext,
          authors: c.data.author,
          published_at: new Date(c.data.created_utc * 1000).toISOString(),
        });
      }
    } catch (e) {
      log.warn({ sub, err: String(e) }, "reddit_failed");
    }
  }
  return insertItems(rows);
});
