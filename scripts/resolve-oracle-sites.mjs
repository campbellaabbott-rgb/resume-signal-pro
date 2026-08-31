// Per-SITE resolution for AMBIGUOUS Oracle tenants — the second half of the
// name unlock.
//
// resolve-oracle-names refuses a tenant whose recruitingCESites carries several
// distinct branded names (rule 3): one catalog entry per token, and a token
// ending in CX_1 names the whole tenant, so a shared instance hosting Kroger
// AND its subsidiaries under one entry would claim them all under one name.
//
// But the refusal is about the TOKEN, not the tenant. The token's third
// segment IS the site (`tenant~dc~CX_1`), the fetch adapter already scopes
// every request to it (findReqs;siteNumber=…), and each site carries its own
// branded SiteName. So a multi-brand tenant splits cleanly into one candidate
// PER BRANDED SITE, each with the name that site's employer chose — nothing is
// invented, which is what "an employer name comes from the employer" requires.
// 36 tenants / 46,182 postings sat behind this on 2026-08-30.
//
// Usage: node scripts/resolve-oracle-sites.mjs <resolve-output.json> <out.json>
//   input:  the resolve-oracle-names output ({ resolved, ambiguous, unresolved })
//   output: { resolved: [{token,name,count,evidence}], skipped: [...] }
//           — same entry shape the merge feed expects, counts probed per site.
import { readFileSync, writeFileSync } from "node:fs";

const [, , RESOLVE_PATH, OUT] = process.argv;
const ambiguous = JSON.parse(readFileSync(RESOLVE_PATH, "utf8")).ambiguous ?? [];
const DEFAULT_NAMES = /^candidate experience site$|^career site$|^careers?$|^cx(_\d+)?$/i;
const CONCURRENCY = 4;

const hostOf = (token) => {
  const [tenant, dc] = token.split("~");
  return `${tenant}.fa.${dc}.oraclecloud.com`;
};

async function jget(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sitesOf(token) {
  const j = await jget(`https://${hostOf(token)}/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&limit=200`);
  return j.items ?? [];
}

// The public list endpoint states the site's own total; requisitionList rides
// along only so an empty answer is distinguishable from a shape change.
async function countOf(token, siteNumber) {
  const finder = `findReqs;siteNumber=${siteNumber},limit=1,offset=0,sortBy=POSTING_DATES_DESC`;
  const j = await jget(`https://${hostOf(token)}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`);
  const it = j.items?.[0];
  if (!it) return null;
  const total = Number(it.TotalJobsCount);
  if (Number.isFinite(total)) return total;
  return Array.isArray(it.requisitionList) ? it.requisitionList.length : null;
}

function brandName(site) {
  const seo = String(site.SeoOrganizationName ?? "").replace(/\s+(Careers?|Jobs?)$/i, "").trim();
  const raw = String(site.SiteName ?? "").replace(/\s+(Careers?|Jobs?)$/i, "").trim();
  const name = seo || raw;
  return name && !DEFAULT_NAMES.test(name) ? name : null;
}

const resolved = [], skipped = [];
let done = 0;
const queue = [...ambiguous];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    const [tenant, dc] = t.token.split("~");
    try {
      const sites = (await sitesOf(t.token)).filter((s) => s.StatusCode === "ORA_ACTIVE");
      const branded = sites
        .map((s) => ({ num: s.SiteNumber ?? s.Number ?? null, name: brandName(s) }))
        .filter((s) => s.num && s.name);
      if (branded.length === 0) { skipped.push({ token: t.token, why: "no branded active site" }); continue; }
      // A DEV/DEMO instance splits into dozens of "brands" that all serve the
      // SAME requisition pool — egue-dev12 offered 83 sites at an identical
      // 1,777 count each (2026-08-31). Real multi-brand tenants have distinct
      // per-site counts; more than five sites sharing one count is one pool
      // wearing many hats, and none of them is an employer.
      if (branded.length > 5) {
        const probeCounts = [];
        for (const s2 of branded.slice(0, 6)) {
          try { probeCounts.push(await countOf(t.token, s2.num)); } catch { probeCounts.push(null); }
          await new Promise((r) => setTimeout(r, 250));
        }
        const nums = probeCounts.filter((c) => typeof c === "number" && c > 0);
        if (nums.length >= 5 && new Set(nums).size === 1) {
          skipped.push({ token: t.token, why: `shared-pool instance: ${branded.length} sites all count ${nums[0]}` });
          console.log(`  SKIP ${t.token} — ${branded.length} sites share one requisition pool (${nums[0]} each)`);
          continue;
        }
      }
      for (const s of branded) {
        try {
          const count = await countOf(t.token, s.num);
          if (count === null) { skipped.push({ token: `${tenant}~${dc}~${s.num}`, why: "count unreadable" }); continue; }
          if (count === 0) continue; // empty site — nothing to carry
          resolved.push({
            token: `${tenant}~${dc}~${s.num}`,
            name: s.name,
            count,
            evidence: `per-site split of multi-brand tenant ${t.token} (SiteName)`,
          });
        } catch (e) {
          skipped.push({ token: `${tenant}~${dc}~${s.num}`, why: String(e).slice(0, 80) });
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) {
      skipped.push({ token: t.token, why: String(e).slice(0, 80) });
    }
    if (++done % 5 === 0) console.log(`  ${done}/${ambiguous.length} tenants — ${resolved.length} branded sites so far`);
  }
}));

resolved.sort((a, b) => b.count - a.count);
writeFileSync(OUT, JSON.stringify({ resolved, skipped }, null, 1));
const postings = resolved.reduce((s, x) => s + x.count, 0);
console.log(`\nsplit ${ambiguous.length} ambiguous tenants -> ${resolved.length} branded site boards (${postings.toLocaleString()} postings), ${skipped.length} skipped -> ${OUT}`);
