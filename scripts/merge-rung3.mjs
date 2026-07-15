#!/usr/bin/env node
// Rung-3 merge: apply the census-merge quality protocol to verified boards and
// append the survivors to sources.ts. Protocol (ops runbook):
//   quality filters (blocklist, collision guard, ≥3 postings, name-integrity)
//   → staffing-mill screen for boards ≥100 postings (posting-TEXT sampling)
//   → dupe check (case-insensitive per vendor) → battery → publish → live-verify.
//
// Usage: node scripts/merge-rung3.mjs <verified.json> [--apply]
//   Without --apply: dry run — prints what would merge + writes the mill-screen
//   worklist. With --apply: appends entries to sources.ts.

import fs from "node:fs";

const [, , VERIFIED_PATH, applyFlag] = process.argv;
const APPLY = applyFlag === "--apply";
const verified = JSON.parse(fs.readFileSync(VERIFIED_PATH, "utf8"));
const SOURCES = "supabase/functions/job-board/sources.ts";
const src = fs.readFileSync(SOURCES, "utf8");

// ── quality filters ──────────────────────────────────────────────────────────
// Names that indicate a staffing mill / agency / placeholder rather than a
// company hiring for itself. Evidence-based additions welcome; conservative bar.
const NAME_BLOCK = /\b(staffing|recruit(ing|ment|er)?s?|talent\s|talents\b|headhunt|personnel|manpower|workforce|employment\s+(agency|services)|temp\s|outsourc|bpo\b|demo|test|sample|sandbox|placeholder)\b/i;
const TOKEN_BLOCK = /(demo|test|sample|sandbox|staging)/i;

// Existing catalog: tokens per vendor (dupe guard) + display names (collision
// guard — the same company live on an old vendor AND a new one double-lists).
const existingTokens = new Set(
  [...src.matchAll(/source:\s*"(\w+)",\s*token:\s*"([^"]+)"/g)].map((m) => `${m[1]}:${m[2].toLowerCase()}`),
);
const existingNames = new Set(
  [...src.matchAll(/name:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].toLowerCase().trim()),
);

const keep = {};
const dropped = { blockedName: 0, blockedToken: 0, dupe: 0, nameCollision: 0 };
const millWorklist = [];

for (const vendor of ["recruitee", "teamtailor", "breezy", "personio"]) {
  keep[vendor] = [];
  const seen = new Set();
  for (const b of verified[vendor] ?? []) {
    const tokenKey = `${vendor}:${b.token.toLowerCase()}`;
    const nameKey = b.name.toLowerCase().trim();
    if (TOKEN_BLOCK.test(b.token)) { dropped.blockedToken++; continue; }
    if (NAME_BLOCK.test(b.name)) { dropped.blockedName++; continue; }
    if (seen.has(tokenKey) || existingTokens.has(tokenKey)) { dropped.dupe++; continue; }
    if (existingNames.has(nameKey)) { dropped.nameCollision++; continue; }
    seen.add(tokenKey);
    keep[vendor].push(b);
    if (b.count >= 100) millWorklist.push({ vendor, ...b });
  }
}

const totals = Object.entries(keep).map(([v, list]) => ({
  vendor: v,
  boards: list.length,
  postings: list.reduce((s, x) => s + x.count, 0),
}));
console.log("Post-filter:", totals.map((t) => `${t.vendor}=${t.boards} boards/${t.postings} postings`).join(", "));
console.log("Dropped:", JSON.stringify(dropped));
console.log(`Mill-screen worklist (>=100 postings): ${millWorklist.length} boards`);
fs.writeFileSync("rung3-mill-worklist.json", JSON.stringify(millWorklist, null, 1));

if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply after the mill screen.");
  process.exit(0);
}

// Mill screen must have run: boards surviving it are listed (possibly pruned)
// in rung3-mill-cleared.json; any worklist board NOT in that file is dropped.
let cleared = null;
try { cleared = new Set(JSON.parse(fs.readFileSync("rung3-mill-cleared.json", "utf8")).map((x) => `${x.vendor}:${x.token}`)); } catch { /* no file */ }
if (millWorklist.length > 0 && !cleared) {
  console.error("REFUSING to apply: mill-screen worklist is non-empty and rung3-mill-cleared.json is missing.");
  process.exit(1);
}
if (cleared) {
  for (const vendor of Object.keys(keep)) {
    keep[vendor] = keep[vendor].filter((b) => b.count < 100 || cleared.has(`${vendor}:${b.token}`));
  }
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const lines = [];
for (const vendor of ["recruitee", "teamtailor", "breezy", "personio"]) {
  for (const b of keep[vendor]) {
    lines.push(`  { name: "${esc(b.name)}", source: "${vendor}", token: "${esc(b.token)}" },`);
  }
}

// Append inside the JOB_SOURCES array: insert before its closing "];".
const marker = src.lastIndexOf("];");
if (marker === -1) { console.error("sources.ts: JOB_SOURCES closing not found"); process.exit(1); }
const banner = `  // ── Rung 3 (merged ${new Date().toISOString().slice(0, 10)}): Recruitee/Teamtailor/Personio/Breezy, census-verified ≥3 postings ──\n`;
const next = src.slice(0, marker) + banner + lines.join("\n") + "\n" + src.slice(marker);
fs.writeFileSync(SOURCES, next);
const finalTotals = Object.entries(keep).map(([v, l]) => `${v}=${l.length}`).join(", ");
console.log(`\nAPPLIED: ${lines.length} boards appended to sources.ts (${finalTotals})`);
