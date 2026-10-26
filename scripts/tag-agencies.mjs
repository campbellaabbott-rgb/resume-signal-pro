#!/usr/bin/env node
// AGENCY DISCLOSURE, catalog side (2026-08-31 charter change).
//
// The charter widened to carry staffing agencies, so the mill convictions
// that used to EXCLUDE these boards were released — Collabera, CTG, Symicor
// and the rest merge like any employer now. The product answer is
// transparency, not exclusion: every agency board gets `agency: true` on its
// catalog entry, ingest stamps the flag onto every posting row, and the
// board serves it as a badge plus an opt-in "hide staffing agencies" filter.
//
// TWO SOURCES OF TRUTH, both encoded here:
//   1. The released-conviction ledger — boards a human or the description
//      screen positively identified as placement mills/agencies before the
//      charter change. Recovered from git (the pre-release blocklist at
//      commit 8bf45963) so the release of a conviction does not erase what
//      was known. Matched case-insensitively: the catalog stores tokens in
//      the vendor's own casing (Collabera2) while the ledger was lowercase.
//   2. The staffing-vocabulary name screen — the same word list merge-all's
//      name gate uses (its canonical spelling, junk terms removed): a company
//      that names itself with the industry's own regulated terms is in the
//      staffing business, whatever a text sample says.
//
// Idempotent: an entry already carrying the flag is left alone, so re-running
// after a census merge only tags the new arrivals.
//
// Usage: node scripts/tag-agencies.mjs [--dry-run]

import fs from "node:fs";

const SOURCES = "supabase/functions/job-board/sources.ts";
const DRY = process.argv.includes("--dry-run");
const src = fs.readFileSync(SOURCES, "utf8");

// The released convictions, vendor:token lowercased. Everything the
// pre-charter blocklist held EXCEPT the junk ledger (duplicate-title spam and
// double-counting boards are fake in any charter and still never merge), plus
// the agency boards convicted by hand outside that list.
const RELEASED_CONVICTIONS = new Set([
  "workable:solution-sft",           // hospital-nurse placement ads
  "workable:gotham-enterprises",     // near-identical therapist ads, on-behalf language
  "workable:ubteam",                 // recruits on behalf of clients
  "workable:the-symicor-group-1",    // bank-recruiting firm, self-described
  "workable:unitedplacementgroup",   // placement agency
  "teamtailor:bluestorm",            // sampled postings show agency evidence
  "teamtailor:groupelrtechnologies", // sampled postings show agency evidence
  "teamtailor:jobtalentfrance",      // Jobandtalent France, temp-staffing platform
  "teamtailor:wearediverse2",        // sampled postings show agency evidence
  "smartrecruiters:collabera2",      // IT staffing
  "smartrecruiters:procomservices",  // sampled postings show agency evidence
  "smartrecruiters:fosadconsulting", // sampled postings show agency evidence
  "smartrecruiters:iotagroup",       // sampled postings show agency evidence
  "recruitee:techbizglobal",         // sampled postings show agency evidence
  "icims:careers.ctg.com",           // fills positions for singular clients — IT staffing
  "greenhouse:liquidpersonnel",      // social-work staffing agency, self-described
  "greenhouse:crisprecruit",         // recruitment firm, self-described
  "smartrecruiters:meta1",           // "supports several nationally-known clients": staffing (2026-10-25)
  // Jobandtalent, a temp-staffing platform (trust round 3, 2026-10-26). Its board names
  // spell it "Job&Talent", which the name screen's one-word form does not read.
  "teamtailor:jobandtalent",         // Swedish placements: "Vår kund är ett väletablerat företag"
  "lever:jobandtalent",              // its own staff: "placing millions of workers ... thousands of blue-chip clients"
  "teamtailor:multitempo",           // "está a recrutar ... para empresa de referência"; "integração no cliente"
]);

// The staffing half of merge-all's name gate, canonical spelling. The junk
// terms that ride the same gate over there are deliberately absent: a board
// named like a sandbox is refused at merge, never carried-and-tagged.
// "talent" and "workforce" were removed from this vocabulary 2026-08-31:
// they tagged employers' own in-house portals (Cummins Talent Acquisition,
// Molina Talent...) as staffing firms. A true agency almost always carries
// the remaining words or sits in the conviction list by token.
const AGENCY_NAME = /\b(staffing|recruit(ing|ment|er)?s?|headhunt|personnel|manpower|employment\s+(agency|services)|placements?\b|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;

// EMPLOYERS' OWN BOARDS, never tagged (recheck 3, 2026-10-26). The name
// screen reads "Recruitment" in an employer's own portal name (an Oracle or
// UKG tenant's career site: "ENBD Recruitment Team", "Calamos Recruiting") as
// the staffing trade, and two of the convictions above once held State Farm's
// and Principal's own boards for the roles they post for independent agents'
// offices. Each of these posts its own roles (State Farm's: attorneys, claim
// specialists, data scientists), so the "Staffing agency" badge and the
// agency company page were false on them. Matched like the convictions.
const EMPLOYERS_OWN_BOARDS = new Set([
  "icims:jobs.statefarm.com",                                          // State Farm
  "icims:careers.principal.com",                                       // Principal Financial Group
  "ukg:recruiting2~dis1007~08caf206-1236-731a-787b-c3376bc8c99f",      // Goodwill of Colorado
  "oracle:fa-ewqq-saasfaprod1~ocs~cx_1",                               // Hong Kong Baptist University
  "oracle:fa-evxn-saasfaukgovprod1~ocs~cx_1001",                       // Scottish Government (other departments)
  "oracle:fa-evxn-saasfaukgovprod1~ocs~cx_1",                          // Scottish Government
  "oracle:fa-exux-saasfaprod1~ocs~cx_1",                               // Government of Nunavut
  "oracle:fa-evlo-saasfaprod1~ocs~cx_1",                               // Emirates NBD
  "oracle:fa-evlo-saasfaprod1~ocs~cx_1001",                            // Emirates NBD India
  "oracle:fa-evlo-saasfaprod1~ocs~cx_2",                               // Emirates Islamic
  "oracle:ejgo~em2~cx_1",                                              // Farrans
  "ukg:recruiting2~cal1001cala~46b96419-fba6-4dd0-a5fa-715bdfcf845b",  // Calamos
  // Trust round 3 (2026-10-26): the agency audit's other tier-A boards, each read on
  // its employer's own site or feed (~/.config/resumebooster/agency-flags-2026-10-25).
  "ukg:recruiting2~con1074cvtg~1831b61a-1945-44fa-afd8-624795c9b30d",   // Convergint
  "ukg:recruiting~ban1010~e9066a66-c3b9-e25c-d036-116705c05e46",        // Banner Engineering
  "ukg:recruiting~laf1002lafa~1a07d948-3361-48d7-89f2-002c5a48346c",    // Lafayette 148
  "ukg:recruiting2~sap1000spid~5e557a61-9707-4f47-8f76-9c11b2bfbf9e",   // Smart City Networks
  "ukg:recruiting~kil1000~68c62bcb-20f8-3231-d728-9190572df832",        // Kilpatrick Townsend & Stockton
  "ukg:recruiting~low1003lfcs~cfc2ee58-1207-4e12-a838-876cbc96b1f9",    // Lowell Five Bank
  "adp:d290c04e-0230-4cd9-8bf0-f116bfab1405~19000101_000003",           // Synchron
  "adp:4a8a08f1-ff6c-4d60-8308-4b09a199dd38",                           // Highlights for Children
  "adp:30e05070-07b1-4b26-9028-b97dae32cdd1",                           // The Barkan Companies
  "oracle:eify~us6~cx_1001",                                            // Springfield Clinic
  "greenhouse:alphasightsresumedrop",                                   // AlphaSights
  "greenhouse:placementsio",                                            // Placements.io
  "greenhouse:studentplacements",                                       // WellPower
  "lever:crossing-minds",                                               // Crossing Minds
  "teamtailor:geant",                                                   // GÉANT
  "rippling:paradise-media-recruitment",                                // Paradise Media
  "rippling:ferric-recruiting",                                         // Ferric
  "rippling:meundies-recruiting",                                       // MeUndies
  "rippling:lylaw-recruitment",                                         // HPL Yamalova & Plewka
  "rippling:allsup-employment-services",                                // Allsup
]);

const unesc = (s) => s.replace(/\\(.)/g, "$1");
const isAgency = (name, vendor, token) => {
  const key = `${vendor}:${token.toLowerCase()}`;
  return !EMPLOYERS_OWN_BOARDS.has(key) && (RELEASED_CONVICTIONS.has(key) || AGENCY_NAME.test(unesc(name)));
};

// Both catalog entry formats, line by line. Object literals gain the flag in
// place — AFTER the pages override, always, so parsers meet one suffix order.
// s(...) helper lines are REWRITTEN as object literals when tagged: the
// three-argument constructor cannot carry the flag, and every catalog reader
// already parses both formats.
const OBJ = /^(\s*\{ name: "((?:[^"\\]|\\.)*)", source: "(\w+)", token: "((?:[^"\\]|\\.)*)"(?:, pages: \d+)?)( \},?)$/;
const SFN = /^(\s*)s\("((?:[^"\\]|\\.)*)", "(\w+)", "((?:[^"\\]|\\.)*)"\)(,?)$/;

let tagged = 0;
let already = 0;
const byVendor = {};
const lines = src.split("\n").map((line) => {
  if (line.includes("agency: true")) { already++; return line; }
  let m = OBJ.exec(line);
  if (m) {
    const [, head, name, vendor, token, tail] = m;
    if (!isAgency(name, vendor, token)) return line;
    tagged++;
    byVendor[vendor] = (byVendor[vendor] ?? 0) + 1;
    return `${head}, agency: true${tail}`;
  }
  m = SFN.exec(line);
  if (m) {
    const [, indent, name, vendor, token, comma] = m;
    if (!isAgency(name, vendor, token)) return line;
    tagged++;
    byVendor[vendor] = (byVendor[vendor] ?? 0) + 1;
    return `${indent}{ name: "${name}", source: "${vendor}", token: "${token}", agency: true }${comma}`;
  }
  return line;
});

console.log(`tagged ${tagged} boards (${already} already carried the flag)`);
console.log("by vendor:", JSON.stringify(byVendor));

// The released convictions must all have been reachable — a ledger entry the
// catalog no longer carries is worth knowing about, not silently skipping.
const out = lines.join("\n");
const missing = [...RELEASED_CONVICTIONS].filter((k) => {
  const [vendor, token] = k.split(/:(.+)/);
  const re = new RegExp(`source: "${vendor}", token: "${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i");
  return !re.test(out);
});
if (missing.length) console.warn(`ledger entries not in the catalog (dropped or renamed since): ${missing.join(", ")}`);

if (DRY) {
  console.log("dry run — sources.ts untouched");
  process.exit(0);
}
fs.writeFileSync(SOURCES, out);
console.log(`wrote ${SOURCES}`);
