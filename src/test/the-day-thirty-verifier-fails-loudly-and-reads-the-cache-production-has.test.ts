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
  Object.fromEntries(FIELDS.map((f) => [f, { gate_share_30: 0.2, still_open_30: 0.34, sufficient_30: true, ...over[f] }]));

interface Fixture {
  facets: unknown;
  /** How the largest-boards chunks answer. */
  largest: "rows" | "timeout" | "html";
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
  put("company.json", { named: NAMED_ROWS, largest: fx.largest, row: BOARD });
  put("company.cjs", `
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync(__dirname + "/company.json", "utf8"));
let toks = [];
try { toks = JSON.parse(process.argv[2] || "{}").p_tokens || []; } catch {}
if (toks[0] === ${JSON.stringify(NAMED[0])}) { process.stdout.write(JSON.stringify(cfg.named)); return; }
if (cfg.largest === "timeout") {
  process.stdout.write(JSON.stringify({ code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" }));
} else if (cfg.largest === "html") {
  process.stdout.write("<html>upstream request timeout</html>");
} else {
  process.stdout.write(JSON.stringify(toks.map((t) => Object.assign({ company_token: t }, cfg.row))));
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

  it("rows stamped after the apply, every field below its pre-fix ceiling, pass", () => {
    const { lines } = run(base());
    expect(has(lines, "PASS", /explore cache field_curves \(18 fields\) computed_at=\S+ is at or after the apply/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /explore cache field_curves \(18 fields\): gate_share_30 below its highest pre-fix reading on 18 of 18/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /explore cache field_curves \(18 fields\): no field the floor emptied carries a figure/), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
  });

  it("rows stamped before the apply are a FAIL, and their gate shares are not graded", () => {
    const { lines } = run({ ...base(), applied: iso(5) });
    expect(has(lines, "FAIL", /computed_at=\S+ is BEFORE the apply/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /at or after the apply/.test(l)), show(lines)).toBe(false);
    expect(has(lines, "INFO", /gate_share_30 below its highest pre-fix reading .* not graded/), show(lines)).toBe(true);
  });

  it("without the apply time the rows cannot be dated, and that is a FAIL, not a pass on presence", () => {
    const { lines } = run({ ...base(), applied: undefined });
    expect(has(lines, "FAIL", /cannot be dated against the apply: set DAY30_APPLIED_AT/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /explore cache field_curves .*(after the apply|below its highest)/.test(l)), show(lines)).toBe(false);
  });

  it("a field that kept its pre-fix gate share after the apply is a FAIL naming it", () => {
    const { lines } = run({ ...base(), explore: { ...(base().explore as Row), field_curves: fieldCurves({ finance: { gate_share_30: 0.69 } }) } });
    expect(has(lines, "FAIL", /HELD on finance 0\.69 >= 0\.6845/), show(lines)).toBe(true);
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
    expect(has(stopped.lines, "FAIL", /explore cache last ran 240 min ago/), show(stopped.lines)).toBe(true);

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
