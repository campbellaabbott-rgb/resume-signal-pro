#!/usr/bin/env node
// Rung-3 census: discover candidate company tokens for Recruitee / Teamtailor /
// Personio / Breezy from the Common Crawl URL index (same approach as the Rung-2
// census). DISCOVERY ONLY — every candidate must still pass live verification
// against the vendor's official API (≥3 postings) plus the census-merge quality
// protocol before it can enter sources.ts.
//
// Usage: node scripts/census-rung3.mjs <output.json>

import fs from "node:fs";

const OUT = process.argv[2] || "rung3-census.json";
const CDX = "https://index.commoncrawl.org";

// Subdomain labels that are vendor infrastructure, never a company board.
const NOT_COMPANY = new Set([
  "www", "api", "app", "apps", "auth", "login", "signup", "blog", "help", "docs",
  "support", "status", "cdn", "assets", "static", "mail", "email", "marketing",
  "admin", "dashboard", "my", "go", "get", "try", "demo", "sandbox", "staging",
  "test", "dev", "careers", "jobs", "hire", "portal", "connect", "developers",
]);

const VENDORS = [
  { vendor: "recruitee", pattern: "*.recruitee.com", hostSuffix: ".recruitee.com" },
  { vendor: "teamtailor", pattern: "*.teamtailor.com", hostSuffix: ".teamtailor.com" },
  { vendor: "breezy", pattern: "*.breezy.hr", hostSuffix: ".breezy.hr" },
  { vendor: "personio", pattern: "*.jobs.personio.de", hostSuffix: ".jobs.personio.de" },
  { vendor: "personio_com", pattern: "*.jobs.personio.com", hostSuffix: ".jobs.personio.com" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "resumebooster.work census (contact: support@resumebooster.work)" } });
      if (res.status === 503 || res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      return res;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

async function latestIndexes(n = 2) {
  const res = await fetchRetry(`${CDX}/collinfo.json`);
  const all = await res.json();
  return all.slice(0, n).map((c) => c.id); // two most recent crawls — coverage beats speed
}

async function censusVendor(indexId, { vendor, pattern, hostSuffix }) {
  const base = `${CDX}/${indexId}-index?url=${encodeURIComponent(pattern + "/*")}&output=json&fl=url&collapse=urlkey`;
  const npRes = await fetchRetry(`${base}&showNumPages=true`);
  if (!npRes || !npRes.ok) return new Set();
  const pages = Number((await npRes.json()).pages) || 0;
  const tokens = new Set();
  for (let p = 0; p < pages; p++) {
    const res = await fetchRetry(`${base}&page=${p}`);
    if (!res || !res.ok) continue;
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const { url } = JSON.parse(line);
        const host = new URL(url).hostname.toLowerCase();
        if (!host.endsWith(hostSuffix)) continue;
        const label = host.slice(0, -hostSuffix.length);
        // single label only (no nested subdomains), sane slug shape
        if (!label || label.includes(".") || NOT_COMPANY.has(label)) continue;
        if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(label)) continue;
        tokens.add(label);
      } catch { /* skip malformed line */ }
    }
    await sleep(400); // be a polite CDX citizen
    if (p % 10 === 0) console.log(`  ${vendor} ${indexId}: page ${p + 1}/${pages}, ${tokens.size} tokens so far`);
  }
  return tokens;
}

const out = {};
const indexes = await latestIndexes(2);
console.log("Using Common Crawl indexes:", indexes.join(", "));
for (const v of VENDORS) {
  const merged = new Set();
  for (const idx of indexes) {
    const t = await censusVendor(idx, v);
    for (const x of t) merged.add(x);
  }
  out[v.vendor] = [...merged].sort();
  console.log(`${v.vendor}: ${merged.size} candidate tokens`);
}
// personio .com hosts fold into personio with a host marker
out.personio_hosts = Object.fromEntries([
  ...(out.personio ?? []).map((t) => [t, "jobs.personio.de"]),
  ...(out.personio_com ?? []).map((t) => [t, "jobs.personio.com"]),
]);
out.personio = [...new Set([...(out.personio ?? []), ...(out.personio_com ?? [])])].sort();
delete out.personio_com;

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\nWrote ${OUT}:`, Object.entries(out).filter(([k]) => k !== "personio_hosts").map(([k, v]) => `${k}=${v.length}`).join(", "));
