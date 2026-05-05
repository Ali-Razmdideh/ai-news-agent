from typing import Optional
from .env import load_env
from .http import safe_fetch_json
from .log import log

_ALLOW_EXTRA = ["api.telegram.org"]


def _tg_call(method: str, body: dict):
    env = load_env()
    if env.DRY_RUN == 1:
        log.info({"method": method, "body": body}, "telegram_dry_run")
        return {"dryRun": True}
    url = f"https://api.telegram.org/bot{env.TELEGRAM_BOT_TOKEN}/{method}"
    res = safe_fetch_json(
        url,
        method="POST",
        json_body=body,
        allow_extra=_ALLOW_EXTRA,
        timeout_ms=10_000,
    )
    if not res.get("ok"):
        code = res.get("error_code", "?")
        desc = res.get("description", "unknown")
        raise Exception(f"telegram_{code}:{desc}")
    return res["result"]


def send_message(
    *,
    chat_id,
    text: str,
    parse_mode: str = "MarkdownV2",
    reply_to_message_id: Optional[int] = None,
    disable_web_page_preview: bool = False,
) -> dict:
    body = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": disable_web_page_preview,
        "allow_sending_without_reply": True,
    }
    if reply_to_message_id is not None:
        body["reply_to_message_id"] = reply_to_message_id
    return _tg_call("sendMessage", body)


def get_me() -> dict:
    return _tg_call("getMe", {})
