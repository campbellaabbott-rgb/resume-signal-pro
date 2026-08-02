// Find ATS boards hiding on employers' OWN hostnames.
//
// WHY THIS CHANNEL. Every census so far has queried the vendor's domain —
// *.pinpointhq.com, *.teamtailor.com — and by construction cannot see a board
// served at careers.acme.co.uk. The Pinpoint census (scripts/census-pinpoint.mjs)
// hit that wall explicitly: capture-recapture put the population near 340 boards
// against the 109 we carry, certificate transparency was a dead end because
// tenants sit behind a wildcard cert, and it named custom domains as the one
// untried route.
//
// WHAT THIS RUN MEASURED, 2026-08-01, on 4,000 .co.uk domains from Tranco:
//
//     236 of 4,000 have a careers.* CNAME at all
//      27 of those point at ext.teamtailor.com
//      20 serve a real feed
//      17 are NOT in our catalog  -> 282 postings
//       0 point at Pinpoint
//
// So the channel is real and it pays, but NOT for the vendor it was built for.
// Pinpoint's custom domains exist — careers.riverisland.com is one, 60 postings
// — and there were none in 4,000 UK domains, which says they are rare rather
// than absent. Teamtailor's are common: it was the single most frequent
// careers-CNAME target in the sample, ahead of every other ATS.
//
// TEAMTAILOR IS THE RIGHT TARGET FOR THIS TOOL, and the corpus should follow
// the vendor. Teamtailor is Swedish; this pilot ran .co.uk because it was
// hunting Pinpoint, which is British. Running .se/.no/.dk/.fi should yield more
// per domain than .co.uk did, and that is untested.
//
// TWO THINGS TO SETTLE BEFORE ANY OF THIS CAN BE INGESTED:
//
//   1. Is there an underlying {token}.teamtailor.com for each custom domain? If
//      yes, nothing new is needed — add the token like any other board. If no,
//      the ingester needs a host override, because it builds feed URLs from the
//      token alone. Personio already carries its winning host, so the shape
//      exists; it is ~5 call sites. THIS IS UNRESOLVED. The feeds do not name
//      their tenant, so it has to be answered before the merge, not assumed.
//
//   2. The "not in our catalog" count is NAME-matched against the companies
//      facet, which is fuzzy. "Pennon Group" serving careers.southwestwater.co.uk
//      is exactly the shape that defeats it. Treat 17 as an upper bound until
//      each candidate is checked token-first by the census-merge protocol.
//
// DISCOVERY ONLY. A CNAME proves where a hostname points, and a feed proves
// jobs exist today. Neither proves the board belongs in the catalog — the
// corporate-only rule and the merge quality gates still apply.
//
//   node scripts/census-custom-domains.mjs top-1m.csv .co.uk 4000 out.json

import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** CNAME targets that identify the ATS behind a custom domain. */
const VENDOR_BY_CNAME = [
  [/ext\.teamtailor\.com/i, "teamtailor"],
  [/d3p6l7ched4xva\.cloudfront\.net/i, "pinpoint"],
  [/\.breezy\.hr/i, "breezy"],
  [/\.personio\./i, "personio"],
];

/** Where each vendor serves a machine-readable feed on a custom domain. */
const FEED = {
  teamtailor: { path: "/jobs.json", count: (d) => (d?.items ?? []).length, name: (d) => d?.title ?? "" },
  pinpoint: { path: "/postings.json", count: (d) => (Array.isArray(d) ? d : d?.data ?? []).length, name: () => "" },
  breezy: { path: "/json", count: (d) => (Array.isArray(d) ? d : []).length, name: () => "" },
  personio: { path: "/xml", count: () => 0, name: () => "" },
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
      const idx = i++;
      const r = await fn(items[idx]);
      if (r) out.push(r);
    }
  }));
  return out;
}

async function main() {
  const [file, tld = ".co.uk", limitRaw = "4000", outPath = "custom-domains.json"] = process.argv.slice(2);
  if (!file) { console.error("usage: node scripts/census-custom-domains.mjs <tranco.csv> [tld] [limit] [out]"); process.exit(2); }

  const domains = readFileSync(file, "utf8").split("\n")
    .map((l) => l.split(",")[1]?.trim()).filter(Boolean)
    .filter((d) => d.endsWith(tld)).slice(0, Number(limitRaw));
  console.log(`  ${domains.length.toLocaleString()} ${tld} domains`);

  // STAGE 1 — DNS. Two orders of magnitude cheaper than an HTTPS fetch, and it
  // discards ~94% of the corpus before anything is downloaded.
  const named = await pool(domains, 60, async (d) => {
    for (const prefix of ["careers", "jobs"]) {
      const host = `${prefix}.${d}`;
      const cname = await sh("dig", ["+short", "+time=2", "+tries=1", "CNAME", host]);
      if (!cname || cname.includes("connection timed out")) continue;
      const hit = VENDOR_BY_CNAME.find(([re]) => re.test(cname));
      if (hit) return { host, cname: cname.trim(), vendor: hit[1] };
    }
    return null;
  });
  console.log(`  ${named.length} on a known ATS CNAME`);

  // STAGE 2 — the feed. A CNAME says where the hostname points; only the feed
  // says whether anyone is hiring there today. A board with zero jobs is a real
  // state, not a parse failure, and it is not worth carrying.
  const verified = await pool(named, 12, async (c) => {
    const spec = FEED[c.vendor];
    if (!spec) return null;
    const body = await sh("curl", ["-s", "--max-time", "20", `https://${c.host}${spec.path}`]);
    if (!body) return null;
    try {
      const parsed = JSON.parse(body);
      const jobs = spec.count(parsed);
      return jobs > 0 ? { ...c, jobs, name: spec.name(parsed) } : null;
    } catch { return null; }
  });

  verified.sort((a, b) => b.jobs - a.jobs);
  const byVendor = {};
  for (const v of verified) byVendor[v.vendor] = (byVendor[v.vendor] ?? 0) + 1;

  console.log(`\n  ${verified.length} boards serving real jobs:`);
  for (const v of verified) console.log(`    ${String(v.jobs).padStart(4)}  ${(v.name || "").slice(0, 30).padEnd(30)} ${v.host}`);
  console.log(`\n  by vendor: ${JSON.stringify(byVendor)}`);
  console.log(`  total postings: ${verified.reduce((n, v) => n + v.jobs, 0).toLocaleString()}`);

  writeFileSync(outPath, JSON.stringify(verified, null, 1));
  console.log(`\n  -> ${outPath}`);
  console.log("  NOT catalog-ready: each still needs token-first dedupe and the");
  console.log("  corporate-only rule applied by the census-merge protocol.");
}

main();
