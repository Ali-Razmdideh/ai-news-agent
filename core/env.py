import os
from functools import lru_cache
from dataclasses import dataclass


@dataclass(frozen=True)
class AppEnv:
    LLM_PROVIDER: str
    ANTHROPIC_API_KEY: str
    OPENAI_API_KEY: str
    MODEL_LOW: str
    MODEL_MID: str
    MODEL_HIGH: str
    TELEGRAM_BOT_TOKEN: str
    TELEGRAM_CHANNEL_ID: str
    TELEGRAM_DISCUSSION_GROUP_ID: str
    ADMIN_TG_USER_ID: str
    GITHUB_TOKEN: str
    VOYAGE_API_KEY: str
    AI_NEWS_DB: str
    DAILY_TOKEN_BUDGET: int
    MAX_POSTS_PER_HOUR: int
    QA_PER_USER_PER_HOUR: int
    TIMEZONE: str
    DRY_RUN: int


@lru_cache(maxsize=1)
def load_env() -> AppEnv:
    provider = os.environ.get("LLM_PROVIDER", "anthropic")
    if provider not in ("anthropic", "openai"):
        raise ValueError(
            f"LLM_PROVIDER must be 'anthropic' or 'openai', got: {provider}"
        )

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")

    if provider == "anthropic" and not anthropic_key:
        raise ValueError("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty")
    if provider == "openai" and not openai_key:
        raise ValueError("LLM_PROVIDER=openai but OPENAI_API_KEY is empty")

    def req(name: str) -> str:
        v = os.environ.get(name, "")
        if not v:
            raise ValueError(f"Required env var {name} is missing or empty")
        return v

    return AppEnv(
        LLM_PROVIDER=provider,
        ANTHROPIC_API_KEY=anthropic_key,
        OPENAI_API_KEY=openai_key,
        MODEL_LOW=os.environ.get("MODEL_LOW", ""),
        MODEL_MID=os.environ.get("MODEL_MID", ""),
        MODEL_HIGH=os.environ.get("MODEL_HIGH", ""),
        TELEGRAM_BOT_TOKEN=req("TELEGRAM_BOT_TOKEN"),
        TELEGRAM_CHANNEL_ID=req("TELEGRAM_CHANNEL_ID"),
        TELEGRAM_DISCUSSION_GROUP_ID=req("TELEGRAM_DISCUSSION_GROUP_ID"),
        ADMIN_TG_USER_ID=req("ADMIN_TG_USER_ID"),
        GITHUB_TOKEN=os.environ.get("GITHUB_TOKEN", ""),
        VOYAGE_API_KEY=os.environ.get("VOYAGE_API_KEY", ""),
        AI_NEWS_DB=os.environ.get("AI_NEWS_DB", "/data/news.db"),
        DAILY_TOKEN_BUDGET=int(os.environ.get("DAILY_TOKEN_BUDGET", "2000000")),
        MAX_POSTS_PER_HOUR=int(os.environ.get("MAX_POSTS_PER_HOUR", "8")),
        QA_PER_USER_PER_HOUR=int(os.environ.get("QA_PER_USER_PER_HOUR", "10")),
        TIMEZONE=os.environ.get("TIMEZONE", "Asia/Tehran"),
        DRY_RUN=int(os.environ.get("DRY_RUN", "0")),
    )
