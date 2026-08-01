#!/usr/bin/env node
// Pinpoint census — the vendor the earlier rounds skipped.
//
// WHY THIS ONE, AND WHY NOW. Measured 2026-08-01 by joining sources.ts to the
// live companiesFacet counts, across the four vendors the apply agent can
// actually drive:
//
//     vendor      boards  producing  postings  per live board
//     pinpoint        87         85     3,716          43.7
//     breezy       1,005        827    11,287          13.6
//     teamtailor   1,534      1,069     9,768           9.1
//     personio     2,367      1,299     4,752           3.7
//
// Pinpoint yields five times what Breezy does per board and twelve times
// Personio — and we carry 87 boards against their one to two thousand. It is
// not a small vendor; it is a vendor nobody censused. census-rung3.mjs covered
// Recruitee, Teamtailor, Breezy and Personio and simply never included it.
//
// That matters more than usual because Pinpoint is one of only four vendors
// with no bot wall on the apply form (see worker/RECON.md). Every other route
// to more auto-appliable jobs is closed on evidence, so postings discovered
// here are worth more than the same number on Workday would be.
//
// DISCOVERY ONLY. A token appearing in Common Crawl proves a page once existed
// at that host, nothing more. Every candidate still has to pass live
// verification against Pinpoint's own API and the census-merge quality
// protocol before it may enter sources.ts. The verification step is where
// truth enters; this script only proposes.
//
// WHAT THIS RUN ACTUALLY FOUND, 2026-08-01, recorded so the next person starts
// from evidence instead of repeating it:
//
//   * Common Crawl is a THIN channel for Pinpoint. Three indexes returned one
//     page each and 43 distinct tokens between them; one index returned none at
//     all. Compare Workday, where the same approach returns thousands.
//   * 32 of the 43 were new. 22 verified live with >=3 postings — a 69% hit
//     rate, so the candidates CDX does surface are good ones. 877 postings.
//   * CERTIFICATE TRANSPARENCY IS A DEAD END HERE, and it looked promising.
//     crt.sh returns 961 cert rows for %.pinpointhq.com and only 19 distinct
//     labels, every one of them Pinpoint's own infrastructure — billing, blog,
//     changelog, fastly, developers. Tenant boards sit behind a WILDCARD
//     certificate, so they never appear individually. Do not spend an afternoon
//     on this again.
//   * Pinpoint publishes no customer list. /customers/ and /case-studies/
//     redirect to a marketing page naming four subdomains, all their own.
//
// HOW BIG IS THE POPULATION, roughly. Capture-recapture on the two samples: 87
// boards already carried, 43 found by this census, 11 in both. Lincoln-Petersen
// puts the total near (87 x 43) / 11 = ~340 boards. Treat that as an order of
// magnitude and not a target: the estimator assumes the two samples are
// independent, and if the original 87 also came from a crawl index they are
// not — both would favour well-crawled hosts, which biases the estimate DOWN.
// So ~340 is a floor, and roughly 230 boards are still undiscovered.
//
// Finding them needs a channel that does not depend on crawl coverage or on
// certificates. The untried one is custom domains: Pinpoint serves many boards
// on the employer's own hostname (careers.riverisland.com is one), and those
// are invisible to a *.pinpointhq.com query no matter how deep it goes.
//
// Usage: node scripts/census-pinpoint.mjs [output.json]

import fs from "node:fs";

const OUT = process.argv[2] || "pinpoint-census.json";
const CDX = "https://index.commoncrawl.org";
const HOST_SUFFIX = ".pinpointhq.com";

// Subdomain labels that are vendor infrastructure, never an employer board.
// Same list the rung-3 census used, so a label rejected there is rejected here.
const NOT_COMPANY = new Set([
  "www", "api", "app", "apps", "auth", "login", "signup", "blog", "help", "docs",
  "support", "status", "cdn", "assets", "static", "mail", "email", "marketing",
  "admin", "dashboard", "my", "go", "get", "try", "demo", "sandbox", "staging",
  "test", "dev", "careers", "jobs", "hire", "portal", "connect", "developers",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "resumebooster.work census (contact: support@resumebooster.work)" },
      });
      if (res.status === 503 || res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      return res;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

async function latestIndexes(n = 3) {
  const res = await fetchRetry(`${CDX}/collinfo.json`);
  if (!res || !res.ok) return [];
  const all = await res.json();
  // Three crawls rather than the rung-3 two. Pinpoint is a smaller vendor, so
  // any single crawl samples fewer of its hosts, and the cost of an extra index
  // is minutes against a vendor worth 43.7 postings a board.
  return all.slice(0, n).map((c) => c.id);
}

async function censusIndex(indexId) {
  const base = `${CDX}/${indexId}-index?url=${encodeURIComponent("*.pinpointhq.com/*")}&output=json&fl=url&collapse=urlkey`;
  const npRes = await fetchRetry(`${base}&showNumPages=true`);
  if (!npRes || !npRes.ok) {
    console.log(`  ${indexId}: no page count — index unavailable, skipping`);
    return new Set();
  }
  const pages = Number((await npRes.json()).pages) || 0;
  const tokens = new Set();
  console.log(`  ${indexId}: ${pages} pages`);
  for (let p = 0; p < pages; p++) {
    const res = await fetchRetry(`${base}&page=${p}`);
    if (!res || !res.ok) continue;
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const { url } = JSON.parse(line);
        const host = new URL(url).hostname.toLowerCase();
        if (!host.endsWith(HOST_SUFFIX)) continue;
        const label = host.slice(0, -HOST_SUFFIX.length);
        if (!label || label.includes(".") || NOT_COMPANY.has(label)) continue;
        if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(label)) continue;
        tokens.add(label);
      } catch { /* malformed line — skip rather than abort the page */ }
    }
    await sleep(400); // polite: this is a free public index
    if (p % 10 === 0) console.log(`    page ${p + 1}/${pages}, ${tokens.size} tokens so far`);
  }
  return tokens;
}

const indexes = await latestIndexes(3);
if (!indexes.length) {
  console.error("Could not read Common Crawl index list — nothing written.");
  process.exit(1);
}
console.log("Common Crawl indexes:", indexes.join(", "));

const merged = new Set();
for (const idx of indexes) {
  const t = await censusIndex(idx);
  for (const x of t) merged.add(x);
  console.log(`  running total: ${merged.size} distinct tokens`);
}

// What is genuinely NEW is the number that matters — 87 of these are already
// carried, and reporting the raw count as a discovery would overstate the yield
// by whatever we already had.
const existing = new Set();
try {
  const src = fs.readFileSync("supabase/functions/job-board/sources.ts", "utf8");
  const re = /\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(src))) {
    const b = m[0];
    if (/source:\s*"pinpoint"/.test(b)) {
      const t = /token:\s*"([^"]+)"/.exec(b);
      if (t) existing.add(t[1]);
    }
  }
} catch { /* no sources file in this checkout — everything counts as new */ }

const all = [...merged].sort();
const fresh = all.filter((t) => !existing.has(t));
fs.writeFileSync(OUT, JSON.stringify({ pinpoint: all, new: fresh, alreadyCarried: [...existing].sort() }, null, 1));

console.log(`\n  ${all.length} candidate tokens discovered`);
console.log(`  ${existing.size} already in sources.ts`);
console.log(`  ${fresh.length} NEW candidates -> ${OUT}`);
console.log(`\n  Not yet boards. Every one must pass live verification against`);
console.log(`  https://{token}.pinpointhq.com/postings.json before it is carried.`);
