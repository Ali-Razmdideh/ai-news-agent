import re

_SPECIAL = re.compile(r"([_*\[\]()~`>#+\-=|{}.!\\])")
_ZERO_WIDTH = re.compile("[\u200b-\u200f\u202a-\u202e\u2060\ufeff]")
_IMAGE_LINK = re.compile(r"!\[[^\]]*]\([^)]+\)")


def escape_md_v2(text: str) -> str:
    return _SPECIAL.sub(r"\\\1", text)


def untrusted(label: str, text: str) -> str:
    safe = re.sub(
        r"</?untrusted_source[^>]*>", "[redacted-tag]", text, flags=re.IGNORECASE
    )
    safe = safe[:32_000]
    return f'<untrusted_source name="{label}">\n{safe}\n</untrusted_source>'


def scrub_for_model(text: str) -> str:
    text = _ZERO_WIDTH.sub("", text)
    text = _IMAGE_LINK.sub("[image]", text)
    # Defence-in-depth: strip injection tags before untrusted() wraps them.
    text = re.sub(
        r"</?untrusted_source[^>]*>", "[redacted-tag]", text, flags=re.IGNORECASE
    )
    return text[:32_000]


def _clean(s: str) -> str:
    return _ZERO_WIDTH.sub("", s).strip()


def format_item_message(
    title: str,
    source: str,
    topic: str,
    score: float,
    tldr: str,
    bullets: list[str],
    url: str,
) -> str:
    t = escape_md_v2(_clean(title))
    src = escape_md_v2(_clean(source))
    tpc = escape_md_v2(_clean(topic))
    sc = escape_md_v2(str(round(score)))
    tl = escape_md_v2(_clean(tldr))
    bullet_lines = "\n".join(f"• {escape_md_v2(_clean(b))}" for b in bullets[:3])
    # URL inside () must have ) and \ escaped
    safe_url = re.sub(r"[\\)]", lambda m: f"\\{m.group()}", url)
    return "\n".join(
        [
            f"*{t}*",
            f"_{src} · {tpc} · score {sc}/10_",
            "",
            tl,
            "",
            bullet_lines,
            "",
            f"🔗 [link]({safe_url})",
        ]
    )
