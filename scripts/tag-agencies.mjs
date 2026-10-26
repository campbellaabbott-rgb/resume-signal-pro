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
import { agencyScreenText } from "./census-names.mjs";

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
  "icims:jobs.statefarm.com",        // hires on behalf of independent agents' offices
  "icims:careers.principal.com",     // hires on behalf of affiliated representatives
  "greenhouse:liquidpersonnel",      // social-work staffing agency, self-described
  "greenhouse:crisprecruit",         // recruitment firm, self-described
  // 2026-10-25: once names mined from labels stopped counting, this flag lost
  // its name evidence, but the site names itself a staffing agency in its own
  // feed (TrueBlue's tenant, recruitingCESites CX_1 "Your Industrial Staffing
  // Agency | PeopleReady", read that day), which is a self-description.
  "oracle:ehnn~us2~cx_1",            // PeopleReady, industrial staffing, self-described
]);

// The staffing half of merge-all's name gate, canonical spelling. The junk
// terms that ride the same gate over there are deliberately absent: a board
// named like a sandbox is refused at merge, never carried-and-tagged.
// "talent" and "workforce" were removed from this vocabulary 2026-08-31:
// they tagged employers' own in-house portals (Cummins Talent Acquisition,
// Molina Talent...) as staffing firms. A true agency almost always carries
// the remaining words or sits in the conviction list by token.
//
// The screen reads agencyScreenText (scripts/census-names.mjs), not the raw
// name (trusted-pages round 2026-10-25). UKG, Oracle and ADP names were mined
// from labels by the old tools, so they are read as the census reads a
// label: what the label adds comes off ("US - LLC Recruiting", a logo label,
// made Convergint a flagged agency, hidden by the hide-agencies filter;
// "Calamos Recruiting" is Calamos), and the name that remains IS screened
// ("Avant Staffing Professionals" stays flagged; the review, 2026-10-26). An
// employer's own recruiting portal ("X Recruiting Portal", "X Campus
// Recruiting") is a department, so that phrase is read out of every name,
// and a name the census rule refuses whole is not screened at all.
const AGENCY_NAME = /\b(staffing|recruit(ing|ment|er)?s?|headhunt|personnel|manpower|employment\s+(agency|services)|placements?\b|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;

const unesc = (s) => s.replace(/\\(.)/g, "$1");
const isAgency = (name, vendor, token) =>
  RELEASED_CONVICTIONS.has(`${vendor}:${token.toLowerCase()}`) || AGENCY_NAME.test(agencyScreenText(vendor, unesc(name)));

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
// Flags already in the catalog that neither of this tool's two sources
// supports any more. The tool never removes a flag (a flag may rest on the
// mill screen's phrase evidence, which the catalog does not record), so these
// are printed for a person to judge, never edited.
const unsupported = [];
const FLAGGED = /\{ name: "((?:[^"\\]|\\.)*)", source: "(\w+)", token: "((?:[^"\\]|\\.)*)"/;
const lines = src.split("\n").map((line) => {
  if (line.includes("agency: true")) {
    already++;
    const f = FLAGGED.exec(line);
    if (f && !isAgency(f[1], f[2], f[3])) unsupported.push(`${f[2]}:${f[3]} "${unesc(f[1])}"`);
    return line;
  }
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
if (unsupported.length) {
  console.log(`${unsupported.length} carried flags rest on neither the conviction ledger nor the name screen (left as they are; judge each by its postings):`);
  for (const u of unsupported) console.log(`  ${u}`);
}

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
