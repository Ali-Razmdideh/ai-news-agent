import { Agent, ProxyAgent, fetch, setGlobalDispatcher, type Dispatcher, type RequestInit } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { log } from "./log.js";

const DEFAULT_ALLOW_HOSTS: ReadonlyArray<string> = [
  // Academic
  "arxiv.org",
  "export.arxiv.org",
  "api.openalex.org",
  "openreview.net",
  "paperswithcode.com",

  // Code hosting
  "api.github.com",
  "github.com",
  "raw.githubusercontent.com",

  // Aggregators
  "hn.algolia.com",
  "www.reddit.com",
  "old.reddit.com",

  // Frontier labs
  "anthropic.com",
  "www.anthropic.com",
  "openai.com",
  "blog.openai.com",
  "deepmind.google",
  "deepmind.com",
  "ai.googleblog.com",
  "research.google",
  "ai.meta.com",
  "mistral.ai",
  "cohere.com",

  // Platforms / tooling
  "huggingface.co",
  "developer.nvidia.com",
  "pytorch.org",

  // Academic / lab blogs
  "bair.berkeley.edu",
  "hai.stanford.edu",
  "news.mit.edu",

  // High-signal individuals & newsletters
  "lilianweng.github.io",
  "simonwillison.net",
  "karpathy.github.io",
  "karpathy.bearblog.dev",
  "magazine.sebastianraschka.com",
  "www.interconnects.ai",
  "interconnects.ai",
  "www.oneusefulthing.org",
  "oneusefulthing.org",
  "importai.substack.com",
  "www.aisnakeoil.com",
  "aisnakeoil.com",
  "huyenchip.com",
  "eugeneyan.com",
  "vickiboykis.com",
  "www.latent.space",
  "latent.space",
  "thegradient.pub",
  "tldr.tech",
  "stratechery.com",

  // LLM/embedding APIs
  "api.voyageai.com",
  "api.anthropic.com",
  "api.openai.com",
];

export type SafeFetchOptions = RequestInit & {
  /** Extra hosts to allow for this call only. */
  allowExtra?: ReadonlyArray<string>;
  /** Per-call timeout in ms. Default 15_000. */
  timeoutMs?: number;
  /** Max bytes to download. Default 5 MiB. */
  maxBytes?: number;
};

const PRIVATE_RANGES: Array<[bigint, bigint]> = [
  // 10.0.0.0/8
  [ipToInt("10.0.0.0"), ipToInt("10.255.255.255")],
  // 127.0.0.0/8
  [ipToInt("127.0.0.0"), ipToInt("127.255.255.255")],
  // 169.254.0.0/16
  [ipToInt("169.254.0.0"), ipToInt("169.254.255.255")],
  // 172.16.0.0/12
  [ipToInt("172.16.0.0"), ipToInt("172.31.255.255")],
  // 192.168.0.0/16
  [ipToInt("192.168.0.0"), ipToInt("192.168.255.255")],
  // 0.0.0.0/8
  [ipToInt("0.0.0.0"), ipToInt("0.255.255.255")],
];

function ipToInt(ip: string): bigint {
  return ip.split(".").reduce((acc, oct) => (acc << 8n) | BigInt(Number(oct)), 0n);
}

function isPrivateV4(ip: string): boolean {
  const n = ipToInt(ip);
  return PRIVATE_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

const DEFAULT_ALLOW_LC: ReadonlyArray<string> = DEFAULT_ALLOW_HOSTS.map((s) => s.toLowerCase());

function hostAllowed(host: string, extra: ReadonlyArray<string>): boolean {
  const h = host.toLowerCase();
  const matches = (a: string): boolean => h === a || h.endsWith(`.${a}`);
  if (DEFAULT_ALLOW_LC.some(matches)) return true;
  for (const e of extra) if (matches(e.toLowerCase())) return true;
  return false;
}

const MAX_REDIRECTS = 3;

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * Build the outbound dispatcher.
 *
 *  - If HTTPS_PROXY / HTTP_PROXY is set in the environment, route through a
 *    ProxyAgent so feed fetches, AI provider calls, and Telegram API calls
 *    all egress via the configured proxy.
 *  - Otherwise use a direct Agent with bounded timeouts.
 *
 * Note: the Anthropic and OpenAI SDKs honor HTTPS_PROXY natively; this helper
 * is what wires the proxy through *our* undici-based safeFetch. It also
 * installs the proxy as undici's global dispatcher so other libraries that
 * use global undici/fetch (e.g. Telegram clients) inherit it automatically.
 */
function buildDispatcher(): Dispatcher {
  const proxyUrl =
    process.env["HTTPS_PROXY"] ||
    process.env["https_proxy"] ||
    process.env["HTTP_PROXY"] ||
    process.env["http_proxy"];
  if (proxyUrl) {
    log.info({ proxy: redactProxy(proxyUrl) }, "http_dispatcher_proxy");
    const agent = new ProxyAgent({
      uri: proxyUrl,
      requestTls: { timeout: 10_000 },
      connect: { timeout: 5_000 },
      headersTimeout: 30_000,
      bodyTimeout: 60_000,
    });
    try {
      setGlobalDispatcher(agent);
    } catch {
      // Fine — older undici versions or test envs.
    }
    return agent;
  }
  return new Agent({
    connect: { timeout: 5_000 },
    headersTimeout: 10_000,
    bodyTimeout: 15_000,
    maxRedirections: 0,
  });
}

function redactProxy(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "***";
    }
    return u.toString();
  } catch {
    return "<invalid>";
  }
}

const sharedAgent = buildDispatcher();

export async function safeFetch(url: string, opts: SafeFetchOptions = {}, depth = 0): Promise<Response> {
  if (depth > MAX_REDIRECTS) throw new SsrfError(`too_many_redirects:${depth}`);
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new SsrfError(`refused_protocol:${u.protocol}`);
  }
  if (u.protocol === "http:" && !["arxiv.org", "export.arxiv.org"].includes(u.hostname)) {
    // Most allowed hosts only over https; arxiv historically used http.
    throw new SsrfError(`refused_http_for:${u.hostname}`);
  }
  if (!hostAllowed(u.hostname, opts.allowExtra ?? [])) {
    throw new SsrfError(`host_not_allowlisted:${u.hostname}`);
  }
  // Resolve and check IP
  let resolvedIps: string[];
  if (isIP(u.hostname)) {
    resolvedIps = [u.hostname];
  } else {
    const records = await lookup(u.hostname, { all: true });
    resolvedIps = records.map((r) => r.address);
  }
  for (const ip of resolvedIps) {
    if (isIP(ip) === 4 && isPrivateV4(ip)) {
      throw new SsrfError(`private_ipv4:${ip}`);
    }
    if (isIP(ip) === 6 && isPrivateV6(ip)) {
      throw new SsrfError(`private_ipv6:${ip}`);
    }
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(u.toString(), {
      ...opts,
      signal: ac.signal,
      dispatcher: sharedAgent,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res as unknown as Response;
      const nextUrl = new URL(loc, u);
      log.debug({ from: url, to: nextUrl.toString(), depth }, "redirect");
      return safeFetch(nextUrl.toString(), { ...opts, timeoutMs: opts.timeoutMs ?? 15_000 }, depth + 1);
    }
    return res as unknown as Response;
  } finally {
    clearTimeout(timer);
  }
}

export async function safeFetchText(url: string, opts: SafeFetchOptions = {}): Promise<string> {
  const res = await safeFetch(url, opts);
  if (!res.ok) throw new Error(`http_${res.status}:${url}`);
  const max = opts.maxBytes ?? 5 * 1024 * 1024;
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) throw new Error(`response_too_large:${total}`);
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

export async function safeFetchJson<T = unknown>(url: string, opts: SafeFetchOptions = {}): Promise<T> {
  return JSON.parse(await safeFetchText(url, opts)) as T;
}
