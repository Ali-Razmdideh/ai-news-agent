import os
import socket
import ipaddress
from typing import Optional
import httpx
from .log import log

DEFAULT_ALLOW_HOSTS = frozenset([
    # Academic
    "arxiv.org", "export.arxiv.org", "api.openalex.org",
    "openreview.net", "paperswithcode.com",
    # Code hosting
    "api.github.com", "github.com", "raw.githubusercontent.com",
    # Aggregators
    "hn.algolia.com", "www.reddit.com", "old.reddit.com",
    # Frontier labs
    "anthropic.com", "www.anthropic.com", "openai.com", "blog.openai.com",
    "deepmind.google", "deepmind.com", "ai.googleblog.com", "research.google",
    "ai.meta.com", "mistral.ai", "cohere.com",
    # Platforms / tooling
    "huggingface.co", "developer.nvidia.com", "pytorch.org",
    # Academic / lab blogs
    "bair.berkeley.edu", "hai.stanford.edu", "news.mit.edu",
    # High-signal individuals & newsletters
    "lilianweng.github.io", "simonwillison.net", "karpathy.github.io",
    "karpathy.bearblog.dev", "magazine.sebastianraschka.com",
    "www.interconnects.ai", "interconnects.ai", "www.oneusefulthing.org",
    "oneusefulthing.org", "importai.substack.com", "www.aisnakeoil.com",
    "aisnakeoil.com", "huyenchip.com", "eugeneyan.com", "vickiboykis.com",
    "www.latent.space", "latent.space", "thegradient.pub", "tldr.tech",
    "stratechery.com",
    # LLM/embedding APIs
    "api.voyageai.com", "api.anthropic.com", "api.openai.com",
])

PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("fc00::/7"),
]


class SsrfError(Exception):
    pass


def _proxy_configured() -> bool:
    return bool(
        os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or
        os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
    )


def _get_proxy_url() -> Optional[str]:
    return (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or
            os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy"))


def _is_private(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in net for net in PRIVATE_NETWORKS)
    except ValueError:
        return False


def _host_allowed(host: str, allow_extra: list[str] = ()) -> bool:
    h = host.lower()
    def matches(a: str) -> bool:
        return h == a or h.endswith(f".{a}")
    if any(matches(a) for a in DEFAULT_ALLOW_HOSTS):
        return True
    return any(matches(e.lower()) for e in allow_extra)


def _build_client(timeout: float = 15.0) -> httpx.Client:
    proxy = _get_proxy_url()
    return httpx.Client(
        proxy=proxy,
        timeout=timeout,
        follow_redirects=False,
        limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
    )


def safe_fetch(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[dict] = None,
    content: Optional[bytes] = None,
    allow_extra: list[str] = (),
    timeout_ms: int = 15_000,
    max_bytes: int = 5 * 1024 * 1024,
    _depth: int = 0,
) -> httpx.Response:
    if _depth > 3:
        raise SsrfError(f"too_many_redirects:{_depth}")

    parsed = httpx.URL(url)
    if parsed.scheme not in ("https", "http"):
        raise SsrfError(f"refused_protocol:{parsed.scheme}")
    if parsed.scheme == "http" and parsed.host not in ("arxiv.org", "export.arxiv.org"):
        raise SsrfError(f"refused_http_for:{parsed.host}")
    if not _host_allowed(parsed.host, allow_extra):
        raise SsrfError(f"host_not_allowlisted:{parsed.host}")

    # Skip DNS private-IP check when a proxy is configured — censored networks
    # (Iran DPI) poison public hostnames to RFC1918 sinkholes.
    if not _proxy_configured():
        try:
            infos = socket.getaddrinfo(parsed.host, None)
            for info in infos:
                ip_str = info[4][0]
                if _is_private(ip_str):
                    raise SsrfError(f"private_ip:{ip_str}")
        except SsrfError:
            raise
        except OSError:
            pass  # DNS failure — let the HTTP call fail naturally

    with _build_client(timeout=timeout_ms / 1000) as client:
        resp = client.request(
            method,
            url,
            headers=headers or {},
            content=content,
        )

    if resp.is_redirect:
        loc = resp.headers.get("location", "")
        if not loc:
            return resp
        next_url = str(httpx.URL(url).copy_with()).rstrip("/")
        next_url = str(parsed.copy_merge_with(httpx.URL(loc)))
        log.debug({"from": url, "to": next_url, "depth": _depth}, "redirect")
        return safe_fetch(
            next_url,
            method=method,
            headers=headers,
            content=content,
            allow_extra=allow_extra,
            timeout_ms=timeout_ms,
            max_bytes=max_bytes,
            _depth=_depth + 1,
        )

    return resp


def safe_fetch_text(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[dict] = None,
    content: Optional[bytes] = None,
    allow_extra: list[str] = (),
    timeout_ms: int = 15_000,
    max_bytes: int = 5 * 1024 * 1024,
) -> str:
    resp = safe_fetch(
        url, method=method, headers=headers, content=content,
        allow_extra=allow_extra, timeout_ms=timeout_ms, max_bytes=max_bytes,
    )
    if not resp.is_success:
        raise Exception(f"http_{resp.status_code}:{url}")
    text = resp.text
    if len(text.encode()) > max_bytes:
        raise Exception(f"response_too_large:{len(text.encode())}")
    return text


def safe_fetch_json(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[dict] = None,
    json_body=None,
    allow_extra: list[str] = (),
    timeout_ms: int = 15_000,
    max_bytes: int = 5 * 1024 * 1024,
):
    import json
    content = None
    req_headers = dict(headers or {})
    if json_body is not None:
        content = json.dumps(json_body).encode()
        req_headers["content-type"] = "application/json"
    text = safe_fetch_text(
        url, method=method, headers=req_headers, content=content,
        allow_extra=allow_extra, timeout_ms=timeout_ms, max_bytes=max_bytes,
    )
    return json.loads(text)
