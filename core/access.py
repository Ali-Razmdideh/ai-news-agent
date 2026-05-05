"""
Trusted-reader management for the QA agent.

OpenClaw enforces the top-level access policy (dmPolicy=allowlist,
groupPolicy=allowlist) natively via openclaw.config.json5.  This module
handles only the secondary DB-backed check: whether a specific user-id
is in the trusted_readers table (required before the QA agent will answer).
"""

from .db import open_db


def is_trusted_reader(user_id) -> bool:
    row = (
        open_db()
        .execute("SELECT 1 FROM trusted_readers WHERE user_id = ?", (str(user_id),))
        .fetchone()
    )
    return row is not None


def add_trusted_reader(user_id, added_by: str) -> None:
    db = open_db()
    db.execute(
        "INSERT OR IGNORE INTO trusted_readers (user_id, added_by, added_at) "
        "VALUES (?, ?, datetime('now'))",
        (str(user_id), added_by),
    )
    db.commit()


def remove_trusted_reader(user_id) -> None:
    db = open_db()
    db.execute("DELETE FROM trusted_readers WHERE user_id = ?", (str(user_id),))
    db.commit()
