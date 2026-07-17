#!/usr/bin/env node
// Multi-vendor census via the Common Crawl COLUMNAR index (data.commoncrawl.org)
// — the CDX API host (index.commoncrawl.org) blocks both this machine's
// foreground IP (rate limit) and the background sandbox egress, while the
// columnar host serves everything from everywhere. Same technique as the
// Workday columnar census, generalized: read the crawl's cluster.idx (sparse
// SURT→block map), range-fetch only the blocks whose SURT range covers each
// vendor's host prefix, gunzip, extract company tokens. DISCOVERY ONLY —
// candidates still pass live verification (verify-all) + the census-merge
// quality protocol before entering sources.ts.
//
// Usage: node scripts/census-cluster-all.mjs <crawl-id> <out.json>
//   e.g. node scripts/census-cluster-all.mjs CC-MAIN-2025-47 census-47.json
// Appends into an existing out.json (token-set union) so multiple crawls accumulate.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

const [, , CRAWL, OUT] = process.argv;
if (!CRAWL || !OUT) { console.error("usage: census-cluster-all.mjs <crawl-id> <out.json>"); process.exit(1); }
const DATA = "https://data.commoncrawl.org";
const UA = "resumebooster.work census (contact: support@resumebooster.work)";

const NOT_COMPANY = new Set([
  "www", "api", "app", "apps", "auth", "login", "signup", "blog", "help", "docs",
  "support", "status", "cdn", "assets", "static", "mail", "email", "marketing",
  "admin", "dashboard", "my", "go", "get", "try", "demo", "sandbox", "staging",
  "test", "dev", "careers", "jobs", "hire", "portal", "connect", "developers",
  "embed", "js", "css", "img", "images", "search", "sitemap", "robots", "favicon",
  "privacy", "terms", "about", "contact", "pricing", "features", "board", "boards",
]);

// SURT prefixes per vendor host. host a.b.c reverses to "c,b,a" — a path host
// maps to one prefix; a subdomain wildcard maps to the parent's prefix comma.
const SURTS = [
  { vendor: "greenhouse", kind: "path", surt: "io,greenhouse,boards)/", host: "boards.greenhouse.io" },
  { vendor: "greenhouse", kind: "path", surt: "io,greenhouse,job-boards)/", host: "job-boards.greenhouse.io" },
  { vendor: "lever", kind: "path", surt: "co,lever,jobs)/", host: "jobs.lever.co" },
  { vendor: "ashby", kind: "path", surt: "com,ashbyhq,jobs)/", host: "jobs.ashbyhq.com" },
  { vendor: "smartrecruiters", kind: "path", surt: "com,smartrecruiters,careers)/", host: "careers.smartrecruiters.com", keepCase: true },
  { vendor: "smartrecruiters", kind: "path", surt: "com,smartrecruiters,jobs)/", host: "jobs.smartrecruiters.com", keepCase: true },
  { vendor: "workable", kind: "path", surt: "com,workable,apply)/", host: "apply.workable.com" },
  { vendor: "bamboohr", kind: "subdomain", surt: "com,bamboohr,", hostSuffix: ".bamboohr.com" },
  { vendor: "recruitee", kind: "subdomain", surt: "com,recruitee,", hostSuffix: ".recruitee.com" },
  { vendor: "teamtailor", kind: "subdomain", surt: "com,teamtailor,", hostSuffix: ".teamtailor.com" },
  { vendor: "breezy", kind: "subdomain", surt: "hr,breezy,", hostSuffix: ".breezy.hr" },
  { vendor: "personio", kind: "subdomain", surt: "de,personio,jobs,", hostSuffix: ".jobs.personio.de", personioHost: "jobs.personio.de" },
  { vendor: "personio", kind: "subdomain", surt: "com,personio,jobs,", hostSuffix: ".jobs.personio.com", personioHost: "jobs.personio.com" },
  { vendor: "rippling", kind: "path", surt: "com,rippling,ats)/", host: "ats.rippling.com" },
  { vendor: "workday", kind: "workday", surt: "com,myworkdayjobs,", hostSuffix: ".myworkdayjobs.com" },
];

async function curlBuf(url, range) {
  for (let i = 0; i < 6; i++) {
    try {
      const args = ["-s", "-m", "120", "-H", `User-Agent: ${UA}`];
      if (range) args.push("-r", range);
      args.push(url, "--output", "-");
      const { stdout } = await execFileP("/usr/bin/curl", args, { maxBuffer: 512 * 1024 * 1024, encoding: "buffer" });
      if (stdout.length > 0) return stdout;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}

// 1. cluster.idx (~100MB) — cache per crawl in the OS tmpdir.
const idxPath = path.join(os.tmpdir(), `cluster-${CRAWL}.idx`);
if (!fs.existsSync(idxPath) || fs.statSync(idxPath).size < 1_000_000) {
  console.log(`${CRAWL}: downloading cluster.idx …`);
  const buf = await curlBuf(`${DATA}/cc-index/collections/${CRAWL}/indexes/cluster.idx`);
  if (!buf) { console.error("cluster.idx unreachable"); process.exit(1); }
  fs.writeFileSync(idxPath, buf);
}
const lines = fs.readFileSync(idxPath, "utf8").split("\n");
console.log(`${CRAWL}: cluster.idx ${lines.length} entries`);

// 2. Blocks per SURT prefix (plus the block immediately before each first
// match — its range can contain early rows of the prefix).
function blocksFor(prefix) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(prefix)) {
      const add = (ln) => { const p = ln.split("\t"); if (p.length >= 4) blocks.push({ shard: p[1], off: Number(p[2]), len: Number(p[3]) }); };
      if (blocks.length === 0 && i > 0) add(lines[i - 1]);
      add(lines[i]);
    } else if (blocks.length > 0 && !lines[i].startsWith(prefix)) {
      break; // cluster.idx is sorted — past the range
    }
  }
  return blocks;
}

const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const sets = {};
const add = (vendor, token) => {
  (sets[vendor] ??= new Set(out[vendor] ?? []));
  sets[vendor].add(token);
};
out.personio_hosts ??= {};

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2})?$/;
for (const s of SURTS) {
  const blocks = blocksFor(s.surt);
  if (!blocks.length) { console.log(`${s.vendor} (${s.surt}): 0 blocks`); continue; }
  let found = 0;
  for (const b of blocks) {
    if (!Number.isFinite(b.off) || !Number.isFinite(b.len) || b.len <= 0) continue;
    const gz = await curlBuf(`${DATA}/cc-index/collections/${CRAWL}/indexes/${b.shard}`, `${b.off}-${b.off + b.len - 1}`);
    if (!gz) continue;
    let text;
    try { text = zlib.gunzipSync(gz).toString("utf8"); } catch { continue; }
    for (const ln of text.split("\n")) {
      const brace = ln.indexOf("{");
      if (brace < 0) continue;
      let url;
      try { url = new URL(JSON.parse(ln.slice(brace)).url); } catch { continue; }
      const host = url.hostname.toLowerCase();
      if (s.kind === "path") {
        if (host !== s.host) continue;
        const seg = url.pathname.split("/").filter(Boolean)[0] ?? "";
        const token = s.keepCase ? decodeURIComponent(seg) : decodeURIComponent(seg).toLowerCase();
        if (TOKEN_RE.test(token) && !NOT_COMPANY.has(token.toLowerCase())) { add(s.vendor, token); found++; }
      } else if (s.kind === "subdomain") {
        if (!host.endsWith(s.hostSuffix)) continue;
        const label = host.slice(0, -s.hostSuffix.length);
        if (label.includes(".") || !TOKEN_RE.test(label) || NOT_COMPANY.has(label)) continue;
        add(s.vendor, label); found++;
        if (s.personioHost) out.personio_hosts[label] = s.personioHost;
      } else {
        // workday: {tenant}.{dc}.myworkdayjobs.com/(locale/)?{site}/…
        const m = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
        if (!m) continue;
        const segs = url.pathname.split("/").filter(Boolean);
        if (!segs.length) continue;
        let site = segs[0];
        if (LOCALE.test(site) && segs[1]) site = segs[1];
        if (!/^[A-Za-z0-9_-]{2,80}$/.test(site) || site === "job" || site === "jobs") continue;
        add("workday", `${m[1]}~${m[2]}~${site}`); found++;
      }
    }
  }
  console.log(`${s.vendor} (${s.surt}): ${blocks.length} blocks, ${found} URL hits`);
}

for (const [vendor, set] of Object.entries(sets)) out[vendor] = [...set];
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const totals = Object.entries(out).filter(([k, v]) => k !== "personio_hosts" && Array.isArray(v))
  .map(([k, v]) => `${k}=${v.length}`);
console.log(`Wrote ${OUT}: ${totals.join(", ")}`);
