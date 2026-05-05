import sqlite3
import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Optional, Iterator
from .log import log

_cached_db: Optional[sqlite3.Connection] = None

MIGRATIONS_SQL = """
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
"""


def _migrate(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE IF NOT EXISTS _migrations (
             id INTEGER PRIMARY KEY,
             applied_at TEXT NOT NULL DEFAULT (datetime('now'))
           )""")
    db.commit()

    applied = {row[0] for row in db.execute("SELECT id FROM _migrations")}

    migrations = [
        (1, MIGRATIONS_SQL, None),
        (2, None, _backfill_iso_dates),
    ]

    for mid, sql, fn in migrations:
        if mid in applied:
            continue
        log.info({"id": mid}, "applying_migration")
        try:
            if sql:
                db.executescript(sql)
            if fn:
                fn(db)
            db.execute("INSERT INTO _migrations (id) VALUES (?)", (mid,))
            db.commit()
        except Exception:
            db.rollback()
            raise


def _backfill_iso_dates(db: sqlite3.Connection) -> None:
    from datetime import datetime, timezone

    rows = db.execute(
        "SELECT id, published_at FROM items WHERE published_at IS NOT NULL"
    ).fetchall()
    for row_id, pub in rows:
        try:
            # Try parsing as various formats
            for fmt in (None,):  # use dateutil-style parsing via datetime
                try:
                    from email.utils import parsedate_to_datetime

                    dt = parsedate_to_datetime(pub)
                except Exception:
                    try:
                        dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                    except Exception:
                        continue
                iso = dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                if iso != pub:
                    db.execute(
                        "UPDATE items SET published_at = ? WHERE id = ?", (iso, row_id)
                    )
        except Exception:
            continue
    db.commit()


def open_db() -> sqlite3.Connection:
    global _cached_db
    if _cached_db is not None:
        return _cached_db

    from .env import load_env

    db_path = load_env().AI_NEWS_DB

    # Ensure parent directory exists (skip for :memory:)
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    db = sqlite3.connect(db_path, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA synchronous = NORMAL")
    _migrate(db)
    _cached_db = db
    return db


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    db = open_db()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise


@dataclass
class CollectedItem:
    source: str
    source_id: str
    url: str
    title: str
    raw_body: Optional[str] = None
    authors: Optional[str] = None
    published_at: Optional[str] = None


def insert_items(rows: list[CollectedItem]) -> dict:
    from .skill import to_iso

    db = open_db()
    fresh = 0
    try:
        for r in rows:
            cur = db.execute(
                """INSERT OR IGNORE INTO items
                   (source, source_id, url, title, raw_body, authors, published_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    r.source,
                    r.source_id,
                    r.url,
                    r.title,
                    r.raw_body,
                    r.authors,
                    to_iso(r.published_at),
                ),
            )
            if cur.rowcount > 0:
                fresh += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"collected": len(rows), "fresh": fresh}
