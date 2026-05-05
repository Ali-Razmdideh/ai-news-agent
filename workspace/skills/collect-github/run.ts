/**
 * Skill: collect-github
 *
 * Walks a curated set of AI/ML repository topics on GitHub and pulls the
 * top-starred new repos created in the last 7 days. One HTTPS call per
 * topic; failures on individual topics are logged and skipped so a single
 * 5xx doesn't drop the rest of the run.
 *
 * Output (JSON, one line on stdout):  { collected, fresh }
 *
 * Auth: optional `GITHUB_TOKEN` (read-only PAT). Without it we get hit by
 * the unauthenticated rate limit (60 req/hr per IP) very quickly.
 */
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

// Hand-curated AI/ML topics. GitHub Search returns up to 1000 items per
// query so we narrow by topic instead of one mega-query, both for diversity
// and to keep individual responses small.
const TOPICS = ["llm", "ai-agents", "machine-learning", "deep-learning", "rag", "transformer", "diffusion", "embeddings"];

function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

runSkill("collect-github", async () => {
  const env = loadEnv();
  const since = dateNDaysAgo(7);

  // Build headers once. Auth header included only when a token is set —
  // missing token is allowed for local dev but warned about by health-check.
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "ai-news-bot",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;

  // Sequential per-topic to stay under the secondary rate limit. Eight
  // topics × 20 results × ~10 KB ≈ trivial; no need to parallelize.
  const collected: Repo[] = [];
  for (const topic of TOPICS) {
    const q = encodeURIComponent(`topic:${topic} created:>${since} stars:>50`);
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`;
    try {
      const res = await safeFetchJson<{ items: Repo[] }>(url, { headers, timeoutMs: 15_000 });
      collected.push(...res.items);
    } catch (e) {
      // One failed topic doesn't fail the whole run — keep going.
      log.warn({ topic, err: String(e) }, "github_topic_failed");
    }
  }

  // Map to the shared schema. Title encodes star count for at-a-glance
  // signal in the channel; the body concatenates description + topics so
  // downstream scoring/summarization has something to ground in.
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
