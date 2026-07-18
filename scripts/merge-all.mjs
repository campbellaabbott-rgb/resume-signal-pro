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

const NAME_BLOCK = /\b(staffing|recruit(ing|ment|er)?s?|talent\s|talents\b|headhunt|personnel|manpower|workforce|employment\s+(agency|services)|temp\s|outsourc|bpo\b|demo|test|sample|sandbox|placeholder)\b/i;
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
    if (existingNames.has(nameKey)) { dropped.nameCollision++; continue; }
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
