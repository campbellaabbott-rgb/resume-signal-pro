// THE REPORT: BEFORE, the prototype and AFTER side by side, like with like.
//
// Every column is judged by the same rubric on the same résumés: exact-11 next
// to exact-11, all-24 next to all-24, each rate with its denominator. BEFORE is
// replayed from its frozen measurement; AFTER runs the engine's own code
// offline against the frozen corpus (src/test/fixtures/match-bench/
// after-pipeline.ts). Nothing here touches the network.
//
// usage (from the repo root):
//   ./node_modules/.bin/tsx scripts/match-bench/report.ts                 print the table
//   ... --engine <checkout>      run AFTER from another checkout (or MATCH_ENGINE_ROOT)
//   ... --save-before            write baselines/before.json (BEFORE and the prototype, both rubrics)
//   ... --save-after --ref "<what was measured>"
//                                write baselines/v1.json: the AFTER baseline the CI gate holds
//   ... --gate                   exit 1 when the CI gate's rule fails (the same rule as the test)
//   ... --verbose                per-résumé rows and the held-out reader's misses (bench owner only:
//                                the held-out set is never shown to the engine's authors to tune on)
// It writes out/after-<mode>.json (shown ids per résumé) for review.ts and describe.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUT, ROOT } from "./paths.ts";
import {
  AFTER_BASELINE_FILE, BEFORE_BASELINE_FILE, engineReadiness, gateFailures, GATE_TOLERANCE, loadAfterBaseline, loadBeforeBaseline,
  measureAfter, measureReader, readerFailures, withoutMisses, type AfterBaseline, type AfterMeasure, type BeforeBaseline,
} from "../../src/test/fixtures/match-bench/bench.ts";
import { judgeLists, judgeShown, protoLegacyDescription, protoShown, replayBefore, summarizeLists, toPostingRow, type SetSummary } from "../../src/test/fixtures/match-bench/metrics.ts";
import { HELDOUT } from "../../src/test/fixtures/match-bench/heldout/manifest.ts";
import { targetLines } from "../../src/test/fixtures/match-bench/reader-score.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const flag = (k: string) => process.argv.includes(k);
const engineRoot = resolve(arg("--engine") ?? process.env.MATCH_ENGINE_ROOT ?? ROOT);
mkdirSync(OUT, { recursive: true });

// ─── BEFORE and the prototype ──────────────────────────────────────────────
function beforeAndProto(): BeforeBaseline {
  const legacy = replayBefore("legacy");
  const v2 = replayBefore("v2");
  const proto = {} as BeforeBaseline["proto"];
  for (const k of ["extract", "oracle"] as const) {
    const l = judgeShown(protoShown(k), "legacy", protoLegacyDescription);
    const v = judgeShown(protoShown(k), "v2");
    proto[k] = { legacy: { exact11: l.exact11, all24: l.all24 }, v2: { exact11: v.exact11, all24: v.all24 } };
  }
  return {
    recordedAt: new Date().toISOString(),
    note: "BEFORE = wave-3 main 65f7e5bc, measured 2026-10-12 (legacy = the rubric as it ran; v2 = licences, clearance and auth wording read). proto = the Requirements-First prototype's shown rows (auto-judged, dev set).",
    legacy: { exact11: legacy.exact11, all24: legacy.all24 },
    v2: { exact11: v2.exact11, all24: v2.all24 },
    proto,
  };
}

const B = beforeAndProto();
if (flag("--save-before")) {
  writeFileSync(BEFORE_BASELINE_FILE, JSON.stringify(B, null, 1) + "\n");
  console.log(`wrote ${BEFORE_BASELINE_FILE}`);
}

// ─── AFTER ─────────────────────────────────────────────────────────────────
const ready = engineReadiness(engineRoot);
let extract: AfterMeasure | null = null;
let oracle: AfterMeasure | null = null;
let reader: Awaited<ReturnType<typeof measureReader>> | null = null;
let corpusVersion = "";
if (ready.kind === "ready") {
  const e = await measureAfter("extract", engineRoot);
  extract = e.measure;
  corpusVersion = e.corpusVersion;
  writeFileSync(join(OUT, "after-extract.json"), JSON.stringify(Object.fromEntries(e.per.map((p) => [p.id, p.rows])), null, 1));
  const o = await measureAfter("oracle", engineRoot);
  oracle = o.measure;
  writeFileSync(join(OUT, "after-oracle.json"), JSON.stringify(Object.fromEntries(o.per.map((p) => [p.id, p.rows])), null, 1));
  reader = await measureReader(engineRoot);
  if (flag("--verbose")) {
    for (const p of e.per) console.log(`  ${p.id.padEnd(34)} rows ${String(p.rows.length).padStart(2)}  shortlisted ${String(extract.perResume[p.id].shortlisted).padStart(2)}  family ${p.family}  steps ${p.steps.join(",")}  ring ${p.ringSource}  ${p.wallMs} ms`);
  }
} else {
  console.log(`AFTER not measured: ${ready.message}`);
}

// ─── The table ─────────────────────────────────────────────────────────────
const f = (x: number | null | undefined) => (x == null ? "  -  " : `${x}`);
const p = (s: SetSummary) => `${f(s.p10)} / ${f(s.p20)}`;
const loc = (s: SetSummary) => `${f(s.location)}% (${s.locationRows}/${s.shown})`;
const sen = (s: SetSummary) => `${f(s.seniority)}% (${s.seniorityRows}/${s.infield})`;
type Col = { name: string; exact11: SetSummary | null; all24: SetSummary | null; beforeAll?: BeforeBaseline["v2"]["all24"] };
const cols: Col[] = [
  { name: "BEFORE legacy (as run)", exact11: B.legacy.exact11, all24: null, beforeAll: B.legacy.all24 },
  { name: "BEFORE v2", exact11: B.v2.exact11, all24: null, beforeAll: B.v2.all24 },
  { name: "proto v2 (auto)", exact11: B.proto.extract.v2.exact11, all24: B.proto.extract.v2.all24 },
  ...(extract ? [{ name: "AFTER v2 extract", exact11: extract.exact11, all24: extract.all24 }] : []),
  ...(oracle ? [{ name: "AFTER v2 oracle", exact11: oracle.exact11, all24: oracle.all24 }] : []),
];
const rows: Array<[string, (c: Col) => string]> = [
  ["P@10 / P@20, exact 11", (c) => (c.exact11 ? p(c.exact11) : "-")],
  ["P@10 / P@20, all 24", (c) => (c.all24 ? p(c.all24) : c.beforeAll ? `[${c.beforeAll.p10Lower}, ${c.beforeAll.p10Upper}] / [${c.beforeAll.p20Lower}, ${c.beforeAll.p20Upper}]` : "-")],
  ["location mismatch, exact-11 top 20", (c) => (c.exact11 ? loc(c.exact11) : "-")],
  ["location mismatch, all-24 top 20", (c) => (c.all24 ? loc(c.all24) : c.beforeAll ? `pool ${c.beforeAll.poolLocation}%` : "-")],
  ["seniority mismatch, exact 11", (c) => (c.exact11 ? sen(c.exact11) : "-")],
  ["seniority mismatch, all 24", (c) => (c.all24 ? sen(c.all24) : "-")],
  ["licence fails shown, exact 11", (c) => (c.exact11 ? `${c.exact11.licenceFail}` : "-")],
  ["rows with a description read (exact 11)", (c) => (c.exact11 ? `${c.exact11.descRead}/${c.exact11.shown}` : "-")],
  ["rows with a hand review (exact 11)", (c) => (c.exact11 ? `${c.exact11.reviewed}/${c.exact11.shown}` : "-")],
  ["résumés under 10 rows / at zero (all 24)", (c) => (c.all24 ? `${c.all24.under10} / ${c.all24.zero}` : "-")],
];
const w0 = Math.max(...rows.map((r) => r[0].length)) + 2;
const ws = cols.map((c) => Math.max(c.name.length, ...rows.map((r) => r[1](c).length)) + 2);
console.log("\n" + "metric".padEnd(w0) + cols.map((c, i) => c.name.padEnd(ws[i])).join(""));
for (const [name, get] of rows) console.log(name.padEnd(w0) + cols.map((c, i) => get(c).padEnd(ws[i])).join(""));
console.log(`\nCaveat: the AFTER and prototype columns are auto-judged on the dev set (the prototype and the engine were tuned on these 24);
the offline AFTER run is a closed world (only postings an earlier run retrieved; requirements only where one read a description).
No AFTER row has a hand review yet. A gate verdict for v1 needs the held-out AFTER run and its hand review (spec §19.2).`);

// BEFORE on the held-out set, once before-retrieve / describe / before-score have run from a ledger.
const hoScored = join(OUT, "before-heldout-scored.json");
if (existsSync(hoScored)) {
  const scored = JSON.parse(readFileSync(hoScored, "utf8")) as Array<{ id: string; exact: boolean; ranked: Array<{ row: Record<string, unknown> & { id: string } }> }>;
  const hoDesc: Record<string, { text: string | null }> = existsSync(join(OUT, "descriptions-before-heldout.json")) ? JSON.parse(readFileSync(join(OUT, "descriptions-before-heldout.json"), "utf8")) : {};
  const rowById = new Map(scored.flatMap((s) => s.ranked.map((x) => [x.row.id, toPostingRow(x.row as never)] as const)));
  const exact = scored.filter((s) => s.exact);
  const lists = judgeLists(HELDOUT.filter((h) => exact.some((s) => s.id === h.id)), Object.fromEntries(exact.map((s) => [s.id, s.ranked.slice(0, 20).map((x) => x.row.id)])), "v2", (id) => hoDesc[id]?.text ?? null, (id) => rowById.get(id)!);
  const sum = summarizeLists(lists);
  console.log(`\nBEFORE on the held-out set (v2 rubric, ${exact.length} of ${scored.length} pools exact): P@10 ${f(sum.p10)} / P@20 ${f(sum.p20)}, location ${loc(sum)}, seniority ${sen(sum)}, reviewed ${sum.reviewed}/${sum.shown}`);
}

if (reader) {
  console.log("\nHeld-out profile reader (60 résumés written blind):");
  for (const l of targetLines(reader)) console.log("  " + l);
  if (flag("--verbose")) console.log("  misses:", JSON.stringify(reader.misses));
}

// ─── Save and gate ─────────────────────────────────────────────────────────
if (flag("--save-after")) {
  if (!extract) throw new Error("--save-after needs the engine: " + (ready.kind === "ready" ? "" : ready.message));
  const ref = arg("--ref");
  if (!ref) throw new Error("--save-after needs --ref \"<the engine commit or tree this measured>\"");
  const base: AfterBaseline = {
    recordedAt: new Date().toISOString(),
    engine: { ref, note: "Recorded offline from the frozen corpus with scripts/match-bench/report.ts --save-after." },
    corpusVersion,
    rubric: "v2",
    tolerance: GATE_TOLERANCE,
    extract,
    oracle,
    reader: reader ? withoutMisses(reader) : null,
  };
  writeFileSync(AFTER_BASELINE_FILE, JSON.stringify(base, null, 1) + "\n");
  console.log(`\nwrote ${AFTER_BASELINE_FILE}`);
}

if (flag("--gate")) {
  const base = loadAfterBaseline();
  if (!extract || !base) {
    console.log(`\ngate: not run (${!extract ? "no engine" : "no recorded AFTER baseline"})`);
    process.exit(ready.kind === "partial" ? 1 : 0);
  }
  const fails = [...gateFailures(extract, base, loadBeforeBaseline()), ...(reader && base.reader ? readerFailures(withoutMisses(reader), base.reader) : [])];
  console.log(fails.length ? `\ngate: FAIL\n  ${fails.join("\n  ")}` : "\ngate: pass");
  process.exit(fails.length ? 1 : 0);
}
