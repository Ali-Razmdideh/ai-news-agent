import { openDb, embed, cosine, log } from "@ai-news/core";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Match = { item_id: number; url: string; title: string; score: number; snippet: string };

async function main(): Promise<void> {
  const q = arg("q");
  if (!q) throw new Error("missing --q");
  const k = Math.max(1, Math.min(20, Number(arg("k") ?? 8)));
  const parent = arg("parent-item-id");

  const db = openDb();

  // FTS5 candidate set
  const ftsRows = db
    .prepare(
      `SELECT it.id AS item_id, it.url, it.title, sm.tldr
       FROM items_fts f
       JOIN items it ON it.rowid = f.rowid
       LEFT JOIN summaries sm ON sm.item_id = it.id
       WHERE items_fts MATCH ? LIMIT ?`,
    )
    .all(sanitizeFtsQuery(q), k * 4) as Array<{ item_id: number; url: string; title: string; tldr: string | null }>;

  // Recent embedded items (cap 500 — JS cosine is cheap at this size)
  const vecRows = db
    .prepare(
      `SELECT it.id AS item_id, it.url, it.title, sm.tldr, e.vec_json
       FROM embeddings e
       JOIN items it ON it.id = e.item_id
       LEFT JOIN summaries sm ON sm.item_id = it.id
       ORDER BY e.created_at DESC
       LIMIT 500`,
    )
    .all() as Array<{ item_id: number; url: string; title: string; tldr: string | null; vec_json: string }>;

  let qVec: number[] | undefined;
  try {
    [qVec] = await embed([q]);
  } catch (e) {
    log.warn({ err: String(e) }, "embed_failed");
  }

  const merged = new Map<number, Match>();
  for (const r of ftsRows) {
    merged.set(r.item_id, {
      item_id: r.item_id,
      url: r.url,
      title: r.title,
      score: 1.0,
      snippet: (r.tldr ?? r.title).slice(0, 400),
    });
  }
  if (qVec) {
    for (const r of vecRows) {
      const sim = cosine(qVec, JSON.parse(r.vec_json) as number[]);
      const cur = merged.get(r.item_id);
      if (cur) cur.score = Math.max(cur.score, sim);
      else if (sim > 0.25)
        merged.set(r.item_id, {
          item_id: r.item_id,
          url: r.url,
          title: r.title,
          score: sim,
          snippet: (r.tldr ?? r.title).slice(0, 400),
        });
    }
  }

  let matches = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, k);

  if (parent) {
    const parentId = Number(parent);
    if (Number.isFinite(parentId)) {
      matches = matches.map((m) => (m.item_id === parentId ? { ...m, score: m.score + 0.5 } : m));
      matches.sort((a, b) => b.score - a.score);
    }
  }

  process.stdout.write(JSON.stringify({ matches }) + "\n");
}

function sanitizeFtsQuery(q: string): string {
  return q
    .replace(/["()*]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
    .join(" OR ");
}

main().catch((e) => {
  log.error({ err: String(e) }, "search_failed");
  process.exit(1);
});
