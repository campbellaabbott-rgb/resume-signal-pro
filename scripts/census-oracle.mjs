#!/usr/bin/env node
// Oracle CE census: discover tenants from *.fa.*.oraclecloud.com in the
// Wayback CDX, then verify each against the same public CE REST endpoint
// fetchOracle already calls (≥3 postings). Token is `tenant~region~site`.
//
// Written 2026-08-19 off the inventory-census measurement: 32 of 50 probed
// uncarried tenant~region combos served live JSON (64%) in ONE narrow CDX
// slice, with siteNumber=CX_1 correct for ~30 of the 32 — so the probe tries
// CX_1 then CX_2/CX_3 and stops at the first that answers with items.
//
// Census-merge protocol applies to the OUTPUT of this script, it is not
// implemented here: blocklist, collision guard, staffing-mill screen for
// boards ≥100 postings, case-insensitive dupe check, battery, live-verify.
// This script only produces verified candidates.
//
// Two traps measured during the probe wave, both handled:
//  - *-test tenants mirror production feeds (ekac-test == ekac). Dropped by
//    name, and any tenant whose page-1 requisition ids duplicate an
//    already-accepted tenant's is dropped as a mirror.
//  - TotalJobsCount advertises 1 higher than served (Fortinet 918/917), so
//    verification counts ITEMS RETURNED, never the advertised total.
//
// Usage: node scripts/census-oracle.mjs <verified-out.json>
//   env: OC_PROBE_CAP (0=all), OC_DEADLINE_S (default 540), OC_CDX_PAGES

import fs from "node:fs";

const OUT = process.argv[2] || "oracle-verified.json";
const PROBE_CAP = Number(process.env.OC_PROBE_CAP) || 0;
const DEADLINE = Date.now() + (Number(process.env.OC_DEADLINE_S) || 540) * 1000;
const CDX_PAGES = Number(process.env.OC_CDX_PAGES) || 40;
const MIN_POSTINGS = 3;
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTextRetry(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) { await sleep(2500 * (i + 1)); continue; }
      return await res.text();
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

// ---- 1. Enumerate candidate hosts from the Wayback CDX ---------------------
// DISCOVERY CHANNEL, found the hard way 2026-08-19. Three things do NOT work:
//   - Common Crawl has NO captures for oraclecloud.com at all (Workday's
//     census channel is useless here — those career hosts aren't crawled).
//   - crt.sh returns only shared wildcard infra, never per-tenant names.
//   - A domain-match on the APEX returns 2,688 pages sorted by urlkey, so the
//     apex's own records fill every early page and the tenant hosts never
//     appear in a bounded slice. My first run probed 0 candidates this way.
// What DOES work: `fa.{region}.oraclecloud.com` is itself a valid domain
// suffix, so a domain-match on it returns ONLY tenant hosts for that region —
// a narrow, paginable query per region instead of one hopeless global walk.
const REGIONS = (process.env.OC_REGIONS || "us2,us6,ca2,ap1,em2,eu1,uk1,ap2,us3,sa1").split(",");
const HOST_RE = /^([a-z0-9-]+)\.fa\.([a-z0-9]+)\.oraclecloud\.com$/;
const carried = new Set(
  fs.readFileSync(new URL("../supabase/functions/job-board/sources.ts", import.meta.url), "utf8")
    .match(/source: "oracle", token: "([^"]+)"/g)?.map((m) => m.match(/token: "([^"]+)"/)[1].split("~").slice(0, 2).join("~").toLowerCase()) ?? [],
);

const hosts = new Map(); // tenant~region -> host
for (const region of REGIONS) {
  if (Date.now() > DEADLINE) break;
  for (let page = 0; page < CDX_PAGES; page++) {
    if (Date.now() > DEADLINE) break;
    const url = `https://web.archive.org/cdx/search/cdx?url=fa.${region}.oraclecloud.com&matchType=domain`
      + `&fl=original&collapse=urlkey&limit=5000&page=${page}`;
    const text = await fetchTextRetry(url);
    if (!text) break;
    const lines = text.split("\n").filter(Boolean);
    if (lines.length === 0) break;
    let added = 0;
    for (const line of lines) {
      let h;
      try { h = new URL(line.trim()).hostname.toLowerCase(); } catch { continue; }
      const m = h.match(HOST_RE);
      if (!m) continue;
      const [, tenant, reg] = m;
      // Junk and mirrors: numeric-only slugs are archive noise, and *-test /
      // *-dev tenants duplicate production feeds verbatim (ekac-test == ekac,
      // measured during the probe wave).
      if (/^\d+$/.test(tenant)) continue;
      if (/(^|-)(test|dev|stage|uat|demo|sandbox)(-|$)/.test(tenant)) continue;
      const key = `${tenant}~${reg}`;
      if (carried.has(key) || hosts.has(key)) continue;
      hosts.set(key, h);
      added++;
    }
    console.log(`[cdx] ${region} page ${page}: +${added} (total candidates ${hosts.size})`);
    if (lines.length < 5000) break; // last page for this region
    await sleep(900);
  }
}

// ---- 2. Probe each candidate on the CE REST endpoint -----------------------
const SITES = ["CX_1", "CX_2", "CX_3"];
const verified = [];
const seenFeedFingerprint = new Set(); // page-1 req-id fingerprint, drops prod mirrors

// CONCURRENT, because serial probing cannot finish. First run: 239 candidates
// discovered, 11 probed before the deadline — each candidate costs up to three
// site guesses at a 15s timeout, so a serial walk is hopeless. Eight at a time
// with a short per-request timeout gets the whole corpus inside one window.
const CONC = Number(process.env.OC_CONC) || 8;
let probed = 0;

const probeOne = async ([key, host]) => {
  const [tenant, region] = key.split("~");
  for (const site of SITES) {
    if (Date.now() > DEADLINE) return null;
    const finder = `findReqs;siteNumber=${site},limit=25,offset=0,sortBy=POSTING_DATES_DESC`;
    const url = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(9_000) });
      if (!res.ok) { if (res.status === 404) return null; continue; }
      const body = await res.json();
      const item = Array.isArray(body?.items) ? body.items[0] : null;
      const reqs = Array.isArray(item?.requisitionList) ? item.requisitionList : [];
      if (reqs.length < MIN_POSTINGS) continue; // items RETURNED, never the advertised total
      return {
        key, tenant, region, site, host, reqs,
        advertised: Number(item?.TotalJobsCount ?? 0) || null,
        orgName: String(item?.RequisitionOrgName ?? item?.OrganizationName ?? "").trim(),
      };
    } catch { /* timeout or network — try the next site */ }
  }
  return null;
};

const queue = [...hosts.entries()].slice(0, PROBE_CAP || undefined);
for (let i = 0; i < queue.length; i += CONC) {
  if (Date.now() > DEADLINE) { console.log("[deadline] stopping probe phase"); break; }
  const batch = queue.slice(i, i + CONC);
  probed += batch.length;
  const results = await Promise.all(batch.map(probeOne));
  for (const r of results) {
    if (!r) continue;
    // Mirror guard: a *-test tenant duplicates production verbatim, and the
    // name filter cannot catch every alias — so drop any feed whose first
    // requisition ids match one already accepted.
    const fingerprint = r.reqs.slice(0, 5).map((x) => x?.Id ?? x?.RequisitionId ?? "").join("|");
    if (seenFeedFingerprint.has(fingerprint)) { console.log(`[mirror] ${r.key} duplicates an accepted feed — dropped`); continue; }
    seenFeedFingerprint.add(fingerprint);
    verified.push({
      name: r.orgName || r.tenant,
      source: "oracle",
      token: `${r.tenant}~${r.region}~${r.site}`,
      measuredFirstPage: r.reqs.length,
      advertisedTotal: r.advertised,
      host: r.host,
    });
    console.log(`[live] ${r.tenant}~${r.region}~${r.site}: ${r.reqs.length} on page 1, advertised ${r.advertised ?? "?"}`);
  }
  console.log(`[probe] ${Math.min(i + CONC, queue.length)}/${queue.length} done, ${verified.length} live`);
}

// Append-accumulate across runs, dedupe by token (case-insensitive).
let existing = [];
try { existing = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { /* first run */ }
const byToken = new Map(existing.map((e) => [e.token.toLowerCase(), e]));
for (const v of verified) if (!byToken.has(v.token.toLowerCase())) byToken.set(v.token.toLowerCase(), v);
fs.writeFileSync(OUT, JSON.stringify([...byToken.values()], null, 2));
console.log(`\n[done] probed ${probed}, live this run ${verified.length}, total accumulated ${byToken.size} -> ${OUT}`);
