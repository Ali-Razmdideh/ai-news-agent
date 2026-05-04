import { readFile } from "node:fs/promises";
import { openDb, tx, safeFetchText, log } from "@ai-news/core";

type Feed = { name: string; url: string };

function parseSimpleYaml(text: string): Feed[] {
  const out: Feed[] = [];
  let cur: Partial<Feed> = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("- ")) {
      if (cur.name && cur.url) out.push(cur as Feed);
      cur = {};
      const m = line.match(/^- name:\s*(.+)$/);
      if (m && m[1]) cur.name = m[1].trim();
    } else {
      const m = line.match(/^\s*(name|url):\s*(.+)$/);
      if (m && m[1] && m[2]) (cur as Record<string, string>)[m[1]] = m[2].trim();
    }
  }
  if (cur.name && cur.url) out.push(cur as Feed);
  return out;
}

type Entry = { id: string; title: string; link: string; summary: string; published: string };

function parseFeed(xml: string): Entry[] {
  const out: Entry[] = [];
  // RSS 2.0
  const items = xml.split(/<item[\s>]/).slice(1);
  for (const raw of items) {
    const block = raw.split("</item>")[0] ?? "";
    const title = match(block, /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const link = match(block, /<link>([^<]+)<\/link>/);
    const guid = match(block, /<guid[^>]*>([^<]+)<\/guid>/) || link;
    const description = match(block, /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const pubDate = match(block, /<pubDate>([^<]+)<\/pubDate>/);
    if (title && link) out.push({ id: guid, title, link, summary: description, published: pubDate });
  }
  if (out.length) return out;
  // Atom
  const entries = xml.split(/<entry[\s>]/).slice(1);
  for (const raw of entries) {
    const block = raw.split("</entry>")[0] ?? "";
    const title = match(block, /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/).replace(/\s+/g, " ").trim();
    const link = match(block, /<link[^>]*href="([^"]+)"/);
    const id = match(block, /<id>([^<]+)<\/id>/) || link;
    const summary = match(block, /<(?:summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:summary|content)>/);
    const updated = match(block, /<(?:updated|published)>([^<]+)<\/(?:updated|published)>/);
    if (title && link) out.push({ id, title, link, summary, published: updated });
  }
  return out;
}

function match(s: string, re: RegExp): string {
  return (s.match(re)?.[1] ?? "").trim();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

async function main(): Promise<void> {
  const path = process.env.FEEDS_YAML ?? "/app/config/feeds.yaml";
  const yaml = await readFile(path, "utf8");
  const feeds = parseSimpleYaml(yaml);
  const db = openDb();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO items (source, source_id, url, title, raw_body, authors, published_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  );
  let collected = 0, fresh = 0, errors = 0;
  for (const f of feeds) {
    try {
      const xml = await safeFetchText(f.url, { timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 });
      const entries = parseFeed(xml);
      collected += entries.length;
      tx(() => {
        for (const e of entries) {
          const r = ins.run(`rss:${f.name}`, e.id, e.link, e.title, stripHtml(e.summary), e.published);
          if ((r.changes ?? 0) > 0) fresh++;
        }
      });
    } catch (e) {
      errors++;
      log.warn({ feed: f.name, err: String(e) }, "rss_feed_failed");
    }
  }
  const out = { collected, new: fresh, errors };
  log.info(out, "collect_rss_done");
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((e) => {
  log.error({ err: String(e) }, "collect_rss_failed");
  process.exit(1);
});
