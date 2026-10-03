// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier's own section in bash, with
// node bodies of its own, through child_process.
/**
 * THE DAY-30 VERIFIER FAILS LOUDLY, AND READS THE CACHE PRODUCTION HAS.
 *
 * scripts/verify-deploy.sh section 7h is the only post-deploy proof of the
 * watch floor (20261002121417 / 121843 / 122309): the staged runner has
 * renamed and edited files before, so "applied" is judged by behaviour or not
 * at all. As first written, two of its three field-and-board claims could not
 * fail.
 *
 *   THE FIELD ROWS were read only from get_stats_cache's fill_curve part. That
 *   part does not exist in production -- 20260928004823 never applied there --
 *   so the check printed INFO "no cached field rows" on every run and the
 *   field grain, one of the three chains the fix changed, was never judged.
 *   The rows that exist are get_explore_cache's field_curves, rewritten at :07
 *   by the same get_category_fill_curve(90, 300) call. And presence proves
 *   nothing: a :07 run already scanning when the migration commits finishes on
 *   the old definition and writes its whole row back over the withhold,
 *   stamped with its start -- before the apply.
 *
 *   THE LARGEST BOARDS were read in one call of 150 tokens against the
 *   function's 25-second header (17s before the floor added its joins). A
 *   timeout comes back from PostgREST as a JSON object, and the section
 *   printed any non-array as INFO "returned no rows": all three invariants
 *   over the largest boards could go unevaluated with no FAIL anywhere.
 *
 * WHAT THIS FILE DOES. It cuts section 7h out of the script, replaces the two
 * network helpers with stubs that answer from files, points the scratch paths
 * at a private directory, and RUNS it in bash over a fixture per scenario. It
 * asserts on what the section prints, line by line, and on which calls it
 * made. Nothing here reads the network.
 *
 * TEETH. Run against the section as first committed, the timeout, chunk,
 * explore-cache and dating scenarios fail; each mutant of the current section
 * named in the commit (one call of 150, a non-array read as INFO, the dating
 * branch deleted, a carried part not refused) fails its own scenario.
 *
 * AND EVERY CLAIM HAS A ROW THAT BREAKS IT. A re-review on 2026-10-02 deleted
 * each of 7h's substantive checks in turn -- the largest-boards filter, the
 * lap-reason and reason/verdict checks, the named-board checks, the layoff
 * threshold, the stats part's carried flag, the half of the field check that
 * catches a sufficient field with no figure, and the gate that keeps a failed
 * chunk from letting the other chunks PASS -- and this file stayed green
 * every time: it fed only errors and stamps, never a row that a claim is
 * about. The last describe block below feeds one such row per claim, and the
 * commit names the mutant each one was shown red against.
 *
 * WHAT THE FIELD LINES MAY CLAIM. A stamp after the apply proves when the
 * rows were computed, not which definition computed them, and gate_share_30
 * drifts too far between hourly reads of the old pool to tell the floor from
 * it with a pass bar (the section's own comment carries the readings). So the
 * dating line passes as "dated", the per-field line is INFO only, the pooled
 * line can FAIL only at or above the old pool's highest reading, and the
 * figure/verdict line is graded only on dated rows. Each is pinned below.
 * The layoff control arm gets the same treatment because it drifted the same
 * way: read-only at 2026-10-02T05:20Z, nothing applied, the old writer had
 * stored 0.717 under the one pre-fix 0.7395 the section compared against,
 * and the section printed a PASS saying the arm was recomputed under the
 * floor. It is now dated against the apply first.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");

/** Section 7h: from its echo line up to the next section's echo line, or the closing one. */
function section7h(script: string): string {
  const open = /^echo "== 7h\. /m.exec(script);
  if (!open) throw new Error("no section 7h in the verifier");
  const rest = script.slice(open.index + 1);
  const next = /^echo "(?:== |done\.)/m.exec(rest);
  return script.slice(open.index, next ? open.index + 1 + next.index : undefined);
}
const SECTION = section7h(SCRIPT);
/** The script's cached-rows helper, carried into the harness so a section that uses it runs as it would in the script. */
const CAT_HELPER = /^CAT\(\) \{[^\n]*\}$/m.exec(SCRIPT)?.[0] ?? "";

/** The eighteen fields the board publishes. */
const FIELDS = [
  "admin", "legal", "other", "sales", "design", "data_ai", "finance", "product", "science",
  "customer", "security", "education", "marketing", "people_hr", "healthcare", "operations",
  "engineering", "hospitality_retail",
];
const NAMED = ["careers.ulta.com", "dominos", "catalent~wd1~External", "adventisthealthcare~wd1~AdventistHealthCareCareers", "AbbVie"];
const TOKENS = Array.from({ length: 150 }, (_, i) => `tok${i}`);

type Row = Record<string, unknown>;
const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

/** A board row as the re-issued company curve publishes it, sufficient under the floor. */
const BOARD: Row = {
  observability_bucket: "full_read", sufficient_30: true, still_open_30: 0.31, watched_from: "2026-08-02",
  insufficient_reason_30: null, cohort_to: "2026-09-02",
};
const NAMED_ROWS: Row[] = [
  { ...BOARD, company_token: "careers.ulta.com", observability_bucket: "lap_proven", sufficient_30: false, still_open_30: null, watched_from: null, insufficient_reason_30: "lap" },
  { ...BOARD, company_token: "dominos", observability_bucket: "lap_proven", sufficient_30: false, still_open_30: null, watched_from: null, insufficient_reason_30: "lap" },
  { ...BOARD, company_token: "catalent~wd1~External", sufficient_30: false, still_open_30: null, watched_from: "2026-09-25", insufficient_reason_30: "watch" },
  { ...BOARD, company_token: "adventisthealthcare~wd1~AdventistHealthCareCareers", sufficient_30: false, still_open_30: null, watched_from: "2026-09-24", insufficient_reason_30: "watch" },
  { ...BOARD, company_token: "AbbVie", still_open_30: 0.29 },
];

/** Field rows as get_category_fill_curve publishes them, keyed by category the way the explore cache stores them. */
const fieldCurves = (over: Record<string, Row> = {}) =>
  Object.fromEntries(FIELDS.map((f) => [f, { gate_share_30: 0.2, still_open_30: 0.34, sufficient_30: true, dated_cohort_n_30: 10_000, ...over[f] }]));

type ChunkMode = "rows" | "timeout" | "html";
interface Fixture {
  facets: unknown;
  /** How the largest-boards chunks answer: one mode for every chunk, or one per chunk of fifty in token order. */
  largest: ChunkMode | ChunkMode[];
  /** Per-token overrides on the largest boards' rows, for a row that breaks one claim. */
  boardOver?: Record<string, Row>;
  /** The five named boards' rows, when a scenario needs one of them wrong. */
  named?: Row[];
  explore: unknown;
  statsMeta: unknown;
  statsRows?: unknown;
  layoff: unknown;
  applied?: string;
}

const base = (): Fixture => ({
  facets: { companies: TOKENS.map((token) => ({ token, open: 10 })) },
  largest: "rows",
  explore: { computed_at: iso(10), stale_parts: [], field_curves: fieldCurves(), field_grid: {} },
  statsMeta: {
    cache_ms: 300, cache_keys: ["computed_at", "ghost_stats", "stale_parts"], present: false, rows: null,
    own_stamp: null, computed_at: iso(20), root_computed_at: iso(20), carried: false, stale_parts: [], error: null, variant: null,
  },
  layoff: [
    { lp_arm: "filed", lp_reason: "uncontrolled", lp_computed_at: iso(600) },
    { lp_arm: "control", lp_reason: "uncontrolled", lp_computed_at: iso(600) },
  ],
  applied: iso(30),
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

/** Section 7h, run in bash against the fixture. Returns its printed lines and the calls it made. */
function run(fx: Fixture): { lines: string[]; calls: Array<{ fn: string; arg: string }> } {
  const dir = mkdtempSync(join(tmpdir(), "vd7h-"));
  dirs.push(dir);
  const put = (f: string, v: unknown) => writeFileSync(join(dir, f), typeof v === "string" ? v : JSON.stringify(v));
  put("facets.json", fx.facets);
  put("explore.json", fx.explore);
  put("layoff.json", fx.layoff);
  put("vd_cat_meta.json", fx.statsMeta);
  put("vd_cat.json", fx.statsRows ?? null);
  put("company.json", { named: fx.named ?? NAMED_ROWS, largest: fx.largest, row: BOARD, over: fx.boardOver ?? {}, tokens: TOKENS });
  put("company.cjs", `
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync(__dirname + "/company.json", "utf8"));
let toks = [];
try { toks = JSON.parse(process.argv[2] || "{}").p_tokens || []; } catch {}
if (toks[0] === ${JSON.stringify(NAMED[0])}) { process.stdout.write(JSON.stringify(cfg.named)); return; }
const mode = Array.isArray(cfg.largest) ? (cfg.largest[Math.floor(cfg.tokens.indexOf(toks[0]) / 50)] || "rows") : cfg.largest;
if (mode === "timeout") {
  process.stdout.write(JSON.stringify({ code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" }));
} else if (mode === "html") {
  process.stdout.write("<html>upstream request timeout</html>");
} else {
  process.stdout.write(JSON.stringify(toks.map((t) => Object.assign({ company_token: t }, cfg.row, cfg.over[t] || {}))));
}
`);
  const prelude = `set -u
D=${JSON.stringify(dir)}
R() { printf '%s\\t%s\\n' "$1" "\${2:-}" >> "$D/calls.log"; case "$1" in
  get_company_fill_curve) node "$D/company.cjs" "\${2:-}" ;;
  get_explore_cache) cat "$D/explore.json" ;;
  get_layoff_partition) cat "$D/layoff.json" ;;
  *) printf '{"code":"PGRST202","message":"stub: unknown rpc"}' ;;
esac; }
J() { printf 'J\\t%s\\n' "$1" >> "$D/calls.log"; cat "$D/facets.json"; }
MAX_CACHE_MS=2000; MAX_CURVE_AGE_H=3; export MAX_CACHE_MS MAX_CURVE_AGE_H
`;
  const body = (CAT_HELPER + "\n" + SECTION).split("/tmp/").join(`${dir}/`);
  writeFileSync(join(dir, "run.sh"), prelude + body);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };
  delete env.DAY30_APPLIED_AT;
  if (fx.applied !== undefined) env.DAY30_APPLIED_AT = fx.applied;
  const out = execFileSync("bash", [join(dir, "run.sh")], { env, encoding: "utf8", timeout: 50_000 });
  const log = existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8") : "";
  const calls = log.split("\n").filter(Boolean).map((l) => { const [fn, ...rest] = l.split("\t"); return { fn, arg: rest.join("\t") }; });
  return { lines: out.split("\n").filter(Boolean), calls };
}

const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

describe("the largest boards: read in chunks, and a read that errs is a FAIL", () => {
  it("reads the 150 facet boards in calls of at most fifty tokens, every board once", () => {
    const { lines, calls } = run(base());
    const chunks = calls
      .filter((c) => c.fn === "get_company_fill_curve")
      .map((c) => JSON.parse(c.arg).p_tokens as string[])
      .filter((t) => t[0] !== NAMED[0]);
    expect(chunks.length, show(lines)).toBeGreaterThanOrEqual(3);
    for (const t of chunks) expect(t.length).toBeLessThanOrEqual(50);
    expect(chunks.flat().sort()).toEqual([...TOKENS].sort());
    expect(has(lines, "PASS", /no sufficient_30 row is lap_proven or lacks a floor before cohort_to \(150 of 150 boards\)/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /every lap_proven board among them reads reason lap/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /a refused row always names its reason/), show(lines)).toBe(true);
  });

  it("a statement timeout on the largest boards is a FAIL naming 57014, never an informational 'no rows'", () => {
    const { lines } = run({ ...base(), largest: "timeout" });
    expect(has(lines, "FAIL", /largest boards, chunk 1 of 3: error 57014/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /no chunk answered with rows, so none of the three claims was evaluated/), show(lines)).toBe(true);
    expect(lines.some((l) => /^INFO .*largest/i.test(l) && /no rows/.test(l)), show(lines)).toBe(false);
    expect(lines.some((l) => l.startsWith("PASS") && /largest boards|lap_proven board among them|names its reason/.test(l)), show(lines)).toBe(false);
  });

  it("an answer that is not JSON at all is a FAIL too", () => {
    const { lines } = run({ ...base(), largest: "html" });
    expect(has(lines, "FAIL", /largest boards, chunk 1 of 3: no JSON/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /largest boards/.test(l)), show(lines)).toBe(false);
  });

  it("a facet list that names no company is a FAIL: the check could not run", () => {
    const { lines, calls } = run({ ...base(), facets: { message: "boom" } });
    expect(has(lines, "FAIL", /largest-boards check not evaluated: the facet list named no company/), show(lines)).toBe(true);
    expect(calls.filter((c) => c.fn === "get_company_fill_curve")).toHaveLength(1);
  });
});

describe("the field rows: read from the explore cache, and dated against the apply", () => {
  it("reads get_explore_cache at all -- the cache production has", () => {
    const { calls } = run(base());
    expect(calls.some((c) => c.fn === "get_explore_cache")).toBe(true);
  });

  it("rows stamped after the apply pass as DATED, and nothing about the gate share passes", () => {
    const { lines } = run(base());
    expect(has(lines, "PASS", /explore cache field_curves \(18 fields\) computed_at=\S+ is dated at or after the apply .*a stamp says when, not which definition/), show(lines)).toBe(true);
    expect(lines.some((l) => /computed by the re-issued definition/.test(l)), "a timestamp is not a definition").toBe(false);
    expect(has(lines, "INFO", /explore cache field_curves \(18 fields\): gate_share_30 pooled over 180000 dated roles = 0\.2000 .* consistent with the floor, NOT proof of it/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /explore cache field_curves \(18 fields\): corroboration only, drift-limited -- gate_share_30 below its highest pre-fix reading on 18 of 18/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /explore cache field_curves \(18 fields\): no field with nothing admitted carries a figure/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /gate_share_30/.test(l)), "the gate share is drift-limited: it may corroborate, never pass").toBe(false);
    expect(has(lines, "INFO", /20261002121843 has no anon-readable proof of its own.*pg_get_functiondef/), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
  });

  it("rows stamped before the apply are a FAIL, and nothing about them is graded", () => {
    const { lines } = run({ ...base(), applied: iso(5) });
    expect(has(lines, "FAIL", /computed_at=\S+ is BEFORE the apply/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /at or after the apply/.test(l)), show(lines)).toBe(false);
    expect(has(lines, "INFO", /gate_share_30 below its highest pre-fix reading .* not graded/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /gate_share_30 pooled over .* not graded/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /no field with nothing admitted carries a figure.* not graded/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /explore cache/.test(l)), "rows the floor may not have computed pass nothing").toBe(false);
  });

  it("undated rows that break the figure/verdict pairing are reported as INFO, not graded either way", () => {
    const fx = base();
    const { lines } = run({ ...fx, applied: iso(5), explore: { ...(fx.explore as Row), field_curves: fieldCurves({ legal: { gate_share_30: 0, still_open_30: 0.96, sufficient_30: false } }) } });
    expect(has(lines, "INFO", /a figure with nothing admitted: legal.* not graded/), show(lines)).toBe(true);
    expect(lines.some((l) => /no field with nothing admitted/.test(l) && !l.startsWith("INFO")), show(lines)).toBe(false);
  });

  it("without the apply time the rows cannot be dated, and that is a FAIL, not a pass on presence", () => {
    const { lines } = run({ ...base(), applied: undefined });
    expect(has(lines, "FAIL", /cannot be dated against the apply: set DAY30_APPLIED_AT/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /explore cache field_curves .*(after the apply|below its highest)/.test(l)), show(lines)).toBe(false);
  });

  it("a field that kept its pre-fix gate share is named as corroboration, never failed on one field's drift", () => {
    const { lines } = run({ ...base(), explore: { ...(base().explore as Row), field_curves: fieldCurves({ finance: { gate_share_30: 0.71 } }) } });
    expect(has(lines, "INFO", /corroboration only, drift-limited .*HELD on finance 0\.71 >= 0\.\d+/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("FAIL") && /HELD on/.test(l)), show(lines)).toBe(false);
  });

  it("a pooled gate share at or above the old pool's highest reading is a FAIL on dated rows", () => {
    const m = /const POOLED_HI=([0-9.]+);/.exec(SECTION);
    expect(m, "no POOLED_HI in section 7h").toBeTruthy();
    const hi = Number(m![1]);
    const at = run({ ...base(), explore: { ...(base().explore as Row), field_curves: fieldCurves(Object.fromEntries(FIELDS.map((f) => [f, { gate_share_30: hi }]))) } });
    expect(has(at.lines, "FAIL", /gate_share_30 pooled over 180000 dated roles = .* at or above every reading of the old pool/), show(at.lines)).toBe(true);
    // Weighted by each field's own cohort, not by field count: one huge field
    // at the old level outweighs seventeen small ones that fell.
    const heavy = run({ ...base(), explore: { ...(base().explore as Row), field_curves: fieldCurves({ healthcare: { gate_share_30: 0.9, dated_cohort_n_30: 2_000_000 } }) } });
    expect(has(heavy.lines, "FAIL", /gate_share_30 pooled over 2170000 dated roles = 0\.8452/), show(heavy.lines)).toBe(true);
    const undated = run({ ...base(), applied: undefined, explore: { ...(base().explore as Row), field_curves: fieldCurves(Object.fromEntries(FIELDS.map((f) => [f, { gate_share_30: hi }]))) } });
    expect(has(undated.lines, "INFO", /gate_share_30 pooled over .* not graded/), show(undated.lines)).toBe(true);
  });

  it("rows with no dated_cohort_n_30 cannot be pooled, and on dated rows that is a FAIL", () => {
    const noDen = Object.fromEntries(FIELDS.map((f) => [f, { dated_cohort_n_30: null }]));
    const { lines } = run({ ...base(), explore: { ...(base().explore as Row), field_curves: fieldCurves(noDen) } });
    expect(has(lines, "FAIL", /no field publishes dated_cohort_n_30, so gate_share_30 cannot be pooled/), show(lines)).toBe(true);
  });

  it("a field the floor emptied that still carries a figure is a FAIL", () => {
    const { lines } = run({ ...base(), explore: { ...(base().explore as Row), field_curves: fieldCurves({ legal: { gate_share_30: 0, still_open_30: 0.96, sufficient_30: false } }) } });
    expect(has(lines, "FAIL", /a figure with nothing admitted: legal/), show(lines)).toBe(true);
  });

  it("a part carried from an earlier run is a FAIL, never dated by the run that failed to compute it", () => {
    const { lines } = run({ ...base(), explore: { ...(base().explore as Row), stale_parts: ["field_curves"] } });
    expect(has(lines, "FAIL", /carried forward from an earlier run/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /at or after the apply|below its highest/.test(l)), show(lines)).toBe(false);
  });

  it("an empty part -- the run failed with nothing to carry -- is a FAIL", () => {
    const { lines } = run({ ...base(), explore: { computed_at: iso(10), stale_parts: ["field_curves"], field_curves: {} } });
    expect(has(lines, "FAIL", /field_curves is empty and stale_parts names it/), show(lines)).toBe(true);
  });

  it("the withheld part is informational only while the next :07 run is due, and a FAIL once the cache has stopped", () => {
    const pending = run({ ...base(), applied: iso(5), explore: { computed_at: iso(40), stale_parts: [], field_grid: {} } });
    expect(has(pending.lines, "INFO", /field_curves withheld at apply/), show(pending.lines)).toBe(true);
    expect(pending.lines.some((l) => l.startsWith("FAIL") && /explore cache/.test(l)), show(pending.lines)).toBe(false);

    const stopped = run({ ...base(), applied: iso(200), explore: { computed_at: iso(240), stale_parts: [], field_grid: {} } });
    // NOW is taken when this file loads and the script reads its own clock when
    // it runs, so on a loaded machine (load average 45-100 during a 2026-10-03
    // gate) the stamp is a minute or more older by then: 241, not 240.
    expect(has(stopped.lines, "FAIL", /explore cache last ran 24\d min ago/), show(stopped.lines)).toBe(true);

    const rewritten = run({ ...base(), applied: iso(50), explore: { computed_at: iso(10), stale_parts: [], field_grid: {} } });
    expect(has(rewritten.lines, "FAIL", /a run that began after the apply wrote no field_curves key/), show(rewritten.lines)).toBe(true);
  });

  it("an explore-cache read that errs or times out is a FAIL with what came back", () => {
    const timedOut = run({ ...base(), explore: { code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" } });
    expect(has(timedOut.lines, "FAIL", /get_explore_cache errored: .*57014/), show(timedOut.lines)).toBe(true);
    const nothing = run({ ...base(), explore: "" });
    expect(has(nothing.lines, "FAIL", /get_explore_cache answered no JSON/), show(nothing.lines)).toBe(true);
  });

  it("the stats-cache arm is informational while its part does not exist, judged like the explore arm when it does, and a FAIL when its read errs", () => {
    const absent = run(base());
    expect(has(absent.lines, "INFO", /stats cache carries no fill_curve part/), show(absent.lines)).toBe(true);

    const rows = FIELDS.map((category) => ({ category, gate_share_30: 0.2, still_open_30: 0.34, sufficient_30: true }));
    const live = run({
      ...base(),
      statsMeta: { ...(base().statsMeta as Row), cache_keys: ["computed_at", "fill_curve", "stale_parts"], present: true, rows: 18, own_stamp: iso(70), computed_at: iso(70) },
      statsRows: rows,
    });
    expect(has(live.lines, "FAIL", /stats cache fill_curve \(18 fields\) computed_at=\S+ is BEFORE the apply/), show(live.lines)).toBe(true);

    const errored = run({ ...base(), statsMeta: { ...(base().statsMeta as Row), cache_keys: ["code", "details", "hint", "message"] } });
    expect(has(errored.lines, "FAIL", /get_stats_cache errored or answered nothing/), show(errored.lines)).toBe(true);
  });

  it("found the section and the helper it may lean on (guards the guard)", () => {
    expect(SECTION).toMatch(/^echo "== 7h\. /);
    expect(SECTION.length).toBeGreaterThan(2000);
    expect(CAT_HELPER).toMatch(/vd_cat_meta\.json/);
  });

  it("states the old pool's pooled readings and holds POOLED_HI at the highest of them", () => {
    const hi = Number(/const POOLED_HI=([0-9.]+);/.exec(SECTION)?.[1]);
    const line = /^\/\/ The old pool, gate_share_30 pooled[^\n]*\n\/\/ ([^\n]+)$/m.exec(SECTION)?.[1] ?? "";
    const readings = [...line.matchAll(/(\d{2}:\d{2}Z) (0\.\d{4})/g)].map((x) => Number(x[2]));
    expect(readings.length, `the readings line: ${line}`).toBeGreaterThanOrEqual(7);
    expect(hi).toBe(Math.max(...readings));
    // At least the readings the re-review and the first pass recorded: the
    // ceiling may only rise as readings are added.
    expect(hi).toBeGreaterThanOrEqual(0.6889);
  });

  it("holds each field to a ceiling the script states for all eighteen", () => {
    const m = /const BASE_HI=\{([^}]*)\}/.exec(SECTION);
    expect(m, "no BASE_HI in section 7h").toBeTruthy();
    const ceiling = Object.fromEntries(m![1].split(",").map((kv) => { const [k, v] = kv.split(":"); return [k.trim(), Number(v)]; }));
    expect(Object.keys(ceiling).sort()).toEqual([...FIELDS].sort());
    // At least the 2026-10-01T22:07Z reading the first version compared
    // against, for every field: the ceiling may only rise.
    const first: Record<string, number> = {
      admin: 0.4266, legal: 0.4213, other: 0.66, sales: 0.6321, design: 0.3867, data_ai: 0.5074, finance: 0.6104,
      product: 0.4726, science: 0.5127, customer: 0.475, security: 0.54, education: 0.6513, marketing: 0.421,
      people_hr: 0.4206, healthcare: 0.6069, operations: 0.6433, engineering: 0.6534, hospitality_retail: 0.5703,
    };
    for (const f of FIELDS) expect(ceiling[f], f).toBeGreaterThanOrEqual(first[f]);
  });
});

describe("the stored layoff arms", () => {
  it("an errored read is a FAIL naming its code", () => {
    const { lines } = run({ ...base(), layoff: { code: "57014", message: "canceling statement due to statement timeout" } });
    expect(has(lines, "FAIL", /get_layoff_partition errored: 57014/), show(lines)).toBe(true);
  });

  it("two withheld arms read as the apply having landed", () => {
    const { lines } = run(base());
    expect(has(lines, "PASS", /both stored arms withheld/), show(lines)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ONE ROW PER CLAIM. Every check 7h makes is fed a row that breaks it, and
// the line that check prints must read FAIL and name what broke it. Errors
// and stamps alone (everything above) left nine of the checks deletable.
// ════════════════════════════════════════════════════════════════════════════

const lineFor = (lines: string[], re: RegExp) => lines.find((l) => re.test(l)) ?? "(no such line)";
const SUFF_LINE = /no sufficient_30 row is lap_proven or lacks a floor before cohort_to/;
const LAP_LINE = /every lap_proven board among them reads reason lap/;
const MUTE_LINE = /a refused row always names its reason and a sufficient row never does/;

describe("every claim 7h makes is fed a row that breaks it", () => {
  it("one chunk of three timing out leaves no invariant PASS, though the other two answered clean rows", () => {
    const { lines } = run({ ...base(), largest: ["rows", "timeout", "rows"] });
    expect(has(lines, "FAIL", /largest boards, chunk 2 of 3: error 57014/), show(lines)).toBe(true);
    for (const re of [SUFF_LINE, LAP_LINE, MUTE_LINE]) {
      const l = lineFor(lines, re);
      expect(l.startsWith("FAIL  "), `${re}: ${show(lines)}`).toBe(true);
      expect(l, "the line says how much it covered and that a chunk failed").toMatch(/\(100 of 150 boards; 1 chunk\(s\) failed above\)/);
    }
  });

  const boardCases: Array<[string, Row, RegExp, RegExp]> = [
    ["a sufficient lap_proven board", { observability_bucket: "lap_proven" }, SUFF_LINE, /tok3\(lap_proven,2026-08-02\)/],
    ["a sufficient board with no floor", { watched_from: null }, SUFF_LINE, /tok3\(full_read,null\)/],
    ["a sufficient board floored on its cohort's last day", { watched_from: "2026-09-02" }, SUFF_LINE, /tok3\(full_read,2026-09-02\)/],
    ["a lap_proven board refused for a reason other than lap", { observability_bucket: "lap_proven", sufficient_30: false, still_open_30: null, watched_from: null, insufficient_reason_30: "watch" }, LAP_LINE, /tok3=watch/],
    ["a refused board that names no reason", { sufficient_30: false, still_open_30: null, insufficient_reason_30: null }, MUTE_LINE, /tok3/],
    ["a sufficient board that names a reason", { insufficient_reason_30: "n" }, MUTE_LINE, /tok3/],
  ];
  for (const [what, over, re, names] of boardCases) {
    it(`${what} among the largest is a FAIL naming it`, () => {
      const { lines } = run({ ...base(), boardOver: { tok3: over } });
      const l = lineFor(lines, re);
      expect(l.startsWith("FAIL  "), show(lines)).toBe(true);
      expect(l).toMatch(names);
    });
  }

  it("a sufficient field with no figure, or with nothing admitted, is a FAIL on dated rows", () => {
    const fx = base();
    const noFigure = run({ ...fx, explore: { ...(fx.explore as Row), field_curves: fieldCurves({ legal: { still_open_30: null } }) } });
    expect(has(noFigure.lines, "FAIL", /sufficient with no figure: legal/), show(noFigure.lines)).toBe(true);
    const nothingAdmitted = run({ ...fx, explore: { ...(fx.explore as Row), field_curves: fieldCurves({ design: { gate_share_30: 0 } }) } });
    expect(has(nothingAdmitted.lines, "FAIL", /sufficient with no figure: design/), show(nothingAdmitted.lines)).toBe(true);
  });

  const named = (token: string, over: Row) => NAMED_ROWS.map((r) => (r.company_token === token ? { ...r, ...over } : r));
  it("careers.ulta.com still sufficient as a lap board is a FAIL -- the board the defect was reproduced on", () => {
    const { lines } = run({ ...base(), named: named("careers.ulta.com", { sufficient_30: true, still_open_30: 0.9431, insufficient_reason_30: null }) });
    const l = lineFor(lines, /careers\.ulta\.com refused as a lap board/);
    expect(l.startsWith("FAIL  "), show(lines)).toBe(true);
    expect(has(lines, "PASS", /dominos refused as a lap board/), "the other lap board still passes").toBe(true);
  });

  it("a cut-short board floored before its last cut-short read is a FAIL", () => {
    const { lines } = run({ ...base(), named: named("catalent~wd1~External", { watched_from: "2026-09-01" }) });
    expect(lineFor(lines, /catalent~wd1~External floored at its last cut-short read/).startsWith("FAIL  "), show(lines)).toBe(true);
  });

  it("AbbVie reading watch with no floor is a FAIL naming the unseeded tenure table", () => {
    const { lines } = run({ ...base(), named: named("AbbVie", { sufficient_30: false, still_open_30: null, watched_from: null, insufficient_reason_30: "watch" }) });
    expect(has(lines, "FAIL", /AbbVie reads watch with no floor: job_board_board_watch holds no row for it/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /AbbVie/), show(lines)).toBe(false);
  });

  it("AbbVie floored after its long tenure began is a FAIL", () => {
    const { lines } = run({ ...base(), named: named("AbbVie", { watched_from: "2026-09-20" }) });
    expect(lineFor(lines, /AbbVie \(read in full since 2026-08-02\) keeps its figure/).startsWith("FAIL  "), show(lines)).toBe(true);
  });

  // THE LAYOFF ARM DRIFTS TOO. Read-only on 2026-10-02 at 05:20Z, before any
  // of the three files applied, the old writer had stored the control arm at
  // 0.717 (05:10Z), under the single 0.7395 the section compared against, and
  // the section printed a PASS saying the arm was recomputed under the floor.
  const arms = (g: number | null, minutesAgo: number, reason: string | null = null) => [
    { lp_arm: "filed", lp_reason: reason, lp_gate_share_30: 0.5, lp_computed_at: iso(minutesAgo) },
    { lp_arm: "control", lp_reason: reason, lp_gate_share_30: g, lp_still_open_30: 0.41, lp_sufficient_30: true, lp_computed_at: iso(minutesAgo) },
  ];
  it("a layoff control arm the old writer stored before the apply is a FAIL, however far its share drifted", () => {
    const { lines } = run({ ...base(), layoff: arms(0.717, 40) });
    expect(has(lines, "FAIL", /layoff control arm stored BEFORE the apply .* and not withheld/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /control arm/.test(l)), show(lines)).toBe(false);
    const undated = run({ ...base(), applied: undefined, layoff: arms(0.717, 40) });
    expect(has(undated.lines, "FAIL", /layoff control arm recomputed but cannot be dated against the apply/), show(undated.lines)).toBe(true);
    expect(undated.lines.some((l) => l.startsWith("PASS") && /control arm/.test(l)), show(undated.lines)).toBe(false);
  });

  it("a dated layoff control arm passes as DATED; its share FAILs at or above the old arm's highest reading and is INFO below it", () => {
    const hi = Number(/^LAYOFF_HI=([0-9.]+)$/m.exec(SECTION)?.[1]);
    // The bar is the highest of the old arm's readings the section records
    // beside it, never a number picked to pass: raise one, raise the other.
    const recorded = /^# The old control arm[^\n]*\n# ([^\n]+)$/m.exec(SECTION)?.[1] ?? "";
    const readings = [...recorded.matchAll(/T\d{2}:\d{2}Z (0\.\d{4})/g)].map((x) => Number(x[1]));
    expect(readings.length, `the readings line: ${recorded}`).toBeGreaterThanOrEqual(2);
    expect(hi).toBe(Math.max(...readings));
    expect(readings, "the reading the first version compared against stays on record").toContain(0.7395);
    const held = run({ ...base(), layoff: arms(hi, 5) });
    expect(has(held.lines, "PASS", /layoff control arm is dated at or after the apply .*a stamp says when, not which writer/), show(held.lines)).toBe(true);
    expect(has(held.lines, "FAIL", new RegExp(`layoff control arm: gate_share_30=${String(hi).replace(".", "\\.")} .* at or above it`)), show(held.lines)).toBe(true);
    const fell = run({ ...base(), layoff: arms(0.52, 5) });
    expect(has(fell.lines, "INFO", /layoff control arm: gate_share_30=0\.52 .* consistent with the floor, NOT proof of it/), show(fell.lines)).toBe(true);
    expect(fell.lines.some((l) => l.startsWith("PASS") && /gate_share_30=0\.52 \(/.test(l)), "the share may corroborate, never pass").toBe(false);
    const noNumber = run({ ...base(), layoff: arms(null, 5) });
    expect(has(noNumber.lines, "FAIL", /layoff control arm: gate_share_30=null .* or no number/), show(noNumber.lines)).toBe(true);
    const stillUncontrolled = run({ ...base(), layoff: [{ lp_arm: "filed", lp_reason: null, lp_computed_at: iso(5) }, ...arms(0.5, 5, "uncontrolled").slice(1)] });
    expect(has(stillUncontrolled.lines, "FAIL", /dated at or after the apply .* but still reads uncontrolled/), show(stillUncontrolled.lines)).toBe(true);
  });

  it("a stats part carried forward from an earlier run is a FAIL, not dated by the run that failed to compute it", () => {
    const rows = FIELDS.map((category) => ({ category, gate_share_30: 0.2, still_open_30: 0.34, sufficient_30: true, dated_cohort_n_30: 10_000 }));
    const { lines } = run({
      ...base(),
      statsMeta: { ...(base().statsMeta as Row), cache_keys: ["computed_at", "fill_curve", "stale_parts"], present: true, rows: 18, own_stamp: null, computed_at: iso(10), carried: true, stale_parts: ["fill_curve"] },
      statsRows: rows,
    });
    expect(has(lines, "FAIL", /stats cache fill_curve \(18 fields\): carried forward from an earlier run/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /stats cache fill_curve .*dated at or after the apply/.test(l)), show(lines)).toBe(false);
  });
});
