#!/usr/bin/env node
// Workday census via the Common Crawl COLUMNAR index. The CDX API host
// (index.commoncrawl.org) rate-limited our IP after the day's census volume,
// but the columnar host (data.commoncrawl.org) is reachable — AND only via
// curl (node's fetch fails against it in this environment), so every network
// call shells out to curl. Reads the local cluster.idx (a sparse SURT→block
// map), range-fetches just the blocks covering com,myworkdayjobs,* , gunzips,
// extracts tenant/dc/site, then verifies each against its live public CXS feed.
//
// Usage:
//   node census-workday-cluster.mjs enumerate <cluster.idx> <crawl> <cands.json>
//   node census-workday-cluster.mjs verify <cands.json> <out.json> [maxProbe]

import fs from "node:fs";
import { execFileSync } from "node:child_process";

const MODE = process.argv[2];
const DATA = "https://data.commoncrawl.org";
const UA = "resumebooster.work job board (contact: support@resumebooster.work)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curlRange(url, off, len) {
  try {
    return execFileSync("/usr/bin/curl", [
      "-s", "-m", "30", "-r", `${off}-${off + len - 1}`,
      "-H", `User-Agent: ${UA}`, url, "--output", "-",
    ], { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });
  } catch { return null; }
}
function curlGet(url, method, body) {
  const args = ["-s", "-m", "20", "-H", `User-Agent: ${UA}`];
  if (method === "POST") args.push("-X", "POST", "-H", "Content-Type: application/json", "-H", "Accept: application/json", "-d", body);
  else args.push("-H", "Accept: application/json");
  args.push(url);
  try { return execFileSync("/usr/bin/curl", args, { maxBuffer: 32 * 1024 * 1024, encoding: "utf8" }); } catch { return null; }
}

const LOCALE = /^[a-z]{2}(-[A-Za-z]{2})?$/;
function parseHost(urlStr) {
  try {
    const u = new URL(urlStr);
    const m = u.hostname.toLowerCase().match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
    if (!m) return null;
    const segs = u.pathname.split("/").filter(Boolean);
    if (!segs.length) return null;
    let site = segs[0];
    if (LOCALE.test(site) && segs[1]) site = segs[1];
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(site) || site === "job" || site === "jobs") return null;
    return { tenant: m[1], dc: m[2], site };
  } catch { return null; }
}

if (MODE === "enumerate") {
  const [, , , CLUSTER, CRAWL, OUT] = process.argv;
  const zlib = await import("node:zlib");
  const lines = fs.readFileSync(CLUSTER, "utf8").split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("com,myworkdayjobs,")) {
      const add = (ln) => { const parts = ln.split("\t"); if (parts.length >= 4) blocks.push({ shard: parts[1], off: Number(parts[2]), len: Number(parts[3]) }); };
      if (blocks.length === 0 && i > 0) add(lines[i - 1]);
      add(lines[i]);
    }
  }
  const shard = blocks[0]?.shard;
  console.log(`blocks: ${blocks.length}, shard: ${shard}`);
  const cand = new Map();
  for (const b of blocks) {
    if (!Number.isFinite(b.off) || !Number.isFinite(b.len) || b.len <= 0) continue;
    const buf = curlRange(`${DATA}/cc-index/collections/${CRAWL}/indexes/${b.shard}`, b.off, b.len);
    if (!buf) { process.stdout.write("x"); continue; }
    let txt; try { txt = zlib.gunzipSync(buf).toString("utf8"); } catch { process.stdout.write("z"); continue; }
    for (const ln of txt.split("\n")) {
      const br = ln.indexOf("{"); if (br < 0) continue;
      try { const p = parseHost(JSON.parse(ln.slice(br)).url); if (p) cand.set(`${p.tenant}~${p.dc}~${p.site}`, p); } catch { /* skip */ }
    }
    process.stdout.write(".");
  }
  fs.writeFileSync(OUT, JSON.stringify([...cand.entries()]));
  console.log(`\nenumerated ${cand.size} candidate tenants → ${OUT}`);
} else if (MODE === "verify") {
  const [, , , CANDS, OUT, MAXP] = process.argv;
  const all = JSON.parse(fs.readFileSync(CANDS, "utf8"));
  const srcText = fs.readFileSync(new URL("../supabase/functions/job-board/sources.ts", import.meta.url), "utf8");
  const existing = new Set([
    ...[...srcText.matchAll(/source:\s*"workday",\s*token:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase()),
  ]);
  const verified = [];
  try { for (const b of (JSON.parse(fs.readFileSync(OUT, "utf8")).workday ?? [])) verified.push(b); } catch { /* first */ }
  const done = new Set(verified.map((v) => v.token.toLowerCase()));
  let queue = all.filter(([tok]) => !existing.has(tok.toLowerCase()) && !done.has(tok.toLowerCase()));
  if (Number(MAXP) > 0) queue = queue.slice(0, Number(MAXP));
  console.log(`probing ${queue.length} candidates (${verified.length} already verified)`);
  const prettify = (t) => t.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
  let n = 0;
  for (const [tok, { tenant, dc, site }] of queue) {
    const body = curlGet(`https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, "POST", JSON.stringify({ limit: 20, offset: 0, searchText: "", appliedFacets: {} }));
    if (body) {
      try {
        const items = JSON.parse(body).jobPostings ?? [];
        const fresh = items.filter((j) => { const s = String(j.postedOn ?? "").toLowerCase(); if (/30\+\s*days/.test(s)) return false; const m = s.match(/posted\s+(\d+)\s+days?\s+ago/); return !(m && Number(m[1]) > 30); });
        if (items.length >= 3) verified.push({ token: tok, name: prettify(tenant), count: items.length, fresh: fresh.length });
      } catch { /* not json */ }
    }
    if (++n % 100 === 0) { console.log(`  ${n}/${queue.length}, ${verified.length} verified`); fs.writeFileSync(OUT, JSON.stringify({ workday: verified.sort((a, b) => b.count - a.count) }, null, 1)); }
    await sleep(50);
  }
  verified.sort((a, b) => b.count - a.count);
  fs.writeFileSync(OUT, JSON.stringify({ workday: verified }, null, 1));
  console.log(`Wrote ${OUT}: ${verified.length} boards, ${verified.reduce((s, x) => s + x.count, 0)}p (${verified.reduce((s, x) => s + x.fresh, 0)} fresh)`);
}
