import sys
import re
import json
from datetime import datetime, timezone
from typing import Optional, Any, Callable, TypeVar
from .log import log

T = TypeVar("T")


def cli_arg(name: str) -> Optional[str]:
    """Return the value of --name from sys.argv, or None."""
    key = f"--{name}"
    try:
        i = sys.argv.index(key)
        return sys.argv[i + 1]
    except (ValueError, IndexError):
        return None


def xml_match(block: str, pattern: str) -> str:
    m = re.search(pattern, block, re.DOTALL)
    return (m.group(1) if m else "").strip()


def parse_json_block(text: str) -> Any:
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError("no_json")
    return json.loads(m.group())


def to_iso(value) -> Optional[str]:
    """Normalize any date string / unix timestamp to ISO 8601, or return None."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        try:
            return (
                datetime.fromtimestamp(value, tz=timezone.utc)
                .isoformat()
                .replace("+00:00", "Z")
            )
        except Exception:
            return None
    s = str(value).strip()
    if not s:
        return None
    # Try RFC 2822 (email format, used by RSS)
    try:
        from email.utils import parsedate_to_datetime

        dt = parsedate_to_datetime(s)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        pass
    # Try ISO 8601 variants
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        pass
    return None


def run_skill(name: str, fn: Callable[[], Any]) -> None:
    """Execute fn(), write JSON result to stdout, exit 1 on failure."""
    try:
        out = fn()
        log.info({name: True, **(out if isinstance(out, dict) else {})}, f"{name}_done")
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()
    except Exception as e:
        log.error({"name": name, "err": str(e)}, f"{name}_failed")
        sys.exit(1)
