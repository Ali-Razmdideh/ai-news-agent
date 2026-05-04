import pino from "pino";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[a-zA-Z0-9_-]{20,}/g, "sk-ant-***"],
  [/[0-9]{8,12}:[A-Za-z0-9_-]{30,}/g, "tg-bot-***"], // Telegram bot token
  [/ghp_[A-Za-z0-9]{30,}/g, "ghp_***"],
  [/pa-[A-Za-z0-9_-]{20,}/g, "pa-***"], // Voyage
];

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [re, repl] of SECRET_PATTERNS) out = out.replace(re, repl);
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|key|authorization/i.test(k)) out[k] = "***";
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "ai-news" },
  formatters: {
    log(obj) {
      return redact(obj) as Record<string, unknown>;
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
