// REVIEW SHEETS FOR THE HAND PASS (spec §19.2: AFTER gets the same hand review
// BEFORE had). One sheet per résumé, one line per shown row with the v2
// rubric's automatic verdict, and under it the description phrases a reviewer
// checks: sponsorship, citizenship, clearance, licence, years, work mode.
// Corrections go to src/test/fixtures/match-bench/judgments/overrides.json
// (per résumé x posting, through ovr.py) or posting-facts.json (a posting's own
// metadata); every later report re-reads them, for BEFORE and AFTER alike.
//
// usage:
//   ./node_modules/.bin/tsx scripts/match-bench/review.ts --after out/after-extract.json [--descriptions out/descriptions-after.json] [id ...]
//   ./node_modules/.bin/tsx scripts/match-bench/review.ts --before            (BEFORE's exact top-20s, from the frozen run)
// Writes out/review/<after|before>/<id>.txt.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUT, ROOT } from "./paths.ts";
import { anyDescription } from "../../src/test/fixtures/match-bench/corpus.ts";
import { RESUMES } from "../../src/test/fixtures/match-bench/dev/manifest.ts";
import { CITIZEN_OR_PR, CITIZEN_REQUIRED, CLEARANCE_ACTIVE, CLEARANCE_OBTAIN, CLEARANCE_REQUIRED, judge, NO_SPONSOR_V2, normaliseUS } from "../../src/test/fixtures/match-bench/judge.ts";
import { beforeRanked, postingRow } from "../../src/test/fixtures/match-bench/metrics.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const afterFile = arg("--after");
const descFile = arg("--descriptions");
const kind = afterFile ? "after" : "before";
const only = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const extra: Record<string, { text: string | null }> = descFile && existsSync(resolve(ROOT, descFile)) ? JSON.parse(readFileSync(resolve(ROOT, descFile), "utf8")) : {};
const desc = (id: string) => anyDescription(id) ?? extra[id]?.text ?? null;

const shown: Record<string, string[]> = afterFile
  ? JSON.parse(readFileSync(resolve(ROOT, afterFile), "utf8"))
  : Object.fromEntries(beforeRanked().filter((b) => b.exact).map((b) => [b.id, b.ranked.slice(0, 20).map((x) => x.row.id)]));

function flags(raw: string | null): string {
  if (!raw) return "NO DESCRIPTION";
  const d = normaliseUS(raw);
  const f: string[] = [];
  const m = (re: RegExp) => { const x = new RegExp(re.source, "i").exec(d); return x ? d.slice(Math.max(0, x.index - 30), x.index + x[0].length + 40).replace(/\s+/g, " ") : null; };
  const add = (tag: string, re: RegExp) => { const s = m(re); if (s) f.push(`${tag}«${s}»`); };
  add("SPONSOR", NO_SPONSOR_V2);
  add("CITIZEN", CITIZEN_REQUIRED);
  add("CIT/PR", CITIZEN_OR_PR);
  add("CLEAR", CLEARANCE_ACTIVE);
  add("CLEAR-REQ", CLEARANCE_REQUIRED);
  add("CLEAR-OBTAIN", CLEARANCE_OBTAIN);
  add("YRS", /\b\d{1,2}\s*\+?\s*(?:-|to|–)?\s*\d{0,2}\s*\+?\s*years?\b[^.]{0,50}/);
  add("LIC", /\b(licen[cs]e[d]?|licensure|registration|certification required|credential|NMC|journeyman|CDL)\b[^.]{0,60}/);
  add("MODE", /\b(remote|hybrid|on-?site|in office)\b[^.]{0,40}/);
  return f.join(" ");
}

const dir = join(OUT, "review", kind);
mkdirSync(dir, { recursive: true });
for (const t of RESUMES) {
  if (only.length && !only.includes(t.id)) continue;
  const ids = (shown[t.id] ?? []).slice(0, 20);
  const lines = [`### ${t.id}  ${kind.toUpperCase()} top ${ids.length}  home=${t.home} relocate=${JSON.stringify(t.relocate)} auth=${t.authorized} yrs=${t.years} held=${t.held.map((h) => h.label).join("; ") || "-"}`];
  ids.forEach((id, i) => {
    const row = postingRow(id);
    const d = desc(id);
    const v = judge(t, row, d, "v2");
    const tag = `${v.shortlist ? "YES" : "no "} ${v.role[0]}${v.seniority === "ok" ? "" : v.seniority === "too_junior" ? " JUN" : " SEN"}${v.location === "mismatch" ? " LOC" : v.location === "unknown" ? " loc?" : ""}${v.auth === "fail" ? " AUTH" : ""}${v.licence === "fail" ? " LIC" : ""}${v.reviewed ? " *" : ""}`;
    lines.push(`${String(i + 1).padStart(2)} [${tag.padEnd(18)}] ${row.title} | ${row.company ?? ""} | ${row.location ?? ""} | ${row.country ?? "-"} ${row.workMode ?? ""} my=${row.minYears ?? ""} b=${row.experienceBand ?? ""}${row.agency ? " AGENCY" : ""}  id=${id}`);
    lines.push(`        ${v.reasons.slice(1).join("; ").slice(0, 300)}`);
    lines.push(`        ${flags(d).slice(0, 500)}`);
  });
  writeFileSync(join(dir, `${t.id}.txt`), lines.join("\n") + "\n");
}
console.log(`wrote ${dir}`);
