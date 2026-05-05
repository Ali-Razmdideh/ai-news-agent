import math
from .env import load_env
from .http import safe_fetch_json

_MODEL = "voyage-3-lite"


def embed(texts: list[str]) -> list[list[float]]:
    env = load_env()
    if not env.VOYAGE_API_KEY:
        # Zero-vector fallback for dev/test environments without Voyage.
        return [[0.0] * 256 for _ in texts]

    res = safe_fetch_json(
        "https://api.voyageai.com/v1/embeddings",
        method="POST",
        headers={"authorization": f"Bearer {env.VOYAGE_API_KEY}"},
        json_body={
            "model": _MODEL,
            "input": texts,
            "output_dimension": 256,
            "output_dtype": "float",
        },
        timeout_ms=20_000,
    )
    return [d["embedding"] for d in res["data"]]


def cosine(a: list[float], b: list[float]) -> float:
    dot = na = nb = 0.0
    for ai, bi in zip(a, b):
        dot += ai * bi
        na += ai * ai
        nb += bi * bi
    if na == 0 or nb == 0:
        return 0.0
    return dot / math.sqrt(na * nb)
