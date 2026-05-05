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
      if (m && m[1] && m[2]) {
        const key = m[1] as keyof Feed;
        cur[key] = m[2].trim();
      }
    }
  }
  if (cur.name && cur.url) out.push(cur as Feed);
  return out;
}

type Entry = { id: string; title: string; link: string; summary: string; published: string };

function parseFeed(xml: string): Entry[] {
  const out: Entry[] = [];
  // RSS 2.0
  for (const raw of xml.split(/<item[\s>]/).slice(1)) {
    const block = raw.split("</item>")[0] ?? "";
    const title = xmlMatch(block, /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const link = xmlMatch(block, /<link>([^<]+)<\/link>/);
    const guid = xmlMatch(block, /<guid[^>]*>([^<]+)<\/guid>/) || link;
    const description = xmlMatch(block, /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const pubDate = xmlMatch(block, /<pubDate>([^<]+)<\/pubDate>/);
    if (title && link) out.push({ id: guid, title, link, summary: description, published: pubDate });
  }
  if (out.length) return out;
  // Atom
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

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

runSkill("collect-rss", async () => {
  const path = process.env.FEEDS_YAML ?? "/app/config/feeds.yaml";
  const feeds = parseSimpleYaml(await readFile(path, "utf8"));
  const rows: CollectedItem[] = [];
  let errors = 0;
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
      errors++;
      log.warn({ feed: f.name, err: String(e) }, "rss_feed_failed");
    }
  }
  return { ...insertItems(rows), errors };
});
