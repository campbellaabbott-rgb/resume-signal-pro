// Oracle employer-name resolution — the unlock for the ORC census backlog.
//
// merge-all has always omitted oracle because ORC job payloads carry no
// employer name anywhere, and "an employer name comes from the employer"
// (commit 15086a72) forbids inventing one. It turns out the name IS published,
// one endpoint over: recruitingCESites lists every career site on the tenant
// with its branded SiteName — "The Kroger Co.", "AutoZone" — plus an optional
// SeoOrganizationName. Verified live 2026-08-28 on four tenants before this
// script existed.
//
// SELECTION RULE, in order:
//   1. among ORA_ACTIVE sites, a SiteName that is not Oracle's shipped default
//      ("Candidate Experience site") and not a template artifact;
//   2. prefer SeoOrganizationName (stripped of a trailing " Careers") when the
//      site carries one — it is the name the employer chose for search engines;
//   3. several distinct branded names on one tenant -> AMBIGUOUS, skipped and
//      listed for eyeballing (a shared instance may host several employers —
//      one catalog entry must not claim them all under one name);
//   4. nothing branded and active -> UNRESOLVED, skipped.
//
// Usage: node scripts/resolve-oracle-names.mjs <verified.json> <out.json>
// Output: { resolved: [{token,name,count,evidence}], ambiguous: [...], unresolved: [...] }
import { readFileSync, writeFileSync } from "node:fs";

const [, , VERIFIED_PATH, OUT] = process.argv;
const verified = JSON.parse(readFileSync(VERIFIED_PATH, "utf8"));
const boards = verified.oracle ?? [];
const DEFAULT_NAMES = /^candidate experience site$|^career site$|^careers?$|^cx(_\d+)?$/i;
const CONCURRENCY = 6;

const hostOf = (token) => {
  const [tenant, dc] = token.split("~");
  return `${tenant}.fa.${dc}.oraclecloud.com`;
};

async function sitesOf(token) {
  const url = `https://${hostOf(token)}/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&limit=50`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return j.items ?? [];
}

function pickName(sites) {
  const active = sites.filter((s) => s.StatusCode === "ORA_ACTIVE");
  const branded = active
    .map((s) => ({
      site: s,
      name: String(s.SeoOrganizationName ?? "").replace(/\s+Careers?$/i, "").trim() || String(s.SiteName ?? "").trim(),
    }))
    .filter((x) => x.name && !DEFAULT_NAMES.test(x.name));
  if (!branded.length) return { status: "unresolved" };
  const names = [...new Set(branded.map((x) => x.name.toLowerCase()))];
  if (names.length > 1) return { status: "ambiguous", names: branded.map((x) => x.name) };
  // The ACTIVE branded site's number rides along, because the census token's
  // site is often the tenant's INACTIVE default: Kroger's census token names
  // CX_1, which serves ZERO requisitions, while the branded CX_2001 serves
  // 12,544 — TotalJobsCount is tenant-wide, so verification passed anyway.
  // A merge that keeps the census site ingests nothing.
  return { status: "resolved", name: branded[0].name, activeSite: String(branded[0].site.SiteNumber ?? ""), evidence: `${branded.length} active branded site(s)` };
}

const resolved = [], ambiguous = [], unresolved = [];
let done = 0;
const queue = [...boards];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const b = queue.shift();
    if (!b) return;
    try {
      const sites = await sitesOf(b.token);
      const pick = pickName(sites);
      if (pick.status === "resolved") resolved.push({ token: b.token, name: pick.name, count: b.count, activeSite: pick.activeSite, evidence: pick.evidence });
      else if (pick.status === "ambiguous") ambiguous.push({ token: b.token, count: b.count, names: [...new Set(pick.names)].slice(0, 6) });
      else unresolved.push({ token: b.token, count: b.count });
    } catch (e) {
      unresolved.push({ token: b.token, count: b.count, error: String(e.message ?? e).slice(0, 60) });
    }
    if (++done % 50 === 0) console.log(`  ${done}/${boards.length} — resolved ${resolved.length}, ambiguous ${ambiguous.length}, unresolved ${unresolved.length}`);
  }
}));

resolved.sort((a, b) => b.count - a.count);
writeFileSync(OUT, JSON.stringify({ resolved, ambiguous, unresolved }, null, 1));
const postings = resolved.reduce((n, b) => n + b.count, 0);
console.log(`\nresolved ${resolved.length}/${boards.length} boards (${postings.toLocaleString()} postings), ambiguous ${ambiguous.length}, unresolved ${unresolved.length} -> ${OUT}`);
console.log("top 10:", resolved.slice(0, 10).map((b) => `${b.name} (${b.count})`).join(", "));
