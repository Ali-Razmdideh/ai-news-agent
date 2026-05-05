"""
Skill: post-telegram

The single outbound surface for everything the bot says. Three modes:
  • --kind item   --item-id N             → post a fully-prepared item to channel
  • --kind reply  --chat-id C --reply-to M --text "<text>"  → reply in group
  • --kind admin  --text "<text>"         → DM the admin user

Output (JSON, one line on stdout):  { itemId?, msg_id }

Defense-in-depth allowlist: refuses any chat-id outside configured
channel, group, or admin. disable-model-invocation: true in SKILL.md.
"""
import sys
import os

sys.path.insert(0, os.environ.get("AI_NEWS_CORE", "/app"))

import json
from core import open_db, send_message, escape_md_v2, format_item_message, load_env, log, run_skill, cli_arg


def _assert_allowed_chat(chat_id: str) -> None:
    env = load_env()
    allowed = {env.TELEGRAM_CHANNEL_ID, env.TELEGRAM_DISCUSSION_GROUP_ID, env.ADMIN_TG_USER_ID}
    if str(chat_id) not in allowed:
        raise ValueError(f"refused_chat_id:{chat_id}")


def post_item(item_id: int) -> dict:
    db = open_db()
    row = db.execute(
        """SELECT i.id, i.url, i.title, i.source, sc.score, sc.topic, sm.tldr, sm.bullets_json
           FROM items i
           JOIN scores sc ON sc.item_id = i.id
           JOIN summaries sm ON sm.item_id = i.id
           LEFT JOIN posts p ON p.item_id = i.id
           WHERE i.id = ? AND p.item_id IS NULL""",
        (item_id,),
    ).fetchone()
    if not row:
        log.info({"itemId": item_id}, "post_skipped_already_posted_or_missing")
        return {"itemId": item_id, "msg_id": None}

    env = load_env()
    _assert_allowed_chat(env.TELEGRAM_CHANNEL_ID)

    text = format_item_message(
        title=row["title"],
        source=row["source"],
        topic=row["topic"],
        score=row["score"],
        tldr=row["tldr"],
        bullets=json.loads(row["bullets_json"]),
        url=row["url"],
    )
    res = send_message(chat_id=env.TELEGRAM_CHANNEL_ID, text=text, parse_mode="MarkdownV2")

    msg_id = res.get("message_id")
    if msg_id:
        db.execute(
            "INSERT OR IGNORE INTO posts (item_id, telegram_msg_id, chat_id, kind) VALUES (?, ?, ?, 'item')",
            (item_id, msg_id, env.TELEGRAM_CHANNEL_ID),
        )
        db.commit()
    return {"itemId": item_id, "msg_id": msg_id}


def post_reply(chat_id: str, reply_to: int, text: str) -> dict:
    _assert_allowed_chat(chat_id)
    res = send_message(
        chat_id=chat_id,
        text=escape_md_v2(text)[:3500],
        parse_mode="MarkdownV2",
        reply_to_message_id=reply_to,
    )
    return {"msg_id": res.get("message_id")}


def post_admin(text: str) -> dict:
    env = load_env()
    _assert_allowed_chat(env.ADMIN_TG_USER_ID)
    res = send_message(
        chat_id=env.ADMIN_TG_USER_ID,
        text=escape_md_v2(text)[:3500],
        parse_mode="MarkdownV2",
    )
    return {"msg_id": res.get("message_id")}


def main():
    kind = cli_arg("kind") or "item"
    if kind == "item":
        iid = cli_arg("item-id")
        if not iid or not iid.isdigit():
            raise ValueError("missing --item-id")
        return post_item(int(iid))
    if kind == "reply":
        chat = cli_arg("chat-id")
        reply_to = cli_arg("reply-to")
        text = cli_arg("text") or ""
        if not chat or not reply_to or not reply_to.isdigit() or not text:
            raise ValueError("missing reply args")
        return post_reply(chat, int(reply_to), text)
    if kind == "admin":
        return post_admin(cli_arg("text") or "")
    raise ValueError(f"unknown_kind:{kind}")


run_skill("post-telegram", main)
