import { openDb, tx, safeFetchJson, loadEnv, log } from "@ai-news/core";

type Repo = {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  topics?: string[];
  pushed_at: string;
  owner: { login: string };
};

type Search = { items: Repo[] };

const TOPICS = ["llm", "ai-agents", "machine-learning", "deep-learning", "rag", "transformer", "diffusion", "embeddings"];

function dateNDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const since = dateNDaysAgo(7);
  const collected: Repo[] = [];
  for (const topic of TOPICS) {
    const q = encodeURIComponent(`topic:${topic} created:>${since} stars:>50`);
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`;
    try {
      const headers: Record<string, string> = {
        accept: "application/vnd.github+json",
        "user-agent": "ai-news-bot",
      };
      if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
      const res = await safeFetchJson<Search>(url, { headers, timeoutMs: 15_000 });
      collected.push(...res.items);
    } catch (e) {
      log.warn({ topic, err: String(e) }, "github_topic_failed");
    }
  }
  const db = openDb();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO items (source, source_id, url, title, raw_body, authors, published_at)
     VALUES ('github', ?, ?, ?, ?, ?, ?)`,
  );
  let n = 0;
  tx(() => {
    for (const r of collected) {
      const title = `${r.full_name} (${r.stargazers_count}★)`;
      const body = `${r.description ?? ""}\n\nTopics: ${(r.topics ?? []).join(", ")}`;
      const res = ins.run(String(r.id), r.html_url, title, body, r.owner.login, r.pushed_at);
      if ((res.changes ?? 0) > 0) n++;
    }
  });
  const out = { collected: collected.length, new: n };
  log.info(out, "collect_github_done");
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((e) => {
  log.error({ err: String(e) }, "collect_github_failed");
  process.exit(1);
});
