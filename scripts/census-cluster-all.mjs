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
  // Paylocity boards live under one shared host and the token is an opaque
  // board GUID, not a company slug — NOT_COMPANY can never match one, and the
  // employer's readable name lives only in the page payload, so naming is
  // verify-time work, not census work. The crawl's SURT keys are fully
  // lowercased while the recorded page URLs mix path casings, so one
  // lowercase prefix covers every variant and the extractor matches the path
  // case-insensitively.
  { vendor: "paylocity", kind: "paylocity", surt: "com,paylocity,recruiting)/recruiting/jobs/all/", host: "recruiting.paylocity.com" },
  // ADP Workforce Now career centers all live on ONE shared host and one page
  // path; the board identity rides in the query string (a cid GUID, plus a
  // ccId when the employer runs a non-default career center — the ccId
  // SELECTS the board: one live cid answered 19 postings on its default
  // center and 1 on its second, measured 2026-08-31). SURT keys lowercase and
  // sort the query, so the page-path prefix covers every parameter order;
  // confirmed against CC-MAIN-2026-30's cluster.idx before adding: the prefix
  // owns a sample point, and its one block held 3,621 recruitment-page rows
  // naming 1,764 distinct cids (362 of them on non-default career centers).
  // Like paylocity, tokens are opaque GUIDs — NOT_COMPANY can never match one
  // and naming is verify-time work, not census work.
  { vendor: "adp", kind: "adp", surt: "com,adp,workforcenow)/mascsr/default/mdf/recruitment/recruitment.html", host: "workforcenow.adp.com" },
  { vendor: "workday", kind: "workday", surt: "com,myworkdayjobs,", hostSuffix: ".myworkdayjobs.com" },
  // Oracle Fusion recruiting. THE HIGHEST-YIELD VENDOR WE CARRY and, until
  // now, one of only two with no standing census coverage at all: 88 boards
  // holding 14,207 postings — 161 per board, against 1.7 for personio and 11.8
  // for greenhouse. Every board added here is worth ~160.
  //
  // Hosts are {tenant}.fa.{region}.oraclecloud.com, so the reversed SURT is
  // "com,oraclecloud,{region},fa,{tenant}" and the shared prefix is
  // "com,oraclecloud,". The catalog token is tenant~region~site, and the site
  // number is NOT in the hostname — CX_1 is the near-universal default and is
  // what the extractor assumes; a tenant using a different site simply fails
  // verification and is dropped, which is the right direction to be wrong in.
  //
  // Verified live 2026-08-10 before adding this: the list endpoint
  // (recruitingCEJobRequisitions, finder findReqs;siteNumber=CX_1) answered
  // 906 jobs for an existing tenant, so discovered hosts are genuinely
  // fetchable rather than merely findable.
  //
  // DISCOVERY AND VERIFICATION ONLY — merge-all's VENDORS list deliberately
  // omits oracle, so candidates are enumerated and confirmed live but never
  // auto-appended, exactly as pinpoint and the EU hosts were staged. The
  // blocker is NAMES, not reach: the Oracle payload carries no employer name
  // anywhere (LegalEmployer, BusinessUnit, Organization all null on a live
  // tenant, measured), and the runtime takes the display name from the catalog
  // entry — which is why the 88 boards we already serve read "Fortinet" and
  // "Texas Instruments" rather than "edel" and "edbz". Auto-merging would put
  // tenant codes in front of users. Enumerate and size the pool now; add a name
  // resolution step before anything merges.
  { vendor: "oracle", kind: "oracle", surt: "com,oraclecloud,", hostSuffix: ".oraclecloud.com" },
  // NO iCIMS SURT, and this is a measured decision rather than an oversight.
  // iCIMS is the other zero-coverage high-yield vendor (122 boards, 15,913
  // postings, 130/board) and a crawl prefix on icims.com looks obvious — but
  // our fetcher reads `https://{token}/api/jobs`, and that endpoint exists
  // only on employers' CUSTOM career domains. Measured 2026-08-10:
  //   careers-pilotcompany.icims.com/api/jobs -> 404
  //   careers-medallia.icims.com/api/jobs     -> 404
  //   careers.84lumber.com/api/jobs           -> 200 (control, from our catalog)
  //   careers.aarp.org/api/jobs               -> 200 (control)
  // So an icims.com prefix would enumerate thousands of hosts that every one
  // of our probes would then fail to read. iCIMS discovery belongs to the
  // Wayback CDX letter-partition channel that produced 105 employers /
  // ~36.7k postings on 2026-07-25 (commit 820b3cb8) — a different scan over
  // custom domains, not a SURT here.
  // Discovery-only until the Pinpoint vendor ships: merge/verify ignore
  // unknown vendors, so this just measures the candidate pool for rung 5.
  { vendor: "pinpoint", kind: "subdomain", surt: "com,pinpointhq,", hostSuffix: ".pinpointhq.com" },
  // EU-region hosts (separate infrastructure, separate companies — mostly
  // European employers). Measurement-only until EU API routing ships in the
  // fetchers: distinct vendor keys keep them out of merge/verify.
  { vendor: "greenhouse-eu", kind: "path", surt: "io,greenhouse,eu,job-boards)/", host: "job-boards.eu.greenhouse.io" },
  { vendor: "lever-eu", kind: "path", surt: "co,lever,eu,jobs)/", host: "jobs.eu.lever.co" },
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
  // CLUSTER.IDX IS SPARSE, AND THAT BROKE THE OLD MATCH.
  //
  // Each line marks where a block STARTS, so a prefix only appears as a line
  // start if the sampling happened to land on it. The previous version looked
  // for lines starting with the prefix and only added the preceding block once
  // it had already found one — so a vendor with no sample point of its own
  // returned ZERO blocks and read as "this vendor has no boards".
  //
  // Measured on CC-MAIN-2026-30: `co,lever,jobs)/` matched nothing and lever
  // was reported as 0 candidates. Its rows sit inside the block beginning
  // `co,levelupbusiness)/the-team`, with `co,lexir)/…` starting the next one.
  // Greenhouse only worked because it is big enough to own 4 sample points.
  // careers.smartrecruiters.com was the same silent zero.
  //
  // The correct read is a RANGE: the last block whose key sorts at or before
  // the prefix can contain its first rows, then take every following block
  // whose key still begins with the prefix. Costs at most one extra block
  // fetch when a vendor genuinely has nothing — the extractor filters by host
  // anyway, so a spurious block yields no tokens.
  const keyOf = (ln) => ln.split(/\s/)[0];
  const blocks = [];
  const add = (ln) => {
    const p = ln.split("\t");
    if (p.length >= 4) blocks.push({ shard: p[1], off: Number(p[2]), len: Number(p[3]) });
  };

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    if (keyOf(lines[i]) <= prefix) start = i;
    else break;                       // sorted — everything after is greater
  }
  if (start < 0) return blocks;

  add(lines[start]);
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    if (!keyOf(lines[i]).startsWith(prefix)) break;
    add(lines[i]);
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
      } else if (s.kind === "oracle") {
        // {tenant}.fa.{region}.oraclecloud.com — everything else under
        // oraclecloud.com (and there is a great deal of it) is not a careers
        // site and must not enter the pool.
        const m = host.match(/^([a-z0-9-]+)\.fa\.([a-z0-9-]+)\.oraclecloud\.com$/);
        if (!m) continue;
        if (NOT_COMPANY.has(m[1])) continue;
        // CX_1 is the near-universal default site number and is not carried in
        // the hostname; a tenant on a different site fails verification and is
        // dropped, which is the correct direction to be wrong in — a missing
        // board costs inventory, an unfetchable one costs a refresh slot every
        // rotation forever.
        add("oracle", `${m[1]}~${m[2]}~CX_1`); found++;
      } else if (s.kind === "paylocity") {
        if (host !== s.host) continue;
        // The board id is the GUID segment right after the all-jobs listing
        // prefix; the employer slug that often follows it is display-only.
        // Case-insensitive on both the prefix (records keep the page's own
        // casing) and the GUID, which compares case-insensitively anyway.
        const m = url.pathname.match(/^\/recruiting\/jobs\/all\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\/?#]|$)/i);
        if (!m) continue;
        add("paylocity", m[1].toLowerCase()); found++;
      } else if (s.kind === "adp") {
        if (host !== s.host) continue;
        if (!/^\/mascsr\/default\/mdf\/recruitment\/recruitment\.html$/i.test(url.pathname)) continue;
        // Identity lives in the query string, and recorded page URLs mix
        // parameter casings — read them case-insensitively. The token is the
        // cid GUID alone for a default career center, cid~ccId for the rest,
        // matching what the fetcher's token parser assumes.
        const q = {};
        for (const [k, v] of url.searchParams) q[k.toLowerCase()] ??= v;
        const cid = String(q.cid ?? "").toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cid)) continue;
        const ccid = String(q.ccid ?? "");
        const custom = /^[0-9]{1,20}_[0-9]{1,10}$/.test(ccid) && ccid !== "19000101_000001";
        add("adp", custom ? `${cid}~${ccid}` : cid); found++;
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
