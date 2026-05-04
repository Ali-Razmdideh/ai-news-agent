/**
 * Telegram MarkdownV2 escaping + scrubbing for prompt-injection vectors.
 * https://core.telegram.org/bots/api#markdownv2-style
 */
const SPECIAL = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

export function escapeMdV2(text: string): string {
  return text.replace(SPECIAL, "\\$1");
}

/** Wrap an untrusted (fetched / user-provided) string for LLM input. */
export function untrusted(label: string, text: string): string {
  const safe = text
    .replace(/<\/?untrusted_source[^>]*>/gi, "[redacted-tag]")
    .slice(0, 32_000);
  return `<untrusted_source name="${label}">\n${safe}\n</untrusted_source>`;
}

/** Strip suspicious markdown links + zero-width chars before showing to LLM. */
export function scrubForModel(text: string): string {
  return text
    .replace(/[​-‏‪-‮⁠﻿]/g, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "[image]")
    .slice(0, 32_000);
}

export type DigestPost = {
  title: string;
  source: string;
  topic: string;
  score: number;
  tldr: string;
  bullets: string[];
  url: string;
};

const ZeroWidth = /[​-‏‪-‮⁠﻿]/g;

function clean(s: string): string {
  return s.replace(ZeroWidth, "").trim();
}

export function formatItemMessage(p: DigestPost): string {
  const title = escapeMdV2(clean(p.title));
  const source = escapeMdV2(clean(p.source));
  const topic = escapeMdV2(clean(p.topic));
  const score = escapeMdV2(p.score.toFixed(0));
  const tldr = escapeMdV2(clean(p.tldr));
  const bullets = p.bullets
    .slice(0, 3)
    .map((b) => `• ${escapeMdV2(clean(b))}`)
    .join("\n");
  // URL inside () must have ) and \ escaped
  const url = p.url.replace(/[\\)]/g, (c) => `\\${c}`);
  return [
    `*${title}*`,
    `_${source} · ${topic} · score ${score}/10_`,
    "",
    tldr,
    "",
    bullets,
    "",
    `🔗 [link](${url})`,
  ].join("\n");
}
