// Turns the bake's name-gate dry run into the owner's list (owner decision D7).
//
//   PRERENDER_NAME_GATE_REPORT=/tmp/gate.json npx vite build      (any bake)
//   node scripts/prerender-name-gate-report.mjs /tmp/gate.json > docs/company-profiles/name-gate-dry-run.md
//
// The bake writes, where PRERENDER_NAME_GATE_REPORT points, every page that
// is indexable on the live site today and that a stricter rule would drop
// (the name gate's refusals, and a second member of a duplicate group), the
// names it repaired, and the NEW pages it refused. Nothing on the first list
// is dropped in this round: the owner signs it first. Pure text out; reads
// the one file it is given.

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/prerender-name-gate-report.mjs <name-gate.json>");
  process.exit(2);
}
const r = JSON.parse(readFileSync(file, "utf8"));
const row = (cells) => `| ${cells.map((c) => String(c ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
const out = [];
out.push("# Name gate dry run: pages indexable today that a stricter rule would drop");
out.push("");
out.push(`Bake of ${r.builtAt}, facets from ${r.facetsSource ?? "no source"}; ${r.indexableToday} company pages indexable on the live site that day. Written by \`scripts/prerender-name-gate-report.mjs\` from the bake's \`PRERENDER_NAME_GATE_REPORT\` file.`);
out.push("");
out.push("Owner decision D7: no page indexable today drops out without the owner's sign-off. **Every page in the first table keeps its index in this round.** Sign the rows that may drop; the next round makes the gate act on the signed rows only.");
out.push("");
out.push("## 1. Indexable today, and a stricter rule would drop it");
out.push("");
if (r.entries.length) {
  out.push(row(["Page", "Kind", "Name printed", "Why", "What the rule would do", "Sign (drop? yes/no)"]));
  out.push(row(["---", "---", "---", "---", "---", "---"]));
  for (const e of r.entries) out.push(row([`\`${e.path}\``, e.kind, e.name, e.reason, e.would, ""]));
} else out.push("None.");
out.push("");
out.push("## 2. Names repaired (printed differently, index unchanged)");
out.push("");
if (r.repaired.length) {
  // A repair that leaves a single word can read as a place or another
  // employer ("Austin External" -> "Austin"): those are marked for a
  // company_name_overrides row ("Austin Industries", "Mayo Clinic").
  out.push(row(["Page", "Stored name", "Printed name", "Indexable today", "One word: check it names the employer"]));
  out.push(row(["---", "---", "---", "---", "---"]));
  for (const e of r.repaired) out.push(row([`\`${e.path}\``, e.shown, e.printed, e.indexableToday ? "yes" : "no", e.singleWord ? "yes (add an override if it reads as a place or another employer)" : ""]));
} else out.push("None.");
out.push("");
out.push("## 3. New pages refused (never indexable before this bake)");
out.push("");
if (r.refusedNew.length) {
  out.push(row(["Page", "Name", "Why"]));
  out.push(row(["---", "---", "---"]));
  for (const e of r.refusedNew) out.push(row([`\`${e.path}\``, e.name, e.reason]));
} else out.push("None in this bake.");
out.push("");
console.log(out.join("\n"));
