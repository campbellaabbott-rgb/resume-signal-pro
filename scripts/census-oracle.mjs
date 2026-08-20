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
// Host shape: {tenant}.fa.{region}.oraclecloud.com — region is a datacenter
// code (us2, us6, ca2, ap1, em2, eu1…). The CDX matchType=domain walk on
// oraclecloud.com returns far more than CE hosts; the regex filters to the
// career-site shape.
const HOST_RE = /^([a-z0-9-]+)\.fa\.([a-z0-9]+)\.oraclecloud\.com$/;
const carried = new Set(
  fs.readFileSync(new URL("../supabase/functions/job-board/sources.ts", import.meta.url), "utf8")
    .match(/source: "oracle", token: "([^"]+)"/g)?.map((m) => m.match(/token: "([^"]+)"/)[1].split("~").slice(0, 2).join("~").toLowerCase()) ?? [],
);

const hosts = new Map(); // tenant~region -> host
for (let page = 0; page < CDX_PAGES && Date.now() < DEADLINE; page++) {
  const url = `https://web.archive.org/cdx/search/cdx?url=oraclecloud.com&matchType=domain&collapse=urlkey&fl=original&filter=original:.*fa\\..*oraclecloud.*CX.*&limit=5000&page=${page}`;
  const text = await fetchTextRetry(url);
  if (text === null) break;
  const lines = text.split("\n").filter(Boolean);
  if (lines.length === 0) break;
  for (const line of lines) {
    try {
      const h = new URL(line).hostname.toLowerCase();
      const m = h.match(HOST_RE);
      if (!m) continue;
      const [, tenant, region] = m;
      if (tenant.endsWith("-test") || tenant.endsWith("-dev") || tenant.includes("test")) continue;
      const key = `${tenant}~${region}`;
      if (!carried.has(key)) hosts.set(key, h);
    } catch { /* not a URL */ }
  }
  console.log(`[cdx] page ${page}: candidates so far ${hosts.size}`);
  await sleep(1200);
}

// ---- 2. Probe each candidate on the CE REST endpoint -----------------------
const SITES = ["CX_1", "CX_2", "CX_3"];
const verified = [];
const seenFeedFingerprint = new Set(); // page-1 req-id fingerprint, drops prod mirrors

let probed = 0;
for (const [key, host] of hosts) {
  if (Date.now() > DEADLINE) { console.log("[deadline] stopping probe phase"); break; }
  if (PROBE_CAP && probed >= PROBE_CAP) break;
  probed++;
  const [tenant, region] = key.split("~");
  for (const site of SITES) {
    const finder = `findReqs;siteNumber=${site},limit=25,offset=0,sortBy=POSTING_DATES_DESC`;
    const url = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`;
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) { if (site === "CX_1" && res.status === 404) break; continue; }
      const body = await res.json();
      const item = Array.isArray(body?.items) ? body.items[0] : null;
      const reqs = Array.isArray(item?.requisitionList) ? item.requisitionList : [];
      if (reqs.length < MIN_POSTINGS) continue; // count items RETURNED, never the advertised total
      const fingerprint = reqs.slice(0, 5).map((r) => r?.Id ?? r?.RequisitionId ?? "").join("|");
      if (seenFeedFingerprint.has(fingerprint)) { console.log(`[mirror] ${key} duplicates an accepted feed — dropped`); break; }
      seenFeedFingerprint.add(fingerprint);
      // Display name: the org name the tenant states about itself, falling
      // back to the tenant slug (name-integrity review happens at merge).
      const orgName = String(reqs[0]?.PrimaryLocation ?? "") && String(item?.RequisitionOrgName ?? item?.OrganizationName ?? "").trim();
      verified.push({
        name: orgName || tenant,
        source: "oracle",
        token: `${tenant}~${region}~${site}`,
        measuredFirstPage: reqs.length,
        advertisedTotal: Number(item?.TotalJobsCount ?? 0) || null,
        host,
      });
      console.log(`[live] ${tenant}~${region}~${site}: ${reqs.length} on page 1, advertised ${item?.TotalJobsCount ?? "?"}`);
      break; // first answering site wins; one host per employer
    } catch { /* timeout or network — skip site */ }
  }
  await sleep(400);
}

// Append-accumulate across runs, dedupe by token (case-insensitive).
let existing = [];
try { existing = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { /* first run */ }
const byToken = new Map(existing.map((e) => [e.token.toLowerCase(), e]));
for (const v of verified) if (!byToken.has(v.token.toLowerCase())) byToken.set(v.token.toLowerCase(), v);
fs.writeFileSync(OUT, JSON.stringify([...byToken.values()], null, 2));
console.log(`\n[done] probed ${probed}, live this run ${verified.length}, total accumulated ${byToken.size} -> ${OUT}`);
