from datetime import datetime, timezone


def _utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def record_usage(*, model: str, stage: str, tokens_in: int, tokens_out: int) -> None:
    from .db import open_db
    db = open_db()
    db.execute(
        """INSERT INTO usage (day, model, stage, tokens_in, tokens_out, calls)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(day, model, stage) DO UPDATE SET
             tokens_in = tokens_in + excluded.tokens_in,
             tokens_out = tokens_out + excluded.tokens_out,
             calls = calls + 1""",
        (_utc_day(), model, stage, tokens_in, tokens_out),
    )
    db.commit()


def tokens_today() -> int:
    from .db import open_db
    row = open_db().execute(
        "SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total FROM usage WHERE day = ?",
        (_utc_day(),),
    ).fetchone()
    return row["total"] if row else 0


def is_over_budget() -> bool:
    from .env import load_env
    return tokens_today() >= load_env().DAILY_TOKEN_BUDGET


def today_breakdown() -> list[dict]:
    from .db import open_db
    rows = open_db().execute(
        "SELECT model, stage, tokens_in, tokens_out, calls FROM usage WHERE day = ? ORDER BY tokens_in DESC",
        (_utc_day(),),
    ).fetchall()
    return [dict(r) for r in rows]
