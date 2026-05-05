"""
Skill: health-check

One-shot self-test. Verifies, in order:
  1. Env parses (load_env validation).
  2. SQLite opens, migrations applied.
  3. openclaw.config.json5 still has dmPolicy=allowlist and
     groupPolicy=(allowlist|disabled). Iron-rule guard.
  4. Today's token usage is under DAILY_TOKEN_BUDGET.
  5. Telegram bot reachable (/getMe), unless DRY_RUN=1.

Output (JSON, one line on stdout):  { ok, checks: [...], errors: [...] }

On any failure, DMs the admin and exits 1 so the cron tick skips. On
unexpected crashes exits 2.
"""
import sys
import os

sys.path.insert(0, os.environ.get("AI_NEWS_CORE", "/app"))

import re
import json


def first_match(pattern: str, text: str):
    m = re.search(pattern, text)
    return m.group(1) if m else None


def run():
    checks = []
    errors = []
    env = None

    # ── 1. env ────────────────────────────────────────────────────────────────
    try:
        from core import load_env
        env = load_env()
        checks.append({"name": "env", "ok": True})
    except Exception as e:
        checks.append({"name": "env", "ok": False, "detail": str(e)})
        errors.append(f"env:{e}")

    # ── 2. db ─────────────────────────────────────────────────────────────────
    try:
        from core import open_db
        db = open_db()
        row = db.execute("SELECT COUNT(*) AS n FROM _migrations").fetchone()
        n = row["n"] if row else 0
        if n < 1:
            raise RuntimeError("no migrations applied")
        checks.append({"name": "db", "ok": True, "detail": f"migrations={n}"})
    except Exception as e:
        checks.append({"name": "db", "ok": False, "detail": str(e)})
        errors.append(f"db:{e}")

    # ── 3. allowlist config ───────────────────────────────────────────────────
    # Line-grep instead of JSON5 parsing so this works even on parse errors.
    try:
        cfg_path = os.environ.get("OPENCLAW_CONFIG", os.path.join(os.getcwd(), "config/openclaw.config.json5"))
        with open(cfg_path, "r", encoding="utf-8") as f:
            raw = f.read()
        dm = first_match(r'"?dmPolicy"?\s*:\s*"([^"]+)"', raw)
        gp = first_match(r'"?groupPolicy"?\s*:\s*"([^"]+)"', raw)
        if dm != "allowlist":
            raise RuntimeError(f"dmPolicy={dm}")
        if gp not in ("allowlist", "disabled"):
            raise RuntimeError(f"groupPolicy={gp}")
        checks.append({"name": "allowlist_config", "ok": True, "detail": f"dm={dm} group={gp}"})
    except Exception as e:
        checks.append({"name": "allowlist_config", "ok": False, "detail": str(e)})
        errors.append(f"allowlist_config:{e}")

    # ── 4. budget ─────────────────────────────────────────────────────────────
    try:
        from core.budget import tokens_today, is_over_budget
        used = tokens_today()
        over = is_over_budget()
        checks.append({"name": "budget", "ok": not over, "detail": f"tokens_today={used} over={over}"})
        if over:
            errors.append("budget_exceeded")
    except Exception as e:
        checks.append({"name": "budget", "ok": False, "detail": str(e)})
        errors.append(f"budget:{e}")

    # ── 5. telegram reachability ──────────────────────────────────────────────
    try:
        if env and env.DRY_RUN == 1:
            checks.append({"name": "telegram", "ok": True, "detail": "skipped (DRY_RUN)"})
        else:
            from core import get_me
            me = get_me()
            bot_name = me.get("username") or me.get("id", "?")
            checks.append({"name": "telegram", "ok": True, "detail": f"bot={bot_name}"})
    except Exception as e:
        checks.append({"name": "telegram", "ok": False, "detail": str(e)})
        errors.append(f"telegram:{e}")

    # ── Report ────────────────────────────────────────────────────────────────
    ok = len(errors) == 0
    sys.stdout.write(json.dumps({"ok": ok, "checks": checks, "errors": errors}) + "\n")
    sys.stdout.flush()

    # Failure path: notify admin (best-effort).
    if not ok and env and env.DRY_RUN != 1:
        try:
            from core import send_message, escape_md_v2
            lines = "\n".join(f"• {e}" for e in errors)
            send_message(
                chat_id=env.ADMIN_TG_USER_ID,
                text=f"*health\\-check failed*\n{escape_md_v2(lines)}",
                parse_mode="MarkdownV2",
            )
        except Exception as e:
            from core import log
            log.error({"err": str(e)}, "admin_dm_failed")

    if not ok:
        sys.exit(1)


try:
    run()
except Exception as e:
    try:
        from core import log
        log.error({"err": str(e)}, "health_check_crashed")
    except Exception:
        pass
    sys.exit(2)
