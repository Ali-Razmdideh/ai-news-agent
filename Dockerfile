ARG HTTP_PROXY=
ARG HTTPS_PROXY=

# ────────────────────────────────────────────────────────────────────────────
# deps: install Python dependencies. Invalidates only when requirements change.
# ────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS deps
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# ────────────────────────────────────────────────────────────────────────────
# runtime: copy app code on top of installed deps
# ────────────────────────────────────────────────────────────────────────────
FROM deps AS runtime

RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin app

WORKDIR /app
COPY core ./core
COPY workspace ./workspace
COPY config ./config

RUN chown -R app:app /app

VOLUME ["/data", "/home/app/.openclaw"]

USER app
ENV AI_NEWS_CORE=/app
ENV PYTHONPATH=/app
ENV OPENCLAW_CONFIG_PATH=/app/config/openclaw.config.json5

CMD ["sh", "-c", "if command -v openclaw >/dev/null 2>&1; then exec openclaw gateway run --allow-unconfigured --bind loopback --auth none; else echo 'openclaw not found; sleeping'; exec sleep infinity; fi"]
