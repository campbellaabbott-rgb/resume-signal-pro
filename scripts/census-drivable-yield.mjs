#!/usr/bin/env node
// The custom-domain discovery method again — this time AIMED.
//
// WHY REPEAT IT AT ALL. census-custom-domains.mjs swept a million Tranco
// domains and found 806 live boards, of which 394 were genuinely new: 5,359
// postings on vendors the apply agent can drive. That is a third again on top
// of the entire drivable set, from a channel a subdomain census cannot see at
// all — only 43 of 437 resolved boards were already carried. The seam is real
// and it is not exhausted.
//
// WHY IT HAS TO BE AIMED THIS TIME, which is the whole point of this file.
// The Pinpoint census picked its target by YIELD PER BOARD:
//
//     vendor      boards  producing  postings  per live board
//     pinpoint        87         85     3,716          43.7
//     breezy       1,005        827    11,287          13.6
//     teamtailor   1,534      1,069     9,768           9.1
//     personio     2,367      1,299     4,752           3.7
//
// Pinpoint wins that table by five times, so the custom-domain tool was built
// to hunt Pinpoint. It then swept 1,000,000 domains and found ONE Pinpoint
// board. Teamtailor — fourth by nothing, third by yield — was 801 of 806.
//
// Yield per board was not the wrong number. It was half of one:
//
//     drivable postings per 1,000 domains swept
//        = (boards discovered per 1,000 domains) x (postings per board)
//
// The left factor was never measured, and it turned out to vary by three orders
// of magnitude between vendors on the same corpus. A ranking built on the right
// factor alone sent an afternoon and 2M DNS queries at the vendor with the best
// yield and effectively no discoverability.
//
// So this script computes BOTH, live, and ranks on the product. It also refuses
// to rank a vendor the worker cannot drive: a Workday board is more postings
// and zero applications, and this whole channel exists to feed the agent.
//
// TWO PHASES, and the first is worth running on its own.
//
//   rank   join sources.ts to the live companiesFacet — the same method that
//          corrected the vendor shares in worker/RECON.md — and print the
//          drivable yield table. Seconds, no sweep.
//   sweep  run the discovery in that ranked order over a Tranco corpus and
//          report the discovery rate per vendor, which is the factor nobody has
//          measured. The output makes the NEXT corpus choice evidential.
//
// DISCOVERY ONLY. A CNAME proves where a hostname points; a feed proves someone
// is hiring there today. Neither proves the board belongs in the catalog — the
// corporate-only rule and token-first dedupe still apply, and the merge guard's
// collision rule (a drivable vendor may enter even when the employer name is
// already carried on a walled one) is what decides.
//
//   node scripts/census-drivable-yield.mjs rank
//   node scripts/census-drivable-yield.mjs sweep <tranco.csv> [tld] [limit] [out.json]

import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The vendors the WORKER can drive, mirrored from
 * supabase/functions/_shared/apply-automation.ts, which is itself a mirror of
 * worker/src/vendors/index.ts kept honest by src/test/sendable-mirror.test.ts.
 *
 * A third copy, and it is a copy on purpose: this is a plain .mjs script with
 * no TypeScript pipeline, and importing the Deno module would need one. The
 * test below pins it to the others so it cannot drift silently — a stale list
 * here would aim the sweep at a vendor we cannot apply to, which is the exact
 * failure this file exists to stop.
 */
// oracle added 2026-08-19 with its adapter (~14,000 postings). Kept in sync
// with SENDABLE_VENDORS by src/test/drivable-yield-census.test.ts and
// src/test/collision-prefers-reach.test.ts — a census that ranks a different
// set from the one the agent can drive optimises for the wrong boards.
const DRIVABLE = ["breezy", "oracle", "personio", "pinpoint", "teamtailor"];

/** CNAME targets that identify the ATS behind an employer's own hostname. */
const VENDOR_BY_CNAME = [
  [/ext\.teamtailor\.com/i, "teamtailor"],
  [/d3p6l7ched4xva\.cloudfront\.net/i, "pinpoint"],
  [/\.breezy\.hr/i, "breezy"],
  [/\.personio\./i, "personio"],
];

/** Where each vendor serves a machine-readable feed on a custom domain. */
const ORACLE_FINDER = "/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
  + "?onlyData=true&expand=requisitionList"
  + "&finder=findReqs%3BsiteNumber%3DCX_1%2Climit%3D25%2Coffset%3D0";

const FEED = {
  teamtailor: { path: "/jobs.json", count: (d) => (d?.items ?? []).length },
  pinpoint: { path: "/postings.json", count: (d) => (Array.isArray(d) ? d : d?.data ?? []).length },
  breezy: { path: "/json", count: (d) => (Array.isArray(d) ? d : []).length },
  // Personio serves XML, not JSON. Counted as a DISCOVERY with an unknown job
  // count rather than as zero — reporting 0 would rank it last on evidence it
  // never produced, which is how a non-measurement becomes a finding.
  personio: { path: "/xml", count: () => null },
  // ORACLE IS SHAPED DIFFERENTLY from the other four, and the difference is not
  // cosmetic: its token is `tenant~region~site`, not a hostname, and the feed
  // is the CE REST finder rather than a path appended to a board host. The
  // count comes from the requisitionList the fetcher already reads.
  //
  // path is the finder query; the caller composes it against
  // https://{tenant}.fa.{region}.oraclecloud.com — see fetchOracle in
  // supabase/functions/job-board/index.ts, which is the authority on this shape.
  oracle: { path: ORACLE_FINDER, count: (d) => (d?.items?.[0]?.requisitionList ?? []).length },
};

const sh = async (cmd, args) => {
  try { return (await run(cmd, args, { timeout: 15_000 })).stdout.trim(); }
  catch { return ""; }
};

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const r = await fn(items[i++]);
      if (r) out.push(r);
    }
  }));
  return out;
}

// ---------------------------------------------------------------- phase: rank

/**
 * Every board we carry, by vendor.
 *
 * SOURCES.TS HOLDS TWO ENTRY FORMS and reading only one is a mistake this
 * repository has already made and written down. RECON: "a regex requiring
 * `token:` and `source:` adjacent reported 0 teamtailor tokens in sources.ts,
 * where there are 1,535 — that one would have turned 'already covered' into
 * 'all new'." The file was later part-converted to an `s(name, vendor, token)`
 * constructor to dodge a TypeScript union blow-up, and the older object
 * literals stayed. The constructor form alone parses to ~12,000 entries and
 * contains not one breezy, personio, pinpoint or teamtailor board.
 *
 * So a total-row guard does not protect anything here: the first version of
 * this function cleared a 1,000-row floor comfortably and printed a yield table
 * of zeros for all four vendors it exists to rank. The guard has to be the
 * thing being measured — every drivable vendor is known to have boards, so a
 * vendor with none is a parse failure and never a finding.
 */
function carriedBoards() {
  const src = readFileSync(join(root, "supabase/functions/job-board/sources.ts"), "utf8");
  const rows = [
    ...[...src.matchAll(/\bs\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"([a-z0-9_]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)]
      .map((m) => ({ name: m[1], vendor: m[2], token: m[3] })),
    // Tolerates the optional suffixes (per-board window override, agency
    // disclosure flag — both 2026-08-31): this parse anchored straight onto
    // the closing brace and silently unmatched every suffixed entry. The
    // zero-boards guard below only fires when a whole VENDOR vanishes, so a
    // few dozen tagged pinpoint/breezy boards dropping out would have skewed
    // the yield table without tripping anything.
    ...[...src.matchAll(/\{\s*name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*source:\s*"([a-z0-9_]+)"\s*,\s*token:\s*"((?:[^"\\]|\\.)*)"(?:,\s*pages:\s*\d+)?(?:,\s*agency:\s*true)?\s*\}/g)]
      .map((m) => ({ name: m[1], vendor: m[2], token: m[3] })),
  ];
  for (const vendor of DRIVABLE) {
    const n = rows.filter((r) => r.vendor === vendor).length;
    if (n === 0) {
      throw new Error(`sources.ts parsed to ${rows.length} entries and ZERO for ${vendor} — the entry form has changed. Fix the pattern; do not trust this run.`);
    }
  }
  return rows;
}

/** Live per-company posting counts from the board's own facets RPC. */
async function liveFacets() {
  const envText = (() => { try { return readFileSync(join(root, ".env"), "utf8"); } catch { return ""; } })();
  const grab = (k) => process.env[k] || (envText.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
  const url = grab("VITE_SUPABASE_URL");
  const key = grab("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not found (.env or environment)");

  // Same retry ladder prerender-seo uses: this RPC is heavy over the live
  // corpus and flakes cold. A single failed call would print a yield table of
  // zeros, which reads like a finding.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000));
    try {
      const r = await fetch(`${url}/rest/v1/rpc/get_job_board_facets`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(25_000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && Array.isArray(j.companiesFacet) && j.companiesFacet.length > 100) return j;
    } catch { /* retry */ }
  }
  throw new Error("get_job_board_facets did not return a usable payload after 5 tries");
}

/**
 * Postings per PRODUCING board, per drivable vendor.
 *
 * Producing, not carried, and that distinction is load-bearing: 1,073 of 2,368
 * Personio boards produce nothing at all, and they are stale tenants rather
 * than an ingestion bug (measured, see RECON). Dividing by carried boards would
 * report Personio's yield as roughly half its real one and mis-rank the sweep.
 */
function yieldTable(boards, facet) {
  // The facet keys the count by company token. Vendors share a token namespace
  // in principle; in practice a collision would over-count, so a token claimed
  // by two vendors is counted for neither and reported.
  const owners = new Map();
  for (const b of boards) {
    const set = owners.get(b.token) ?? new Set();
    set.add(b.vendor);
    owners.set(b.token, set);
  }
  const counts = new Map();
  for (const c of facet.companiesFacet) {
    const token = String(c.token ?? c.company_token ?? c.value ?? "");
    const n = Number(c.count ?? c.n ?? 0);
    if (token) counts.set(token, n);
  }

  const rows = [];
  for (const vendor of DRIVABLE) {
    const mine = boards.filter((b) => b.vendor === vendor);
    const clean = mine.filter((b) => (owners.get(b.token)?.size ?? 1) === 1);
    const producing = clean.filter((b) => (counts.get(b.token) ?? 0) > 0);
    const postings = producing.reduce((n, b) => n + (counts.get(b.token) ?? 0), 0);
    rows.push({
      vendor,
      carried: mine.length,
      ambiguousTokens: mine.length - clean.length,
      producing: producing.length,
      postings,
      perProducingBoard: producing.length ? postings / producing.length : 0,
    });
  }
  return rows.sort((a, b) => b.perProducingBoard - a.perProducingBoard);
}

// --------------------------------------------------------------- phase: sweep

async function sweep(file, tld, limit, outPath, ranking) {
  const domains = readFileSync(file, "utf8").split("\n")
    .map((l) => l.split(",")[1]?.trim() || l.trim())
    .filter(Boolean)
    .filter((d) => d.endsWith(tld))
    .slice(0, limit);
  console.log(`  ${domains.length.toLocaleString()} ${tld} domains`);
  if (!domains.length) { console.log("  nothing to sweep"); return; }

  // Ranked order, so the CNAME table is tested best-first. On a full sweep this
  // changes nothing about what is FOUND — every hostname is resolved once and
  // matched against every pattern. It changes what is found FIRST, which is
  // what makes an interrupted or bounded run still informative rather than
  // alphabetically arbitrary.
  const patterns = [...VENDOR_BY_CNAME].sort(
    (a, b) => (ranking.get(b[1]) ?? 0) - (ranking.get(a[1]) ?? 0));

  // STAGE 1 — DNS. Two orders of magnitude cheaper than an HTTPS fetch, and it
  // discards the great majority of the corpus before anything is downloaded.
  let resolved = 0;
  // WHAT THE INSTRUMENT COULD NOT SEE, kept rather than discarded.
  //
  // The .de pilot resolved 418 careers/jobs CNAMEs out of 3,000 domains and
  // matched TWO. Read as a result that says "German employers do not use
  // drivable ATSs". Read as a measurement it says nothing of the kind: 416
  // hostnames pointed somewhere this table has no pattern for, and a pattern
  // table with four entries cannot distinguish "no drivable board here" from
  // "a drivable board we have no fingerprint for".
  //
  // RECON has this lesson five times over, in the same words each time —
  // SmartRecruiters written off because querySelectorAll cannot enter a shadow
  // root, Teamtailor's file input hidden behind a cookie banner, Recruitee
  // passing a CAPTCHA probe because it proxies hCaptcha from its own CDN. Check
  // whether the instrument can see the thing before concluding it is absent.
  //
  // So the misses are counted by target. A vendor sitting at the top of this
  // list is a fingerprint worth adding; a long flat tail of CDNs and website
  // builders is evidence the table is not what is limiting the sweep.
  const misses = new Map();
  const named = await pool(domains, 60, async (d) => {
    for (const prefix of ["careers", "jobs"]) {
      const host = `${prefix}.${d}`;
      const cname = await sh("dig", ["+short", "+time=2", "+tries=1", "CNAME", host]);
      if (!cname || cname.includes("connection timed out")) continue;
      resolved++;
      const hit = patterns.find(([re]) => re.test(cname));
      if (hit) return { host, cname: cname.trim(), vendor: hit[1] };
      // Group by registrable-ish suffix: the last three labels, so a thousand
      // per-tenant hostnames collapse to the platform behind them.
      const target = cname.trim().split("\n")[0].replace(/\.$/, "").split(".").slice(-3).join(".");
      if (target) misses.set(target, (misses.get(target) ?? 0) + 1);
    }
    return null;
  });
  console.log(`  ${resolved} careers/jobs CNAMEs exist · ${named.length} on a drivable ATS`);

  const topMisses = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (topMisses.length) {
    console.log(`\n  the ${resolved - named.length} this table has no fingerprint for, by target:`);
    for (const [target, n] of topMisses) console.log(`    ${String(n).padStart(4)}  ${target}`);
  }

  // STAGE 2 — the feed. A CNAME says where a hostname points; only the feed
  // says whether anyone is hiring there today. Zero jobs is a real state.
  const verified = await pool(named, 12, async (c) => {
    const spec = FEED[c.vendor];
    if (!spec) return null;
    const body = await sh("curl", ["-s", "--max-time", "20", `https://${c.host}${spec.path}`]);
    if (!body) return null;
    try {
      const jobs = spec.count(JSON.parse(body));
      // null means "this vendor's feed is not JSON and was not counted" — a
      // discovery with an unknown size, never a board with no jobs.
      if (jobs === null) return { ...c, jobs: null };
      return jobs > 0 ? { ...c, jobs } : null;
    } catch {
      // Personio's XML lands here. A body that names a posting is a board.
      return /<position>/i.test(body) ? { ...c, jobs: null } : null;
    }
  });

  // THE NUMBER THIS SCRIPT EXISTS FOR: drivable postings per 1,000 domains,
  // which is discovery rate x yield and is the only figure that ranks a corpus.
  const per1k = (n) => (n / domains.length) * 1000;
  const byVendor = {};
  for (const v of verified) {
    const b = byVendor[v.vendor] ?? (byVendor[v.vendor] = { boards: 0, postings: 0, uncounted: 0 });
    b.boards++;
    if (typeof v.jobs === "number") b.postings += v.jobs; else b.uncounted++;
  }

  console.log(`\n  per 1,000 ${tld} domains swept:`);
  console.log("  vendor        boards/1k   postings/1k   yield/board (live)   uncounted");
  for (const vendor of Object.keys(byVendor).sort((a, b) => per1k(byVendor[b].postings) - per1k(byVendor[a].postings))) {
    const b = byVendor[vendor];
    console.log(
      `  ${vendor.padEnd(12)} ${per1k(b.boards).toFixed(2).padStart(9)} ${per1k(b.postings).toFixed(1).padStart(13)}` +
      ` ${(ranking.get(vendor) ?? 0).toFixed(1).padStart(20)} ${String(b.uncounted).padStart(11)}`);
  }
  for (const vendor of DRIVABLE) {
    if (!byVendor[vendor]) console.log(`  ${vendor.padEnd(12)} ${"0.00".padStart(9)} — not one board in this corpus`);
  }

  verified.sort((a, b) => (b.jobs ?? 0) - (a.jobs ?? 0));
  writeFileSync(outPath, JSON.stringify({ tld, sweptDomains: domains.length, boards: verified }, null, 1));
  console.log(`\n  -> ${outPath}`);
  console.log("  NOT catalog-ready: token-first dedupe, the corporate-only rule and the");
  console.log("  merge guard's collision rule still decide what may enter sources.ts.");
}

// ---------------------------------------------------------------------- main

async function main() {
  const [phase = "rank", ...rest] = process.argv.slice(2);

  const boards = carriedBoards();
  const facet = await liveFacets();
  const table = yieldTable(boards, facet);

  console.log(`\n  DRIVABLE YIELD, live (${new Date().toISOString().slice(0, 10)})`);
  console.log("  vendor        carried  producing  postings   per producing board");
  for (const r of table) {
    console.log(
      `  ${r.vendor.padEnd(12)} ${String(r.carried).padStart(8)} ${String(r.producing).padStart(10)}` +
      ` ${String(r.postings).padStart(9)} ${r.perProducingBoard.toFixed(1).padStart(21)}` +
      (r.ambiguousTokens ? `   (${r.ambiguousTokens} tokens claimed by 2+ vendors, excluded)` : ""));
  }
  console.log("\n  Yield per board is HALF the ranking. The other half is how many boards");
  console.log("  a corpus actually surfaces, which only `sweep` measures — and on the");
  console.log("  1M-domain run those two factors disagreed by three orders of magnitude.");

  const ranking = new Map(table.map((r) => [r.vendor, r.perProducingBoard]));

  if (phase === "rank") return;
  if (phase !== "sweep") { console.error(`unknown phase: ${phase}`); process.exit(2); }

  const [file, tld = ".com", limitRaw = "4000", outPath = "drivable-yield.json"] = rest;
  if (!file) {
    console.error("usage: node scripts/census-drivable-yield.mjs sweep <tranco.csv> [tld] [limit] [out.json]");
    process.exit(2);
  }
  console.log("");
  await sweep(file, tld, Number(limitRaw), outPath, ranking);
}

main().catch((e) => { console.error(`  FAILED: ${e.message}`); process.exit(1); });
