import { openDb, tx } from "./db.js";
import { log } from "./log.js";

export function cliArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function xmlMatch(block: string, re: RegExp): string {
  return (block.match(re)?.[1] ?? "").trim();
}

/**
 * Extract the first balanced-looking `{...}` JSON object from a model's text
 * response and parse it. Throws if no object is found or parsing fails — the
 * thrown error message is intentionally short so it's safe to log.
 */
export function parseJsonBlock<T = unknown>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no_json");
  return JSON.parse(m[0]) as T;
}

export type CollectedItem = {
  source: string;
  source_id: string;
  url: string;
  title: string;
  raw_body?: string | null;
  authors?: string | null;
  published_at?: string | null;
};

/**
 * Insert collector rows in a single transaction; returns counts.
 * `INSERT OR IGNORE` keys on the `(source, source_id)` UNIQUE index, so this
 * is idempotent — re-running a collector won't double-count.
 */
export function insertItems(rows: ReadonlyArray<CollectedItem>): { collected: number; fresh: number } {
  const ins = openDb().prepare(
    `INSERT OR IGNORE INTO items (source, source_id, url, title, raw_body, authors, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let fresh = 0;
  tx(() => {
    for (const r of rows) {
      const res = ins.run(
        r.source,
        r.source_id,
        r.url,
        r.title,
        r.raw_body ?? null,
        r.authors ?? null,
        r.published_at ?? null,
      );
      if ((res.changes ?? 0) > 0) fresh++;
    }
  });
  return { collected: rows.length, fresh };
}

/**
 * Standard skill entrypoint wrapper. Runs the skill, prints its return value
 * as a single JSON line on stdout, and exits 1 on any thrown error after
 * logging the failure. Skills should `return` their stats object instead of
 * writing stdout themselves.
 */
export function runSkill<T>(name: string, fn: () => Promise<T>): void {
  fn()
    .then((out) => {
      log.info({ name, ...(out as object) }, `${name}_done`);
      process.stdout.write(JSON.stringify(out) + "\n");
    })
    .catch((e: unknown) => {
      log.error({ name, err: String(e) }, `${name}_failed`);
      process.exit(1);
    });
}
