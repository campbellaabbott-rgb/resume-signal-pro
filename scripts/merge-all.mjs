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

const VENDORS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "bamboohr", "recruitee", "teamtailor", "personio", "breezy", "rippling", "workday", "pinpoint", "paylocity", "adp", "icims"];
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
// Corporate-only policy: public-sector entities never enter the catalog
// (mobile audit 2026-07-18 found City of Baltimore et al. had slipped in
// through census waves — 22 boards curated out, these patterns keep the
// door shut). Word-boundary specific to avoid nuking "Gibson County Coal
// LLC"-style private names: require the GOVERNMENTAL phrase, not the word.
const GOV_BLOCK = /\b(city of|county of|state of|commonwealth of|government of|unified school|school district|public schools|public library|court of appeals|county commissioners|conservation district|health district|sheriff|police department|fire department|township of|municipality)\b/i;
const TOKEN_BLOCK = /(demo|test|sample|sandbox|staging|-dev\d*\b)/i;

// Boards a DESCRIPTION screen convicted as placement mills, plus recruiters
// identified by their own self-description. The mill screen degrades to a
// titles-only pass when a vendor throttles descriptions, and a titles-only
// pass cleared two of these on 2026-08-30 — five days of throttling nearly
// undid a ban that had only ever lived in a human's head. This set is the
// memory the fallback lacks; entries name the screen that convicted them.
const MILL_BLOCK = new Set([
  "workable:solution-sft",           // 2026-08-10: hospital-nurse placement ads
  "workable:gotham-enterprises",     // 2026-08-10: near-identical therapist ads, on-behalf language
  "workable:ubteam",                 // 2026-08-10: 6/12 sampled postings recruit on behalf
  "workable:the-symicor-group-1",    // 2026-08-30: bank-recruiting firm, self-described
  "teamtailor:bluestorm",            // 2026-08-30: 2/12 sampled postings show mill evidence
  "teamtailor:groupelrtechnologies", // 2026-08-30: 8/12 sampled postings show mill evidence
  "teamtailor:jobtalentfrance",      // 2026-08-30: staffing brand
  "teamtailor:wearediverse2",        // 2026-08-30: 1/12 sampled postings show mill evidence
  "rippling:barrys-careers",         // 2026-08-30: 4 distinct titles across 20 sampled of 232
  "smartrecruiters:collabera2",      // 2026-08-30: 4/6 sampled postings show mill evidence
  "smartrecruiters:procomservices",  // 2026-08-30: 6/6 sampled postings show mill evidence
  "workable:next-job-abroad",        // 2026-08-30: 4 distinct titles across 3,530 postings
  "workable:unitedplacementgroup",   // 2026-08-30: placement agency, removed once already and re-merged the same day
  "workable:schwertfels",            // 2026-08-30: 4 distinct titles across 1,001 postings
  "smartrecruiters:fosadconsulting", // 2026-08-31: 6/6 sampled postings show mill evidence
  "smartrecruiters:iotagroup",       // 2026-08-31: 3/6 sampled postings show mill evidence
  "recruitee:techbizglobal",         // 2026-08-31: 5/12 sampled postings show mill evidence
  "paylocity:668dc5ae-50dc-451f-bc59-bdc869ac7bbe", // 2026-08-31: Wild Bill's Tobacco, 1 title x 114 postings
  "greenhouse:n2alljobs",            // 2026-08-31: duplicate all-jobs board, removed once and re-merged by a census wave
  "icims:careers.ctg.com",           // 2026-08-31: 10/12 postings fill positions for a singular client — IT staffing
  "icims:jobs.statefarm.com",        // 2026-08-31: corporate board hiring on behalf of independent agents' offices
  "icims:careers.principal.com",     // 2026-08-31: hiring on behalf of affiliated representatives
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
    if (!name || NAME_BLOCK.test(name) || GOV_BLOCK.test(name)) { dropped.blockedName++; continue; }
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
try { cleared = new Set(JSON.parse(fs.readFileSync("round3-mill-cleared.json", "utf8")).map((x) => `${x.vendor}:${x.token}`)); } catch { /* no file */ }
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
for (const vendor of VENDORS) {
  for (const b of keep[vendor]) {
    lines.push(`  { name: "${esc(b.name)}", source: "${vendor}", token: "${esc(b.token)}" },`);
  }
}
const marker = src.lastIndexOf("];");
if (marker === -1) { console.error("sources.ts: JOB_SOURCES closing not found"); process.exit(1); }
const banner = `  // ── Census round 3 + Rippling (merged ${new Date().toISOString().slice(0, 10)}): all vendors, official-API verified ≥3 postings, mill-screened ──\n`;
const next = src.slice(0, marker) + banner + lines.join("\n") + "\n" + src.slice(marker);
fs.writeFileSync(SOURCES, next);
console.log(`\nAPPLIED: ${lines.length} boards appended to sources.ts`);
