#!/usr/bin/env node
// Census round-3 merge: apply the census-merge quality protocol to verified
// boards (any vendor, multiple input files) and append survivors to sources.ts.
// Protocol (ops runbook): quality filters (blocklist, collision guard,
// ≥3 postings, name-integrity) → staffing-mill screen for boards ≥100 postings
// (posting-TEXT sampling) → dupe check (case-insensitive per vendor, BOTH
// sources.ts entry formats) → battery → publish → live-verify.
//
// Usage: node scripts/merge-all.mjs <verified.json> [more.json…] [--apply]

import fs from "node:fs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const files = args.filter((a) => a !== "--apply");
const SOURCES = "supabase/functions/job-board/sources.ts";
const src = fs.readFileSync(SOURCES, "utf8");

const VENDORS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "bamboohr", "recruitee", "teamtailor", "personio", "breezy", "rippling", "workday", "pinpoint", "paylocity", "adp", "icims", "ukg"];
const verified = Object.fromEntries(VENDORS.map((v) => [v, []]));
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const v of VENDORS) if (Array.isArray(data[v])) verified[v].push(...data[v]);
}

// `talent\s` REQUIRED A TRAILING SPACE, so "Job&Talent" — Jobandtalent France,
// one of Europe's largest temp-staffing platforms — walked straight through on
// a string boundary and was merged as a corporate employer. Its postings are
// repeated warehouse roles naming the client outright
// ("A08-RHENUS-Préparateur de commandes"), and the TEXT screen cannot catch it
// either: the evidence is in the titles, not in a phrase like "notre client".
// `talents?` inside the existing word boundaries matches the name wherever it
// sits. A company called "…Talent" is in the talent business.
//
// Non-English terms added for the same reason the mill screen needed them: the
// vendors this catalogue grows fastest on are European. intérim, uitzend,
// Zeitarbeit and Personaldienst are the industry's own words, not ordinary
// ones — no legitimate manufacturer is called Zeitarbeit GmbH.
// TWO ALTERNATIONS, because two different shapes of name leak.
//
// Whole words, bounded both sides: "Job&Talent" (Jobandtalent France, a large
// European temp-staffing platform) was merged as a corporate employer because
// the old pattern was `talent\s` and required a trailing space. `talents?`
// inside the boundaries catches it wherever it sits, and still leaves
// "Talentum" alone — the trailing boundary fails on the "u".
//
// Prefixes, bounded only on the left: Dutch and German compound nouns run the
// word on ("Uitzendbureau", "Personaldienstleistungen"), so a right-hand
// boundary never matches. These are the industry's own regulated terms; no
// manufacturer is called Zeitarbeit GmbH.
const NAME_BLOCK = /\b(staffing|recruit(ing|ment|er)?s?|talents?|headhunt|personnel|manpower|workforce|employment\s+(agency|services)|placements?\b|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal|demo|test|sample|sandbox|placeholder)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;
// The staffing HALF of the gate above, junk terms removed, because the two
// halves now have different fates under the 2026-08-31 charter: a junk name
// is still refused, a staffing name is CARRIED AND DISCLOSED. This is the
// regex that decides the catalog's disclosure flag on every future merge —
// keep its staffing vocabulary in lockstep with NAME_BLOCK's, and with
// scripts/tag-agencies.mjs, which stamped the existing catalog with the same
// spelling.
// "talent" and "workforce" were removed from this vocabulary 2026-08-31:
// they tagged employers' own in-house portals (Cummins Talent Acquisition,
// Molina Talent...) as staffing firms. A true agency almost always carries
// the remaining words or sits in the conviction list by token.
const AGENCY_NAME = /\b(staffing|recruit(ing|ment|er)?s?|headhunt|personnel|manpower|employment\s+(agency|services)|placements?\b|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;
// Corporate-only policy: public-sector entities never enter the catalog
// (mobile audit 2026-07-18 found City of Baltimore et al. had slipped in
// through census waves — 22 boards curated out, these patterns keep the
// door shut). Word-boundary specific to avoid nuking "Gibson County Coal
// LLC"-style private names: require the GOVERNMENTAL phrase, not the word.
const GOV_BLOCK = /\b(city of|county of|state of|commonwealth of|government of|unified school|school district|public schools|public library|court of appeals|county commissioners|conservation district|health district|sheriff|police department|fire department|township of|municipality)\b/i;
const JUNK_NAME = /\b(demo|test|sample|sandbox|placeholder)\b/i;
const TOKEN_BLOCK = /(demo|test|sample|sandbox|staging|-dev\d*\b)/i;

// Boards a DESCRIPTION screen convicted as placement mills, plus recruiters
// identified by their own self-description. The mill screen degrades to a
// titles-only pass when a vendor throttles descriptions, and a titles-only
// pass cleared two of these on 2026-08-30 — five days of throttling nearly
// undid a ban that had only ever lived in a human's head. This set is the
// memory the fallback lacks; entries name the screen that convicted them.
const MILL_BLOCK = new Set([
  // CHARTER CHANGE 2026-08-31: the staffing-agency convictions were RELEASED
  // when the operator widened the board to carry agencies (Collabera, CTG,
  // ubteam and the rest merge like anyone now). What remains is the JUNK
  // ledger — boards whose postings are not real openings in any charter:
  "workable:next-job-abroad",        // 2026-08-30: 4 distinct titles across 3,530 postings — duplicate spam
  "workable:schwertfels",            // 2026-08-30: 4 distinct titles across 1,001 postings — duplicate spam
  "rippling:barrys-careers",         // 2026-08-30: 4 distinct titles across 20 sampled of 232 — duplicate spam
  "recruitee:tabmed",                // 2026-08-31: 2 distinct titles across 293 postings — duplicate spam
  "paylocity:35773120-a5ca-428a-9823-7eac16a36683", // 2026-08-31: 1 title x 215 — duplicate spam
  "paylocity:3b20a513-df4d-4667-8583-8968328f0ac9", // 2026-08-31: 1 title x 104 — duplicate spam
  "paylocity:668dc5ae-50dc-451f-bc59-bdc869ac7bbe", // 2026-08-31: 1 title x 114 — duplicate spam
  "greenhouse:n2alljobs",            // 2026-08-31: duplicate all-jobs board — double-counts, any charter
  // Greenhouse's own documentation tenant. Removed once (the King-of-Rohan
  // sweep), re-merged by the 2026-08-31 census wave because neither the token
  // gate nor the junk-name gate matches its spelling — the demo-tenant screen
  // caught it at battery time instead of merge time. Fake in any charter.
  "greenhouse:example",              // 2026-08-31: vendor demo tenant (Democorp), fictional postings
]);

// Paylocity boards self-name with a page heading the employer typed, and
// verify-all resolves the real employer from posting structured data. This is
// the backstop for the ones that never resolved: a heading built entirely
// from hiring vocabulary would enter the catalog as a company named like a
// page title. Word set rather than phrase list — headings arrive in every
// arrangement of the same few dozen words. Duplicated from verify-all by
// hand, as the census scripts share nothing by import.
//
// adp shares the backstop (2026-08-31) with a harder starting point: its
// payloads never name the employer AT ALL, so verify-all mines the branding
// config's welcome prose and logo filename and leaves the name EMPTY when
// neither carries identity. The empty names fall to the blockedName gate
// above — enumerated and counted, but held out of the catalog until a name
// resolution step earns them one, the oracle discipline. This word-set gate
// is for the mined names that DID resolve but resolved to hiring vocabulary.
const HIRING_VOCAB = new Set([
  "all", "and", "apply", "at", "available", "board", "career", "careers",
  "current", "currently", "default", "employment", "external", "for", "here",
  "hiring", "internal", "job", "jobs", "join", "listing", "listings", "new",
  "now", "open", "opening", "openings", "opportunities", "opportunity", "our",
  "page", "portal", "position", "positions", "posting", "postings",
  "recruiting", "recruitment", "search", "team", "the", "us", "vacancies",
  "vacancy", "we", "we're", "welcome", "with", "work",
]);
const headingOnly = (name) => {
  const words = String(name).toLowerCase().replace(/[^a-z0-9']+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length === 0 || words.every((w) => HIRING_VOCAB.has(w));
};

// Pinpoint seeds every trial tenant with the same 6 demo postings, and a
// company that trials Pinpoint without going live serves ONLY those — under
// its real name and token, so NAME_BLOCK and TOKEN_BLOCK never fire. 111
// such tenants (469 fake servable postings) shipped through two census
// waves before the 2026-08-24 audit caught them by content. The fingerprint
// is the title set: a small pinpoint board whose every title is canned is a
// sandbox, whatever its name is. Full-subset only — mixed boards
// (pinpoint:accenture, kempinski: 2 canned of 296 real) must pass.
const PINPOINT_DEMO_TITLES = new Set([
  "Customer Service Rep", "Head of DEI - Belfast", "Head of DEI - UK",
  "Head of DEI - US", "Marketing Executive", "Marketing Manager",
]);
async function isPinpointDemoSandbox(token) {
  try {
    const host = token.includes(".") ? token : `${token}.pinpointhq.com`;
    const res = await fetch(`https://${host}/postings.json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false; // unreachable is a different problem — don't hide it here
    const body = await res.json();
    const titles = (Array.isArray(body?.data) ? body.data : [])
      .map((p) => String(p?.title ?? "").trim()).filter(Boolean);
    return titles.length > 0 && titles.every((t) => PINPOINT_DEMO_TITLES.has(t));
  } catch { return false; }
}

// Existing catalog in BOTH entry formats: object literals ({ name, source,
// token }) from rung 3+, and the legacy s("Name", "vendor", "token") helper.
// The round-3 verify pass missed the object format and re-verified ~3k known
// boards — this dedupe is the backstop that keeps them out twice.
//
// Every regex here stops at the field it reads and never anchors on the
// closing brace: object entries carry optional suffixes now (the per-board
// window override, then the agency disclosure flag — both added 2026-08-31),
// and a brace-anchored parse goes blind to exactly the entries that carry
// one. A dedupe blind to a suffixed entry re-merges the board it already
// holds, which the catalog-invariants duplicate guard then has to catch —
// and that guard was itself the first parser to fall into this trap.
const existingTokens = new Set([
  ...[...src.matchAll(/source:\s*"(\w+)",\s*token:\s*"([^"]+)"/g)].map((m) => `${m[1]}:${m[2].toLowerCase()}`),
  ...[...src.matchAll(/s\("(?:[^"\\]|\\.)*",\s*"(\w+)",\s*"([^"]+)"/g)].map((m) => `${m[1]}:${m[2].toLowerCase()}`),
]);
const existingNames = new Set([
  ...[...src.matchAll(/name:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].toLowerCase().trim()),
  ...[...src.matchAll(/s\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].toLowerCase().trim()),
]);

// WHICH VENDOR EACH EXISTING NAME IS CARRIED ON, so a collision can be judged
// rather than just counted.
const nameVendors = new Map();
const noteName = (n, v) => {
  const k = n.toLowerCase().trim();
  if (!nameVendors.has(k)) nameVendors.set(k, new Set());
  nameVendors.get(k).add(v);
};
for (const m of src.matchAll(/name:\s*"((?:[^"\\]|\\.)*)",\s*source:\s*"(\w+)"/g)) noteName(m[1], m[2]);
for (const m of src.matchAll(/s\("((?:[^"\\]|\\.)*)",\s*"(\w+)"/g)) noteName(m[1], m[2]);

/**
 * THE FOUR VENDORS THE APPLY AGENT CAN ACTUALLY DRIVE.
 *
 * Mirrors _shared/apply-automation's SENDABLE_VENDORS (agent_reach() also held a copy until it was dropped 2026-08-06). Kept as a literal rather
 * than imported because this is a Node script and that is Deno — the drift risk
 * is real, so a test asserts the two lists agree.
 */
// oracle added 2026-08-19 with its adapter. This set decides collision
// tie-breaks — when two censuses carry the same employer on different vendors,
// the drivable one wins because it is worth more to a subscriber. Leaving
// oracle out would have kept sending those collisions to a non-drivable
// carrier and quietly costing the agent reach it now has.
const DRIVABLE = new Set(["breezy", "oracle", "teamtailor", "personio", "pinpoint"]);
console.log(`catalog: ${existingTokens.size} tokens, ${existingNames.size} names`);

const decodeEntities = (s) => s
  .replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const keep = {};
const dropped = { blockedName: 0, blockedToken: 0, dupe: 0, nameCollision: 0 };
const millWorklist = [];
for (const vendor of VENDORS) {
  keep[vendor] = [];
  const seen = new Set();
  for (const b of verified[vendor]) {
    const name = decodeEntities(String(b.name ?? "")).trim();
    const tokenKey = `${vendor}:${b.token.toLowerCase()}`;
    const nameKey = name.toLowerCase();
    if (TOKEN_BLOCK.test(b.token)) { dropped.blockedToken++; continue; }
    if (MILL_BLOCK.has(tokenKey)) { dropped.confirmedMill = (dropped.confirmedMill ?? 0) + 1; continue; }
    // Content fingerprint, small pinpoint boards only (sandboxes measured
    // 2-6 postings; 12 leaves margin without fetching real boards).
    if (vendor === "pinpoint" && b.count <= 12 && await isPinpointDemoSandbox(b.token)) {
      dropped.pinpointDemo = (dropped.pinpointDemo ?? 0) + 1; continue;
    }
    // CHARTER CHANGE 2026-08-31: staffing agencies and government employers
    // are carried now (operator decision — an agency's board is first-party
    // for the agency's own openings, and a city hires like any employer).
    // NAME_BLOCK and GOV_BLOCK stay defined for tooling that reads them, but
    // the merge gate keeps only the JUNK half: demo/test/sample names are
    // fake boards regardless of charter.
    if (!name || JUNK_NAME.test(name)) { dropped.blockedName++; continue; }
    if ((vendor === "paylocity" || vendor === "adp") && headingOnly(name)) {
      dropped.headingOnlyName = (dropped.headingOnlyName ?? 0) + 1; continue;
    }
    if (seen.has(tokenKey) || existingTokens.has(tokenKey)) { dropped.dupe++; continue; }
    // COLLISION, BUT NOT ALL COLLISIONS ARE EQUAL.
    //
    // The guard exists so one employer does not appear twice. That is right for
    // a catalog judged on tidiness, and wrong for one judged on what the agent
    // can act on: 38 of the 57 Pinpoint boards found on 2026-08-05 collided
    // with employers we ALREADY carry on a WALLED vendor. Accenture, Next and
    // HelloFresh publish to Pinpoint and to Workday, and we were keeping the
    // Workday one — holding the copy the agent can never apply to.
    //
    // So a collision is only fatal when it does not buy reach. If the incoming
    // vendor is drivable and every vendor already carrying that name is not,
    // the new board is admitted: the employer appears twice, once appliable.
    // Duplicate display is already handled by the name-keyed employer
    // clustering; an unappliable posting is not handled by anything.
    //
    // Deliberately NOT a replacement of the existing entry. Dropping the walled
    // token would orphan-prune its postings, and a Workday board can carry
    // hundreds against Pinpoint's handful — the board would shrink to make the
    // agent look better, which is the wrong trade and would trip the catalog
    // high-water guard besides.
    if (existingNames.has(nameKey)) {
      const carriers = nameVendors.get(nameKey) ?? new Set();
      const buysReach = DRIVABLE.has(vendor) && [...carriers].every((v) => !DRIVABLE.has(v));
      if (!buysReach) { dropped.nameCollision++; continue; }
      dropped.collisionAdmittedForReach = (dropped.collisionAdmittedForReach ?? 0) + 1;
    }
    seen.add(tokenKey);
    keep[vendor].push({ ...b, name });
    if (b.count >= 100) millWorklist.push({ vendor, ...b, name });
  }
}

const totals = Object.entries(keep).filter(([, l]) => l.length)
  .map(([v, list]) => `${v}=${list.length} boards/${list.reduce((s, x) => s + x.count, 0)}p`);
console.log("Post-filter:", totals.join(", "));
console.log("Dropped:", JSON.stringify(dropped));
console.log(`Mill-screen worklist (>=100 postings): ${millWorklist.length} boards`);
fs.writeFileSync("round3-mill-worklist.json", JSON.stringify(millWorklist, null, 1));

if (!APPLY) {
  console.log("\nDry run only. Run mill-screen-all.mjs, then re-run with --apply.");
  process.exit(0);
}

let cleared = null;
// Boards the mill screen cleared WITH phrase evidence (the clear~ verdict).
// Under the 2026-08-31 charter that evidence no longer excludes — it earns
// the catalog entry a disclosure flag instead, and the cleared file is how
// the evidence travels from the screen to this merge.
const agencyEvidence = new Set();
try {
  const clearedRows = JSON.parse(fs.readFileSync("round3-mill-cleared.json", "utf8"));
  cleared = new Set(clearedRows.map((x) => `${x.vendor}:${x.token}`));
  for (const x of clearedRows) if (x.agency === true) agencyEvidence.add(`${x.vendor}:${x.token}`);
} catch { /* no file */ }
if (millWorklist.length > 0 && !cleared) {
  console.error("REFUSING to apply: mill-screen worklist is non-empty and round3-mill-cleared.json is missing.");
  process.exit(1);
}
if (cleared) {
  for (const vendor of VENDORS) {
    keep[vendor] = keep[vendor].filter((b) => b.count < 100 || cleared.has(`${vendor}:${b.token}`));
  }
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const lines = [];
let taggedAgencies = 0;
for (const vendor of VENDORS) {
  for (const b of keep[vendor]) {
    // AGENCY DISCLOSURE rides the entry from the moment it merges: a staffing
    // name, or phrase evidence the mill screen carried through the cleared
    // file, stamps the flag that ingest copies onto every posting row. This
    // merge never emits a pages override, so the flag is the last field —
    // when a board later gains one, the override goes BEFORE the flag, the
    // one suffix order every catalog parser tolerates.
    const isAgency = AGENCY_NAME.test(b.name) || agencyEvidence.has(`${vendor}:${b.token}`);
    if (isAgency) taggedAgencies++;
    lines.push(`  { name: "${esc(b.name)}", source: "${vendor}", token: "${esc(b.token)}"${isAgency ? ", agency: true" : ""} },`);
  }
}
const marker = src.lastIndexOf("];");
if (marker === -1) { console.error("sources.ts: JOB_SOURCES closing not found"); process.exit(1); }
const banner = `  // ── Census round 3 + Rippling (merged ${new Date().toISOString().slice(0, 10)}): all vendors, official-API verified ≥3 postings, mill-screened ──\n`;
const next = src.slice(0, marker) + banner + lines.join("\n") + "\n" + src.slice(marker);
fs.writeFileSync(SOURCES, next);
console.log(`\nAPPLIED: ${lines.length} boards appended to sources.ts (${taggedAgencies} carry the agency disclosure flag)`);
