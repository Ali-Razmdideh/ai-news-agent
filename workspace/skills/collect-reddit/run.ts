import { openDb, tx, safeFetchJson, log } from "@ai-news/core";

type Listing = {
  data: { children: Array<{ data: { id: string; title: string; url: string; selftext: string; author: string; created_utc: number; ups: number; permalink: string } }> };
};

const SUBS = ["MachineLearning", "LocalLLaMA"];

async function main(): Promise<void> {
  const db = openDb();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO items (source, source_id, url, title, raw_body, authors, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let collected = 0, fresh = 0;
  for (const sub of SUBS) {
    const url = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`;
    try {
      const res = await safeFetchJson<Listing>(url, {
        headers: { "user-agent": "ai-news-bot/0.1" },
        timeoutMs: 15_000,
      });
      collected += res.data.children.length;
      tx(() => {
        for (const c of res.data.children) {
          if (c.data.ups < 50) continue;
          const tsIso = new Date(c.data.created_utc * 1000).toISOString();
          const link = c.data.url.startsWith("http") ? c.data.url : `https://www.reddit.com${c.data.permalink}`;
          const r = ins.run(`reddit:${sub}`, c.data.id, link, c.data.title, c.data.selftext, c.data.author, tsIso);
          if ((r.changes ?? 0) > 0) fresh++;
        }
      });
    } catch (e) {
      log.warn({ sub, err: String(e) }, "reddit_failed");
    }
  }
  const out = { collected, new: fresh };
  log.info(out, "collect_reddit_done");
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((e) => {
  log.error({ err: String(e) }, "collect_reddit_failed");
  process.exit(1);
});
