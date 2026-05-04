# STARTUP (one-shot at gateway boot)

1. Run DB migrations (`packages/core/db.ts#migrate`).
2. Verify `sqlite-vec` extension loads.
3. Validate `openclaw.config.json5` against the iron rules in `MEMORY.md`.
4. `health-check`. If green: send admin DM "🐧 booted v<version> @ <ts>".
5. If red: log JSON error and exit non-zero (Docker will restart with backoff).
