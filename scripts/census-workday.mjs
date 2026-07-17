#!/usr/bin/env node
// Workday CXS census: discover tenants from *.myworkdayjobs.com in Common Crawl,
// then verify each against its public first-party list endpoint (≥3 postings).
// A Workday board needs THREE pieces the other vendors don't — tenant, data
// center (wd1/wd5/wd103…), and site name — all present in the career-site URL:
//   https://{tenant}.{dc}.myworkdayjobs.com/{locale}/{site}/job/...
// Output token is the compound `tenant~dc~site` the fetcher/normalizer expect.
//
// Usage: node scripts/census-workday.mjs <verified-out.json> [skipIndexes]

import fs from "node:fs";

const OUT = process.argv[2] || "workday-verified.json";
const SKIP = Number(process.argv[3]) || 0;
// Bounded-slice controls (env): background jobs lost network mid-session, so
// the census must complete inside a single ~10-min FOREGROUND window. One
// index + a page cap keeps enumeration short; the probe budget bounds the
// verify phase. A slice appends to any existing output so runs accumulate.
const N_INDEXES = Number(process.env.WD_INDEXES) || 2;
const PAGE_CAP = Number(process.env.WD_PAGE_CAP) || 0;      // 0 = all pages
const PROBE_CAP = Number(process.env.WD_PROBE_CAP) || 0;    // 0 = all candidates
const DEADLINE = Date.now() + (Number(process.env.WD_DEADLINE_S) || 540) * 1000;
const CDX = "https://index.commoncrawl.org";
const MIN_POSTINGS = 3;
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTextRetry(url, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      // Retry on ANY non-2xx (CDX rate-limits bursts with 403/500, not just
      // 429) — a single transient status must not abort the whole census.
      if (!res.ok) { await sleep(3000 * (i + 1)); continue; }
      return await res.text();
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

// Parse a myworkdayjobs URL into {tenant, dc, site}. Skips the locale segment
// (en-US, en-GB, de-DE…) when present so `site` is the real career-site id.
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2})?$/;
function parse(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
    if (!m) return null;
    const [, tenant, dc] = m;
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length === 0) return null;
    let site = segs[0];
    if (LOCALE.test(site) && segs[1]) site = segs[1];
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(site) || site === "job" || site === "jobs") return null;
    return { tenant, dc, site };
  } catch { return null; }
}

const collinfoText = await fetchTextRetry(`${CDX}/collinfo.json`, 8);
if (!collinfoText) { console.error("CDX collinfo unreachable (likely overloaded) — retry later"); process.exit(1); }
const indexes = JSON.parse(collinfoText).slice(SKIP, SKIP + N_INDEXES).map((c) => c.id);
console.log("indexes:", indexes.join(", "));

const candidates = new Map(); // "tenant~dc~site" -> {tenant,dc,site}
for (const idx of indexes) {
  const base = `${CDX}/${idx}-index?url=${encodeURIComponent("*.myworkdayjobs.com")}&output=json&fl=url&collapse=urlkey`;
  const np = await fetchTextRetry(`${base}&showNumPages=true`);
  if (!np) continue;
  let pages = 0;
  try { pages = Number(JSON.parse(np).pages) || 0; } catch { continue; }
  if (PAGE_CAP > 0) pages = Math.min(pages, PAGE_CAP);
  for (let p = 0; p < pages; p++) {
    if (Date.now() > DEADLINE) { console.log("  deadline hit during enumeration"); break; }
    const text = await fetchTextRetry(`${base}&page=${p}`);
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = parse(JSON.parse(line).url);
        if (parsed) candidates.set(`${parsed.tenant}~${parsed.dc}~${parsed.site}`, parsed);
      } catch { /* skip */ }
    }
    await sleep(400);
    if (p % 20 === 0) console.log(`  ${idx}: page ${p + 1}/${pages}, ${candidates.size} candidate tenants`);
  }
}
console.log(`census: ${candidates.size} candidate tenant/site combos`);

// dedupe against catalog
const srcText = fs.readFileSync(new URL("../supabase/functions/job-board/sources.ts", import.meta.url), "utf8");
const existing = new Set([
  ...[...srcText.matchAll(/source:\s*"workday",\s*token:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase()),
  ...[...srcText.matchAll(/s\("(?:[^"\\]|\\.)*",\s*"workday",\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase()),
]);

const prettify = (t) => t.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
// Accumulate across slices: seed from any existing output so foreground runs add up.
const verified = [];
const already = new Set();
try { for (const b of (JSON.parse(fs.readFileSync(OUT, "utf8")).workday ?? [])) { verified.push(b); already.add(b.token.toLowerCase()); } } catch { /* first slice */ }
let queue = [...candidates.entries()].filter(([tok]) => !existing.has(tok.toLowerCase()) && !already.has(tok.toLowerCase()));
if (PROBE_CAP > 0) queue = queue.slice(0, PROBE_CAP);
console.log(`${queue.length} new to probe this slice (${verified.length} already verified from prior slices)`);
let done = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  for (;;) {
    if (Date.now() > DEADLINE) return;
    const next = queue.shift();
    if (!next) return;
    const [tok, { tenant, dc, site }] = next;
    try {
      const res = await fetch(`https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
        method: "POST", headers: { ...UA, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ limit: 20, offset: 0, searchText: "", appliedFacets: {} }),
      });
      if (res.ok) {
        const body = await res.json();
        const items = Array.isArray(body.jobPostings) ? body.jobPostings : [];
        // Count fresh (≤30d) postings by the relative age, matching ingest.
        const fresh = items.filter((j) => {
          const s = String(j.postedOn ?? "").toLowerCase();
          if (/30\+\s*days/.test(s)) return false;
          const m = s.match(/posted\s+(\d+)\s+days?\s+ago/);
          return !(m && Number(m[1]) > 30);
        });
        if (items.length >= MIN_POSTINGS) verified.push({ token: tok, name: prettify(tenant), count: items.length, fresh: fresh.length });
      }
    } catch { /* dead tenant — skip */ }
    done++;
    if (done % 200 === 0) console.log(`  probed ${done}, ${verified.length} verified`);
    await sleep(80);
  }
}));
verified.sort((a, b) => b.count - a.count);
fs.writeFileSync(OUT, JSON.stringify({ workday: verified }, null, 1));
console.log(`Wrote ${OUT}: ${verified.length} boards, ${verified.reduce((s, x) => s + x.count, 0)} postings visible (${verified.reduce((s, x) => s + x.fresh, 0)} fresh ≤30d)`);
