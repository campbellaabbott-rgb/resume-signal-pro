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

const VENDORS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "bamboohr", "recruitee", "teamtailor", "personio", "breezy", "rippling", "workday", "pinpoint"];
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
const NAME_BLOCK = /\b(staffing|recruit(ing|ment|er)?s?|talents?|headhunt|personnel|manpower|workforce|employment\s+(agency|services)|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal|demo|test|sample|sandbox|placeholder)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;
// Corporate-only policy: public-sector entities never enter the catalog
// (mobile audit 2026-07-18 found City of Baltimore et al. had slipped in
// through census waves — 22 boards curated out, these patterns keep the
// door shut). Word-boundary specific to avoid nuking "Gibson County Coal
// LLC"-style private names: require the GOVERNMENTAL phrase, not the word.
const GOV_BLOCK = /\b(city of|county of|state of|commonwealth of|government of|unified school|school district|public schools|public library|court of appeals|county commissioners|conservation district|health district|sheriff|police department|fire department|township of|municipality)\b/i;
const TOKEN_BLOCK = /(demo|test|sample|sandbox|staging)/i;

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
    if (!name || NAME_BLOCK.test(name) || GOV_BLOCK.test(name)) { dropped.blockedName++; continue; }
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
