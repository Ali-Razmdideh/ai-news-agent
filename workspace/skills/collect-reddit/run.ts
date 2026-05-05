/**
 * Skill: collect-reddit
 *
 * Pulls top-of-day posts from a small set of high-signal AI/ML subreddits
 * via Reddit's public listing JSON. Posts are filtered by upvote floor
 * before being handed to the pipeline.
 *
 * Output (JSON, one line on stdout):  { collected, fresh }
 *
 * No auth — public listing endpoint. We send a custom user-agent because
 * Reddit blocks default UAs.
 */
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

// Two subreddits, intentional. r/MachineLearning is research-heavy;
// r/LocalLLaMA is operator-heavy. Adding more would dilute signal.
const SUBS = ["MachineLearning", "LocalLLaMA"];

runSkill("collect-reddit", async () => {
  const rows: CollectedItem[] = [];
  for (const sub of SUBS) {
    const url = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`;
    try {
      const res = await safeFetchJson<Listing>(url, {
        // Custom UA — default Node UA gets 403'd by Reddit's anti-scrape.
        headers: { "user-agent": "ai-news-bot/0.1" },
        timeoutMs: 15_000,
      });
      for (const c of res.data.children) {
        // Floor of 50 upvotes filters out brand-new posts that haven't
        // accreted any signal yet. Tunable; we'd want it lower if we
        // start scoring on freshness.
        if (c.data.ups < 50) continue;
        // Self-text posts have a relative permalink instead of an external
        // URL; reconstruct the absolute reddit.com link.
        const link = c.data.url.startsWith("http")
          ? c.data.url
          : `https://www.reddit.com${c.data.permalink}`;
        rows.push({
          source: `reddit:${sub}`,
          source_id: c.data.id,
          url: link,
          title: c.data.title,
          raw_body: c.data.selftext,
          authors: c.data.author,
          // Reddit uses unix-seconds; toIso() in insertItems handles that.
          published_at: new Date(c.data.created_utc * 1000).toISOString(),
        });
      }
    } catch (e) {
      log.warn({ sub, err: String(e) }, "reddit_failed");
    }
  }
  return insertItems(rows);
});
