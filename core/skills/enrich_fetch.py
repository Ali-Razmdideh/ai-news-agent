"""
Skill: enrich-fetch

Given an item-id, fetches the item's URL, strips HTML to plain text, and
stores the result in items.raw_body. Used when a collector produces a thin
item (title + link only, no body content).

Output (JSON, one line on stdout):
  { id, fetched: true,  bytes }     — body populated
  { id, fetched: false, reason }    — skipped (already had body)

Network egress is gated by the SSRF allowlist in core/http.py.
No LLM calls; disable-model-invocation: true in SKILL.md.
"""

import re
from core import open_db, safe_fetch_text, run_skill, cli_arg


def html_to_text(html: str) -> str:
    """Minimal HTML-to-text: drop script/style bodies, strip tags, decode entities."""
    html = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    html = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.IGNORECASE)
    html = re.sub(r"<[^>]+>", " ", html)
    html = (
        html.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    html = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), html)
    return re.sub(r"\s+", " ", html).strip()[:16_000]


def main():
    item_id = cli_arg("item-id")
    if not item_id or not item_id.isdigit():
        raise ValueError("missing --item-id")
    item_id = int(item_id)

    db = open_db()
    row = db.execute(
        "SELECT id, url, raw_body FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if not row:
        raise ValueError(f"item_not_found:{item_id}")

    # Idempotency guard — skip if body already substantial.
    if row["raw_body"] and len(row["raw_body"]) > 200:
        return {"id": item_id, "fetched": False, "reason": "already_has_body"}

    text = html_to_text(
        safe_fetch_text(row["url"], timeout_ms=15_000, max_bytes=3 * 1024 * 1024)
    )
    db.execute("UPDATE items SET raw_body = ? WHERE id = ?", (text, item_id))
    db.commit()
    return {"id": item_id, "fetched": True, "bytes": len(text)}


if __name__ == "__main__":
    run_skill("enrich-fetch", main)
