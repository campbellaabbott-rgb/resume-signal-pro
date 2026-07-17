#!/usr/bin/env node
// Census round 3 (2026-07-16): discover candidate company tokens for ALL TEN
// vendors from the two newest Common Crawl URL indexes. Boards get created
// continuously and each crawl snapshot indexes URLs earlier ones missed —
// re-running the census against fresh snapshots is the proven, honest growth
// path. DISCOVERY ONLY — every candidate must still pass live verification
// against the vendor's official API (≥3 postings) plus the census-merge
// quality protocol (blocklist, mill screen, SR corporate classification,
// name integrity, case-aware dupe check) before it can enter sources.ts.
//
// Usage: node scripts/census-all.mjs <output.json>

import fs from "node:fs";

const OUT = process.argv[2] || "census-all.json";
// Optional: skip the N newest crawl indexes (deep pass over older snapshots —
// different capture sets; the live-API verification step filters dead boards).
const SKIP = Number(process.argv[3]) || 0;
const CDX = "https://index.commoncrawl.org";

// Subdomain labels / path segments that are vendor infrastructure, never a company board.
const NOT_COMPANY = new Set([
  "www", "api", "app", "apps", "auth", "login", "signup", "blog", "help", "docs",
  "support", "status", "cdn", "assets", "static", "mail", "email", "marketing",
  "admin", "dashboard", "my", "go", "get", "try", "demo", "sandbox", "staging",
  "test", "dev", "careers", "jobs", "hire", "portal", "connect", "developers",
  "embed", "js", "css", "img", "images", "search", "sitemap", "robots", "favicon",
  "privacy", "terms", "about", "contact", "pricing", "features", "board", "boards",
]);

// kind: "subdomain" → token is the host label; "path" → token is the first path segment.
const VENDORS = [
  { vendor: "greenhouse", kind: "path", pattern: "boards.greenhouse.io/*", host: "boards.greenhouse.io" },
  { vendor: "greenhouse", kind: "path", pattern: "job-boards.greenhouse.io/*", host: "job-boards.greenhouse.io" },
  { vendor: "lever", kind: "path", pattern: "jobs.lever.co/*", host: "jobs.lever.co" },
  { vendor: "ashby", kind: "path", pattern: "jobs.ashbyhq.com/*", host: "jobs.ashbyhq.com" },
  { vendor: "smartrecruiters", kind: "path", pattern: "careers.smartrecruiters.com/*", host: "careers.smartrecruiters.com", keepCase: true },
  { vendor: "smartrecruiters", kind: "path", pattern: "jobs.smartrecruiters.com/*", host: "jobs.smartrecruiters.com", keepCase: true },
  { vendor: "workable", kind: "path", pattern: "apply.workable.com/*", host: "apply.workable.com" },
  { vendor: "bamboohr", kind: "subdomain", pattern: "*.bamboohr.com", hostSuffix: ".bamboohr.com" },
  { vendor: "recruitee", kind: "subdomain", pattern: "*.recruitee.com", hostSuffix: ".recruitee.com" },
  { vendor: "teamtailor", kind: "subdomain", pattern: "*.teamtailor.com", hostSuffix: ".teamtailor.com" },
  { vendor: "breezy", kind: "subdomain", pattern: "*.breezy.hr", hostSuffix: ".breezy.hr" },
  { vendor: "personio", kind: "subdomain", pattern: "*.jobs.personio.de", hostSuffix: ".jobs.personio.de", hostMark: "jobs.personio.de" },
  { vendor: "personio", kind: "subdomain", pattern: "*.jobs.personio.com", hostSuffix: ".jobs.personio.com", hostMark: "jobs.personio.com" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns the response BODY TEXT (or null). The body read lives inside the
// retry loop on purpose: CDX regularly drops connections mid-body
// ("terminated" from undici), and an unguarded res.text() outside the
// try/catch killed the whole census run.
async function fetchTextRetry(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "resumebooster.work census (contact: support@resumebooster.work)" } });
      if (res.status === 503 || res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) return null;
      return await res.text();
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

async function latestIndexes(n = 2) {
  const text = await fetchTextRetry(`${CDX}/collinfo.json`);
  if (!text) throw new Error("collinfo unreachable");
  return JSON.parse(text).slice(SKIP, SKIP + n).map((c) => c.id);
}

function tokenFrom(spec, url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (spec.kind === "subdomain") {
    if (!host.endsWith(spec.hostSuffix)) return null;
    const label = host.slice(0, -spec.hostSuffix.length);
    if (!label || label.includes(".")) return null;
    if (NOT_COMPANY.has(label)) return null;
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(label)) return null;
    return label;
  }
  if (host !== spec.host) return null;
  const seg = decodeURIComponent(u.pathname.split("/").filter(Boolean)[0] ?? "");
  const token = spec.keepCase ? seg : seg.toLowerCase();
  if (!token || NOT_COMPANY.has(token.toLowerCase())) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,60}$/.test(token)) return null;
  return token;
}

async function censusPattern(indexId, spec, sink, marks) {
  const base = `${CDX}/${indexId}-index?url=${encodeURIComponent(spec.pattern + (spec.kind === "subdomain" ? "/*" : ""))}&output=json&fl=url&collapse=urlkey`;
  const npText = await fetchTextRetry(`${base}&showNumPages=true`);
  if (!npText) return;
  let pages = 0;
  try { pages = Number(JSON.parse(npText).pages) || 0; } catch { return; }
  for (let p = 0; p < pages; p++) {
    const text = await fetchTextRetry(`${base}&page=${p}`);
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const { url } = JSON.parse(line);
        const token = tokenFrom(spec, url);
        if (token) {
          sink.add(token);
          if (spec.hostMark) marks[token] = spec.hostMark;
        }
      } catch { /* skip malformed line */ }
    }
    await sleep(400);
    if (p % 20 === 0) console.log(`  ${spec.vendor} [${spec.pattern}] ${indexId}: page ${p + 1}/${pages}, ${sink.size} tokens`);
  }
}

const sinks = {};
const personioHosts = {};
const indexes = await latestIndexes(2);
console.log("Using Common Crawl indexes:", indexes.join(", "));
for (const spec of VENDORS) {
  sinks[spec.vendor] ??= new Set();
  for (const idx of indexes) {
    await censusPattern(idx, spec, sinks[spec.vendor], personioHosts);
  }
}
const out = Object.fromEntries(Object.entries(sinks).map(([v, s]) => [v, [...s].sort()]));
out.personio_hosts = personioHosts;
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\nWrote ${OUT}:`, Object.entries(out).filter(([k]) => k !== "personio_hosts").map(([k, v]) => `${k}=${v.length}`).join(", "));
