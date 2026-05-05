# ────────────────────────────────────────────────────────────────────────────
# Stage 1: python:3.12-slim — install Python packages
# ────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS python-deps

ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /pkg
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --target=/pkg/site

# ────────────────────────────────────────────────────────────────────────────
# Stage 2: node:22-slim + Python runtime + openclaw + skills
# Both node:22-slim and python:3.12-slim are Debian Bookworm — libs compatible.
# ────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY}

# Upgrade base packages to patch high CVEs in slim base image
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Copy the entire Python 3.12 runtime from the python image
COPY --from=python:3.12-slim /usr/local/bin/python3.12 /usr/local/bin/python3.12
COPY --from=python:3.12-slim /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=python:3.12-slim /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/libpython3.12.so.1.0

RUN ln -sf /usr/local/bin/python3.12 /usr/local/bin/python3 \
 && ln -sf /usr/local/bin/python3.12 /usr/local/bin/python \
 && ldconfig

# Copy pre-built Python packages from stage 1
COPY --from=python-deps /pkg/site /usr/local/lib/python3.12/dist-packages

# Install openclaw via the official install script
RUN curl -fsSL https://openclaw.ai/install.sh | bash -s -- --version 2026.5.2

# Non-root user
RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin app

WORKDIR /app
COPY core ./core
COPY workspace ./workspace
COPY config ./config

# Seed the cron jobs into the openclaw state skeleton so they are
# available on first boot (the named volume is empty on first mount).
RUN mkdir -p /home/app/.openclaw/cron \
 && cp /app/config/cron/jobs.json /home/app/.openclaw/cron/jobs.json

# Pre-create writable dirs with correct ownership so named volumes inherit them
RUN mkdir -p /data \
 && chown -R app:app /app /data /home/app/.openclaw

VOLUME ["/data", "/home/app/.openclaw"]

USER app

ENV PYTHONPATH=/app
ENV AI_NEWS_CORE=/app
ENV OPENCLAW_CONFIG_PATH=/app/config/openclaw.config.json5
ENV AI_NEWS_DB=/data/news.db

CMD ["openclaw", "gateway", "run", "--allow-unconfigured"]
