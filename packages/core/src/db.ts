import { DatabaseSync, type StatementSync } from "node:sqlite";
import { loadEnv } from "./env.js";
import { log } from "./log.js";

export type DB = DatabaseSync;

let cached: DatabaseSync | undefined;

export function openDb(): DatabaseSync {
  if (cached) return cached;
  const env = loadEnv();
  const db = new DatabaseSync(env.AI_NEWS_DB);
  runSql(db, "PRAGMA journal_mode = WAL");
  runSql(db, "PRAGMA foreign_keys = ON");
  runSql(db, "PRAGMA synchronous = NORMAL");
  migrate(db);
  cached = db;
  return db;
}

const MIGRATIONS: Array<{ id: number; sql: string }> = [
  {
    id: 1,
    sql: `
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      raw_body TEXT,
      authors TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      UNIQUE(source, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_status_fetched ON items(status, fetched_at);
    CREATE INDEX IF NOT EXISTS idx_items_source ON items(source, fetched_at);

    CREATE TABLE IF NOT EXISTS scores (
      item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      topic TEXT,
      code_heavy INTEGER NOT NULL DEFAULT 0,
      model_used TEXT,
      scored_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS summaries (
      item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      tldr TEXT NOT NULL,
      bullets_json TEXT NOT NULL,
      why_matters TEXT,
      confidence REAL,
      model_used TEXT,
      summarized_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      telegram_msg_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'item',
      posted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_chat_msg ON posts(chat_id, telegram_msg_id);

    CREATE TABLE IF NOT EXISTS qa_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reply_to_msg_id INTEGER,
      user_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT,
      model_used TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_qa_user_ts ON qa_log(user_id, ts);

    CREATE TABLE IF NOT EXISTS usage (
      day TEXT NOT NULL,
      model TEXT NOT NULL,
      stage TEXT NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, model, stage)
    );

    CREATE TABLE IF NOT EXISTS trusted_readers (
      user_id TEXT PRIMARY KEY,
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_denies (
      reason TEXT NOT NULL,
      day TEXT NOT NULL DEFAULT (date('now')),
      ts TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (reason, day)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      sign INTEGER NOT NULL CHECK (sign IN (-1, 1)),
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (item_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      vec_json TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, tldr, body,
      content=''
    );
    `,
  },
];

function migrate(db: DatabaseSync): void {
  runSql(
    db,
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );
  const applied = new Set(
    db.prepare("SELECT id FROM _migrations").all().map((r) => (r as { id: number }).id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    log.info({ id: m.id }, "applying_migration");
    runSql(db, "BEGIN");
    try {
      runSql(db, m.sql);
      db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(m.id);
      runSql(db, "COMMIT");
    } catch (e) {
      runSql(db, "ROLLBACK");
      throw e;
    }
  }
}

function runSql(db: DatabaseSync, sql: string): void {
  db.exec(sql);
}

/**
 * Run a function inside a single SQLite transaction. better-sqlite3-style helper.
 */
export function tx<T>(fn: () => T): T {
  const db = openDb();
  runSql(db, "BEGIN");
  try {
    const out = fn();
    runSql(db, "COMMIT");
    return out;
  } catch (e) {
    runSql(db, "ROLLBACK");
    throw e;
  }
}

export type { StatementSync };
