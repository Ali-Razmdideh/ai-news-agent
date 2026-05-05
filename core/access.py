from typing import Union
from .env import load_env
from .log import log


def check_inbound(*, chat_id, user_id, kind: str, is_mention: bool = False) -> dict:
    env = load_env()
    uid = str(user_id)
    cid = str(chat_id)
    admin_id = env.ADMIN_TG_USER_ID
    group_id = env.TELEGRAM_DISCUSSION_GROUP_ID

    if kind == "dm":
        if uid != admin_id:
            return _deny("dm_not_admin", {"userId": uid})
        return {"allow": True}

    if kind == "channel":
        return _deny("channel_is_post_only", {"chatId": cid})

    if kind == "group":
        if cid != group_id:
            return _deny("group_not_allowlisted", {"chatId": cid})
        if not is_mention:
            return _deny("group_no_mention", {"chatId": cid, "userId": uid})
        if not is_trusted_reader(uid):
            return _deny("user_not_trusted", {"userId": uid})
        return {"allow": True}

    return _deny("unknown_kind", {"kind": kind})


def is_admin(user_id) -> bool:
    return str(user_id) == load_env().ADMIN_TG_USER_ID


def is_trusted_reader(user_id) -> bool:
    if is_admin(user_id):
        return True
    from .db import open_db
    row = open_db().execute(
        "SELECT 1 FROM trusted_readers WHERE user_id = ?", (str(user_id),)
    ).fetchone()
    return row is not None


def add_trusted_reader(user_id, by: str) -> None:
    from .db import open_db
    db = open_db()
    db.execute(
        "INSERT OR IGNORE INTO trusted_readers (user_id, added_by, added_at) VALUES (?, ?, datetime('now'))",
        (str(user_id), by),
    )
    db.commit()


def remove_trusted_reader(user_id) -> None:
    from .db import open_db
    db = open_db()
    db.execute("DELETE FROM trusted_readers WHERE user_id = ?", (str(user_id),))
    db.commit()


def _deny(reason: str, ctx: dict) -> dict:
    log.warn({"reason": reason, **ctx}, "access_denied")
    _bump_deny_metric(reason)
    return {"allow": False, "reason": reason}


def _bump_deny_metric(reason: str) -> None:
    try:
        from .db import open_db
        db = open_db()
        db.execute(
            """INSERT INTO access_denies (reason, ts, count)
               VALUES (?, datetime('now'), 1)
               ON CONFLICT(reason, day) DO UPDATE SET count = count + 1""",
            (reason,),
        )
        db.commit()
    except Exception:
        pass
