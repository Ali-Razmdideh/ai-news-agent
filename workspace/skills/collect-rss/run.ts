/**
 * Skill: collect-rss
 *
 * Walks every feed defined in `config/feeds.yaml` (path overridable via the
 * `FEEDS_YAML` env var) and ingests their entries into the items table.
 * Supports both RSS 2.0 and Atom transparently — we try RSS first, fall
 * back to Atom if no <item> tags were found.
 *
 * Output (JSON, one line on stdout):  { collected, fresh, errors }
 *
 * Each feed host must already be on the SSRF allowlist
 * (`packages/core/http.ts`); otherwise the fetch is refused before any
 * network IO happens.
 */
import { readFile } from "node:fs/promises";
import {
  safeFetchText,
  log,
  insertItems,
  runSkill,
  xmlMatch,
  type CollectedItem,
} from "@ai-news/core";

type Feed = { name: string; url: string };

/**
 * Tiny YAML subset parser. The feeds file only ever has the form:
 *     - name: ...
 *       url: ...
 * Pulling in a real YAML lib for that would be silly; this matches our
 * exact shape and rejects anything else by returning incomplete entries.
 */
function parseSimpleYaml(text: string): Feed[] {
  const out: Feed[] = [];
  let cur: Partial<Feed> = {};
  for (const raw of text.split("\n")) {
    // Strip inline comments + trailing whitespace; skip blank lines.
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("- ")) {
      // Start of a new feed entry — commit the previous one if complete.
      if (cur.name && cur.url) out.push(cur as Feed);
      cur = {};
      const m = line.match(/^- name:\s*(.+)$/);
      if (m && m[1]) cur.name = m[1].trim();
    } else {
      const m = line.match(/^\s*(name|url):\s*(.+)$/);
      if (m && m[1] && m[2]) {
        const key = m[1] as keyof Feed;
        cur[key] = m[2].trim();
      }
    }
  }
  // Don't forget the last entry — there's no trailing "- " to flush it.
  if (cur.name && cur.url) out.push(cur as Feed);
  return out;
}

type Entry = { id: string; title: string; link: string; summary: string; published: string };

/**
 * Parse RSS 2.0 first, then Atom if no items were found. Most feeds we
 * pull are one or the other, never mixed. CDATA is unwrapped inline by
 * the regex's optional non-capturing group.
 */
function parseFeed(xml: string): Entry[] {
  const out: Entry[] = [];

  // ── RSS 2.0 ────────────────────────────────────────────────────────────
  for (const raw of xml.split(/<item[\s>]/).slice(1)) {
    const block = raw.split("</item>")[0] ?? "";
    const title = xmlMatch(block, /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const link = xmlMatch(block, /<link>([^<]+)<\/link>/);
    // <guid> can be missing or contain the link itself; fall back to <link>.
    const guid = xmlMatch(block, /<guid[^>]*>([^<]+)<\/guid>/) || link;
    const description = xmlMatch(block, /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const pubDate = xmlMatch(block, /<pubDate>([^<]+)<\/pubDate>/);
    if (title && link) out.push({ id: guid, title, link, summary: description, published: pubDate });
  }
  if (out.length) return out;

  // ── Atom fallback ──────────────────────────────────────────────────────
  for (const raw of xml.split(/<entry[\s>]/).slice(1)) {
    const block = raw.split("</entry>")[0] ?? "";
    const title = xmlMatch(block, /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/).replace(/\s+/g, " ");
    const link = xmlMatch(block, /<link[^>]*href="([^"]+)"/);
    const id = xmlMatch(block, /<id>([^<]+)<\/id>/) || link;
    const summary = xmlMatch(block, /<(?:summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:summary|content)>/);
    const updated = xmlMatch(block, /<(?:updated|published)>([^<]+)<\/(?:updated|published)>/);
    if (title && link) out.push({ id, title, link, summary, published: updated });
  }
  return out;
}

/**
 * Strip HTML tags and collapse whitespace for the body field. Cap at 4 KB
 * because most feed entries already include the full body and we don't
 * want the items table ballooning. enrich-fetch can re-fetch later if
 * scoring decides this item warrants a deeper read.
 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

runSkill("collect-rss", async () => {
  // Path overridable via env so dev runs can point at a stub yaml.
  const path = process.env.FEEDS_YAML ?? "/app/config/feeds.yaml";
  const feeds = parseSimpleYaml(await readFile(path, "utf8"));

  const rows: CollectedItem[] = [];
  let errors = 0;

  // Sequential fetch — there's a global token-bucket via the proxy, and
  // many feeds throttle per-IP. Parallelism would not be a clear win.
  for (const f of feeds) {
    try {
      const xml = await safeFetchText(f.url, { timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 });
      for (const e of parseFeed(xml)) {
        rows.push({
          source: `rss:${f.name}`,
          source_id: e.id,
          url: e.link,
          title: e.title,
          raw_body: stripHtml(e.summary),
          published_at: e.published,
        });
      }
    } catch (e) {
      // Per-feed failures are accounted for separately so the digest
      // can show "RSS: 23 feeds, 2 errors" rather than going dark.
      errors++;
      log.warn({ feed: f.name, err: String(e) }, "rss_feed_failed");
    }
  }

  // Single batched insert (transaction) for all collected rows.
  return { ...insertItems(rows), errors };
});
