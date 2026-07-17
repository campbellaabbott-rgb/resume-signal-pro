#!/usr/bin/env node
// Rippling ATS census + verification in one pass (rung 4, user-approved
// 2026-07-16): discover board slugs from the two newest Common Crawl indexes,
// then verify each candidate against the live board page's embedded job-posts
// payload (≥3 postings). Small vendor — single script keeps it simple.
//
// Usage: node scripts/census-rippling.mjs <verified-out.json>

import fs from "node:fs";

const OUT = process.argv[2] || "rippling-verified.json";
const CDX = "https://index.commoncrawl.org";
const MIN_POSTINGS = 3;
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOT_COMPANY = new Set(["api", "static", "assets", "jobs", "login", "app"]);

async function fetchTextRetry(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 503 || res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) return null;
      return await res.text();
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

const collinfo = JSON.parse(await fetchTextRetry(`${CDX}/collinfo.json`));
const indexes = collinfo.slice(0, 2).map((c) => c.id);
console.log("indexes:", indexes.join(", "));

const slugs = new Set();
for (const idx of indexes) {
  const base = `${CDX}/${idx}-index?url=${encodeURIComponent("ats.rippling.com/*")}&output=json&fl=url&collapse=urlkey`;
  const np = await fetchTextRetry(`${base}&showNumPages=true`);
  if (!np) continue;
  let pages = 0;
  try { pages = Number(JSON.parse(np).pages) || 0; } catch { continue; }
  for (let p = 0; p < pages; p++) {
    const text = await fetchTextRetry(`${base}&page=${p}`);
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const u = new URL(JSON.parse(line).url);
        if (u.hostname.toLowerCase() !== "ats.rippling.com") continue;
        const seg = decodeURIComponent(u.pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
        if (seg && !NOT_COMPANY.has(seg) && /^[a-z0-9][a-z0-9-]{1,60}$/.test(seg)) slugs.add(seg);
      } catch { /* skip */ }
    }
    await sleep(400);
  }
}
console.log(`census: ${slugs.size} candidate slugs`);

function extractJobPosts(html) {
  const m = html.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    const qs = d?.props?.pageProps?.dehydratedState?.queries ?? [];
    const q = qs.find((x) => Array.isArray(x.queryKey) && x.queryKey[2] === "job-posts");
    if (!q?.state?.data) return null;
    return { total: Number(q.state.data.totalItems) || 0, name: d?.props?.pageProps?.board?.name ?? null };
  } catch { return null; }
}

const prettify = (t) => t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
const verified = [];
const queue = [...slugs];
let done = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    const html = await fetchTextRetry(`https://ats.rippling.com/${t}/jobs`, 2);
    if (html) {
      const jp = extractJobPosts(html);
      if (jp && jp.total >= MIN_POSTINGS) {
        verified.push({ token: t, name: (jp.name || prettify(t)).slice(0, 60), count: jp.total });
      }
    }
    done++;
    if (done % 200 === 0) console.log(`  rippling: ${done}/${slugs.size} probed, ${verified.length} verified`);
    await sleep(120);
  }
}));
verified.sort((a, b) => b.count - a.count);
fs.writeFileSync(OUT, JSON.stringify({ rippling: verified }, null, 1));
console.log(`Wrote ${OUT}: ${verified.length} boards, ${verified.reduce((s, x) => s + x.count, 0)} postings visible`);
