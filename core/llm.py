from __future__ import annotations
import os
from typing import Literal, NamedTuple, Optional
from .env import load_env
from .log import log

Tier = Literal["low", "mid", "high"]

DEFAULTS: dict[str, dict[str, str]] = {
    "anthropic": {
        "low": "claude-haiku-4-5",
        "mid": "claude-sonnet-4-6",
        "high": "claude-opus-4-7",
    },
    "openai": {
        "low": "gpt-5-mini",
        "mid": "gpt-5-mini",
        "high": "gpt-5",
    },
}


def model_for(tier: Tier) -> str:
    env = load_env()
    override = {"low": env.MODEL_LOW, "mid": env.MODEL_MID, "high": env.MODEL_HIGH}.get(tier, "")
    if override:
        return override
    return DEFAULTS[env.LLM_PROVIDER][tier]


class CompleteArgs(NamedTuple):
    tier: Tier
    system: str
    user: str
    stage: str
    max_tokens: int = 1024
    temperature: float = 0.2


class CompleteResult(NamedTuple):
    text: str
    tokens_in: int
    tokens_out: int
    model: str
    provider: str


def _get_proxy() -> Optional[str]:
    return (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or
            os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy"))


def _anthropic_client():
    import anthropic
    import httpx
    proxy = _get_proxy()
    if proxy:
        transport = httpx.HTTPTransport(proxy=proxy)
        http_client = httpx.Client(transport=transport)
        return anthropic.Anthropic(api_key=load_env().ANTHROPIC_API_KEY, http_client=http_client)
    return anthropic.Anthropic(api_key=load_env().ANTHROPIC_API_KEY)


def _openai_client():
    import openai
    import httpx
    proxy = _get_proxy()
    if proxy:
        transport = httpx.HTTPTransport(proxy=proxy)
        http_client = httpx.Client(transport=transport)
        return openai.OpenAI(api_key=load_env().OPENAI_API_KEY, http_client=http_client)
    return openai.OpenAI(api_key=load_env().OPENAI_API_KEY)


def complete(args: CompleteArgs) -> CompleteResult:
    from .budget import is_over_budget, record_usage
    if is_over_budget():
        raise RuntimeError("daily_token_budget_exceeded")

    env = load_env()
    model = model_for(args.tier)
    provider = env.LLM_PROVIDER

    if provider == "anthropic":
        client = _anthropic_client()
        resp = client.messages.create(
            model=model,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
            system=[{"type": "text", "text": args.system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": args.user}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text")
        usage = resp.usage
        tokens_in = usage.input_tokens + getattr(usage, "cache_read_input_tokens", 0) + getattr(usage, "cache_creation_input_tokens", 0)
        tokens_out = usage.output_tokens
        record_usage(model=model, stage=args.stage, tokens_in=tokens_in, tokens_out=tokens_out)
        return CompleteResult(text=text, tokens_in=tokens_in, tokens_out=tokens_out, model=model, provider=provider)

    # OpenAI — Responses API; gpt-5 reasoning models reject temperature
    client = _openai_client()
    resp = client.responses.create(
        model=model,
        instructions=args.system,
        input=args.user,
        max_output_tokens=max(args.max_tokens, 1024),
        reasoning={"effort": "low"},
    )
    text = getattr(resp, "output_text", "") or ""
    usage = getattr(resp, "usage", None)
    tokens_in = getattr(usage, "input_tokens", 0) if usage else 0
    tokens_out = getattr(usage, "output_tokens", 0) if usage else 0
    record_usage(model=model, stage=args.stage, tokens_in=tokens_in, tokens_out=tokens_out)
    return CompleteResult(text=text, tokens_in=tokens_in, tokens_out=tokens_out, model=model, provider=provider)
