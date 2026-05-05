import { safeFetchJson, loadEnv, log, insertItems, runSkill } from "@ai-news/core";

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

const TOPICS = ["llm", "ai-agents", "machine-learning", "deep-learning", "rag", "transformer", "diffusion", "embeddings"];

function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

runSkill("collect-github", async () => {
  const env = loadEnv();
  const since = dateNDaysAgo(7);
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "ai-news-bot",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const collected: Repo[] = [];
  for (const topic of TOPICS) {
    const q = encodeURIComponent(`topic:${topic} created:>${since} stars:>50`);
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`;
    try {
      const res = await safeFetchJson<{ items: Repo[] }>(url, { headers, timeoutMs: 15_000 });
      collected.push(...res.items);
    } catch (e) {
      log.warn({ topic, err: String(e) }, "github_topic_failed");
    }
  }

  return insertItems(
    collected.map((r) => ({
      source: "github",
      source_id: String(r.id),
      url: r.html_url,
      title: `${r.full_name} (${r.stargazers_count}★)`,
      raw_body: `${r.description ?? ""}\n\nTopics: ${(r.topics ?? []).join(", ")}`,
      authors: r.owner.login,
      published_at: r.pushed_at,
    })),
  );
});
