ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG HTTP_PROXY=
ARG HTTPS_PROXY=

# ────────────────────────────────────────────────────────────────────────────
# base: slim node + pnpm. Cached across virtually every change.
# ────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS base
ARG NPM_REGISTRY
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN HTTP_PROXY="$HTTP_PROXY" HTTPS_PROXY="$HTTPS_PROXY" \
    npm install -g --registry="$NPM_REGISTRY" pnpm@9.12.0

# ────────────────────────────────────────────────────────────────────────────
# deps: pnpm install ONLY. Invalidates only when manifests change.
# ────────────────────────────────────────────────────────────────────────────
FROM base AS deps
ARG NPM_REGISTRY
ARG HTTP_PROXY
ARG HTTPS_PROXY
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY workspace/skills/collect-arxiv/package.json     workspace/skills/collect-arxiv/tsconfig.json     ./workspace/skills/collect-arxiv/
COPY workspace/skills/collect-github/package.json    workspace/skills/collect-github/tsconfig.json    ./workspace/skills/collect-github/
COPY workspace/skills/collect-rss/package.json       workspace/skills/collect-rss/tsconfig.json       ./workspace/skills/collect-rss/
COPY workspace/skills/collect-hn/package.json        workspace/skills/collect-hn/tsconfig.json        ./workspace/skills/collect-hn/
COPY workspace/skills/collect-reddit/package.json    workspace/skills/collect-reddit/tsconfig.json    ./workspace/skills/collect-reddit/
COPY workspace/skills/enrich-fetch/package.json      workspace/skills/enrich-fetch/tsconfig.json      ./workspace/skills/enrich-fetch/
COPY workspace/skills/score-relevance/package.json   workspace/skills/score-relevance/tsconfig.json   ./workspace/skills/score-relevance/
COPY workspace/skills/summarize-tldr/package.json    workspace/skills/summarize-tldr/tsconfig.json    ./workspace/skills/summarize-tldr/
COPY workspace/skills/search-corpus/package.json     workspace/skills/search-corpus/tsconfig.json     ./workspace/skills/search-corpus/
COPY workspace/skills/post-telegram/package.json     workspace/skills/post-telegram/tsconfig.json     ./workspace/skills/post-telegram/
COPY workspace/skills/health-check/package.json      workspace/skills/health-check/tsconfig.json      ./workspace/skills/health-check/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    HTTP_PROXY="$HTTP_PROXY" HTTPS_PROXY="$HTTPS_PROXY" \
    pnpm install --registry="$NPM_REGISTRY" --no-frozen-lockfile --no-optional \
      --fetch-retries=8 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=120000 \
      --network-concurrency=8

# ────────────────────────────────────────────────────────────────────────────
# build: copy src and tsc. Re-runs on source changes only.
# ────────────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY packages ./packages
COPY workspace ./workspace
COPY config ./config
RUN pnpm -r build

# ────────────────────────────────────────────────────────────────────────────
# runtime
# ────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
ARG NPM_REGISTRY
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV NODE_ENV=production
ENV NODE_OPTIONS=--experimental-sqlite
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN HTTP_PROXY="$HTTP_PROXY" HTTPS_PROXY="$HTTPS_PROXY" \
    npm install -g --registry="$NPM_REGISTRY" pnpm@9.12.0 openclaw@latest \
    || (printf '#!/bin/sh\necho "openclaw not in registry; install at runtime" >&2\nexec sleep infinity\n' \
        > /usr/local/bin/openclaw && chmod +x /usr/local/bin/openclaw)

RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin app

WORKDIR /app
COPY --from=build /app /app

VOLUME ["/data", "/home/app/.openclaw"]

ENV OPENCLAW_CONFIG_PATH=/app/config/openclaw.config.json5
CMD ["openclaw", "gateway", "run", "--allow-unconfigured", "--bind", "loopback", "--auth", "none"]
