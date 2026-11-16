// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE DB-CADENCE LANE'S VERIFY SECTION FAILS WHAT IT CLAIMS, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzz-cost-db-cadence.sh runs against a fake
 * curl that answers from routes and logs every call:
 *   - before the deploy (production's schedules and rows as read on
 *     2026-11-08) it prints an INFO line for every claim and no FAIL. Its
 *     only PASS lines are the page's cadence sentences, which hold today;
 *   - a good deploy PASSes every claim, whether COST_DB_APPLIED_AT dates the
 *     rows or the ghost row's own :15 stamp does;
 *   - each claim broken prints a FAIL: a job left scheduled, a schedule
 *     not moved, a lost timeout, a paused job, step 2 without step 1, a
 *     stuck or failing dropper, an explore row written after the change that
 *     still carries a retired part, a new row missing a part the page reads,
 *     coverage rows that disagree or fall off the half hour, a stalled
 *     rollup or ghost run, a ghost row on the old minute after the change,
 *     a cadence sentence the deploy made false, and every unreadable answer;
 *   - a row it cannot date is INFO, never a guess. The only calls it makes
 *     are two read RPCs and two GETs, and the publishable key is never
 *     printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-cost-db-cadence.sh"), "utf8");
/** The verifier's own read-RPC helper, so the section is run with what it runs with. */
const R_FN = /^R\(\) \{[^\n]*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_cadence";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url+(data!==null?" "+data:"")))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], appliedAt?: string): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdcd-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${R_FN}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  delete env.COST_DB_APPLIED_AT;
  if (appliedAt !== undefined) env.COST_DB_APPLIED_AT = appliedAt;
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

// ---- time: every stamp is built from the clock the section reads ----
const MIN = 60_000;
/** The most recent UTC instant, at or before now, whose minute satisfies `ok` (second 0). */
const lastMinute = (ok: (m: number) => boolean): number => {
  const d = new Date(); d.setUTCSeconds(0, 0);
  while (!ok(d.getUTCMinutes())) d.setTime(d.getTime() - MIN);
  return d.getTime();
};
const iso = (t: number) => new Date(t).toISOString();
const ago = (minutes: number) => iso(Date.now() - minutes * MIN);
const lastAt = (m: number) => iso(lastMinute((x) => x === m));
const lastHalfHour = () => iso(lastMinute((x) => x % 30 === 0));
const THREE_HOURS_AGO = () => ago(180);

// ---- cron health ----
type Cron = {
  ch_jobname: string; ch_schedule: string; ch_active: boolean; ch_timeout: string | null; ch_runs: number;
  ch_failed: number; ch_timeouts: number; ch_last_start: string | null; ch_last_status: string | null;
  ch_last_seconds: number | null; ch_max_seconds: number | null;
};
const job = (name: string, schedule: string, timeout: string | null, runs: number): Cron => ({
  ch_jobname: name, ch_schedule: schedule, ch_active: true, ch_timeout: timeout, ch_runs: runs, ch_failed: 0,
  ch_timeouts: 0, ch_last_start: ago(3), ch_last_status: "succeeded", ch_last_seconds: 2, ch_max_seconds: 10,
});
/** Production's jobs as get_cron_health answered on 2026-11-08 (the ones this lane touches, and neighbours). */
const BEFORE: Cron[] = [
  job("board-recency-ladder", "2-59/5 * * * *", null, 288),
  job("job-board-stats-rollup", "*/15 * * * *", "4min", 96),
  job("refresh-board-facets", "7,22,37,52 * * * *", "10min", 96),
  job("refresh-explore-cache", "7 * * * *", "15min", 24),
  job("refresh-explore-role-rows", "22 */6 * * *", "10min", 4),
  job("refresh-ghost-stats", "5,35 * * * *", "15min", 48),
  job("refresh-stats-cache", "27 * * * *", "5min", 24),
  job("scan-cache-and-telemetry-purge", "10 4 * * *", null, 1),
  job("scan-report-cache-retention", "13 * * * *", null, 24),
];
type Patch = Record<string, Partial<Cron> | null>;
/** A copy of `base` with jobs changed (an object), removed (null) or added (an object naming a new job). */
const cron = (base: Cron[], patch: Patch = {}): Cron[] => {
  const out = base.filter((r) => patch[r.ch_jobname] !== null).map((r) => ({ ...r, ...(patch[r.ch_jobname] ?? {}) }));
  for (const [name, p] of Object.entries(patch)) {
    if (p && !base.some((r) => r.ch_jobname === name)) out.push({ ...job(name, "* * * * *", null, 1), ...p });
  }
  return out;
};
const STEP1_PATCH: Patch = {
  "board-recency-ladder": null,
  "refresh-explore-role-rows": null,
  "refresh-board-facets": { ch_schedule: "2,17,32,47 * * * *" },
  "scan-cache-and-telemetry-purge": { ch_timeout: "2min" },
};
const STEP2_PATCH: Patch = {
  "job-board-stats-rollup": { ch_schedule: "*/30 * * * *", ch_runs: 48 },
  "refresh-ghost-stats": { ch_schedule: "15 * * * *", ch_runs: 24 },
};
const STEP1 = () => cron(BEFORE, STEP1_PATCH);
const AFTER = () => cron(BEFORE, { ...STEP1_PATCH, ...STEP2_PATCH });

// ---- the explore row ----
const GRID = { at: "2026-11-08T19:07:00Z", window_days: 30, fields: { finance: { n: 33_910, work_mode_n: 10_350 }, design: { n: 4_176, work_mode_n: 1_592 } } };
const REPOST = { acme: { n: 3 }, globex: { n: 5 } };
const newRow = (at: string, over: Record<string, unknown> = {}) => ({
  field_grid: GRID, repost_index: REPOST, fields: { finance: 33_910, design: 4_176 },
  totals: { repost_flagged_n: 2 }, stale_parts: [], computed_at: at, ...over,
});
/** Today's row: what the page reads, plus every part the new writer drops. */
const liveRow = (at: string) => ({
  ...newRow(at),
  field_curves: { finance: { gate_share_30: 0.2 } }, chip_coverage: { open: 1 }, role_rows: { fields: {} },
  totals: { pay_n: 1_254, entry_n: 1_605, pay_pool_n: 5_903, postings_n: 999_821, employers_n: 31_481, entry_min_open: 50, postings_pay_n: 337_245, entry_min_entry: 10, repost_flagged_n: 56 },
});

// ---- the stats rollup rows ----
const COV_DATE = [{ source: "workday", total: 448_002, dated: 447_999 }, { source: "oracle", total: 129_368, dated: 129_368 }];
const COV_DESC = [{ source: "workday", total: 448_002, described: 447_572 }, { source: "oracle", total: 129_368, described: 126_610 }];
const rollupRows = (o: { ghostAt: string; covAt: string; descAt?: string; date?: unknown[]; descr?: unknown[]; drop?: string[] }) => [
  { k: "ghost_stats", v: { total_open: 999_821 }, computed_at: o.ghostAt },
  { k: "date_coverage", v: o.date ?? COV_DATE, computed_at: o.covAt },
  { k: "desc_coverage", v: o.descr ?? COV_DESC, computed_at: o.descAt ?? o.covAt },
].filter((r) => !(o.drop ?? []).includes(r.k));

// ---- the prerendered page ----
const page = (ghostPhrase: string, rollupPhrase: string) =>
  `<!doctype html><html><head><title>Ghost Job Index</title></head><body><main>`
  + `<p>Counted over the postings the board serves. Measured 2026-11-08 17:05 UTC, ${ghostPhrase}; the live page re-reads it when it opens in a browser.</p>`
  + `<p>Measured 2026-11-08 17:05 UTC, ${ghostPhrase}.</p>`
  + `<p>Measured from each feed&#39;s own last verification stamp 2026-11-08 17:30 UTC, ${rollupPhrase}.</p>`
  + `</main></body></html>`;
const PAGE_TODAY = page("recomputed twice an hour", "recomputed every 15 minutes");
const PAGE_NEW = page("recomputed once an hour", "recomputed every 30 minutes");

type World = {
  cron?: unknown; cronBody?: string;
  explore?: unknown; exploreBody?: string;
  rollup?: unknown; rollupStatus?: number; rollupBody?: string;
  page?: string;
};
const routes = (w: World): Route[] => [
  { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health ", body: w.cronBody ?? JSON.stringify(w.cron) },
  { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_explore_cache ", body: w.exploreBody ?? JSON.stringify(w.explore) },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/job_board_stats_rollup\\?", status: w.rollupStatus ?? 200, body: w.rollupBody ?? JSON.stringify(w.rollup) },
  { match: "^GET https://site\\.test/ghost-job-index$", body: w.page ?? "" },
];
/** Production before the deploy. */
const before = (over: World = {}): Route[] => routes({
  cron: BEFORE, explore: [liveRow(lastAt(7))],
  rollup: rollupRows({ ghostAt: lastAt(5), covAt: iso(lastMinute((m) => m % 15 === 0)) }),
  page: PAGE_TODAY, ...over,
});
/** Production after a good deploy, its rows written after the change. */
const after = (over: World = {}): Route[] => routes({
  cron: AFTER(), explore: [newRow(lastAt(7))],
  rollup: rollupRows({ ghostAt: lastAt(15), covAt: lastHalfHour() }),
  page: PAGE_NEW, ...over,
});

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));
const has = (lines: string[], verdict: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));

describe("section 99zzzzzz (cost audit, db-cadence)", () => {
  it("before the deploy it prints an INFO line for every claim and no FAIL; its only PASS lines are the cadence the page states today", () => {
    const { lines, out } = run(before());
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines).every((l) => /\/ghost-job-index says/.test(l)), out).toBe(true);
    expect(passes(lines), out).toHaveLength(2);
    for (const re of [
      /before 20261109100000: board-recency-ladder runs/, /before 20261109110000: refresh-explore-role-rows runs/,
      /before 20261109120000: refresh-board-facets runs/, /before 20261109131000: scan-cache-and-telemetry-purge/,
      /before 20261109190000: no one-shot index dropper/, /before 20261109121000: job-board-stats-rollup runs/,
      /before 20261109122000: refresh-ghost-stats runs/, /before 20261109122000: the ghost row/,
      /before 20261109121000: the coverage rows/, /before 20261109110000: the explore row .* carries field_curves, chip_coverage, role_rows, 8 denominators/,
    ]) expect(has(lines, "INFO", re), `${re} missing\n${out}`).toBe(true);
  });

  it("every line it prints is a verdict, and its only calls are two read RPCs and two GETs", () => {
    for (const [r, at] of [[before(), undefined], [after(), THREE_HOURS_AGO()]] as const) {
      const { out, calls } = run(r, at);
      const printed = out.split("\n").filter((l) => l.trim() && !l.startsWith("== "));
      expect(printed.filter((l) => !/^(PASS|FAIL|INFO)  /.test(l)), out).toEqual([]);
      expect(calls).toHaveLength(4);
      for (const c of calls) {
        expect(c, "a call that is neither a read RPC nor a GET").toMatch(
          /^curl\t(POST https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/(get_cron_health|get_explore_cache)\t|GET https:\/\/(p\.supabase\.co\/rest\/v1\/job_board_stats_rollup\?select=|site\.test\/ghost-job-index$))/,
        );
      }
      expect(out).not.toContain(KEY);
    }
  });

  it("a good deploy dated by COST_DB_APPLIED_AT PASSes every claim, with no FAIL", () => {
    const { lines, out } = run(after(), THREE_HOURS_AGO());
    expect(fails(lines), out).toEqual([]);
    for (const re of [
      /^PASS  board-recency-ladder is no longer scheduled \(20261109100000\)/,
      /^PASS  refresh-explore-role-rows is no longer scheduled \(20261109110000\)/,
      /^PASS  refresh-board-facets runs on 2,17,32,47 \* \* \* \* with its timeout \(10min\)/,
      /^PASS  scan-cache-and-telemetry-purge sets its own timeout \(2min\)/,
      /^PASS  job-board-stats-rollup runs on \*\/30 \* \* \* \* with its timeout \(4min\)/,
      /^PASS  refresh-ghost-stats runs on 15 \* \* \* \* with its timeout \(15min\)/,
      /^PASS  the ghost row was written at \d\d:15 UTC/,
      /^PASS  the coverage rows written at .* carry the same total for all 2 sources under one stamp/,
      /^PASS  the explore row .* comes from the new writer: none of field_curves, chip_coverage or role_rows, no denominators in totals, and the field_grid 2 fields, repost_index 2 boards/,
      /^PASS  \/ghost-job-index says "recomputed once an hour" for the ghost index figures/,
      /^PASS  \/ghost-job-index says "recomputed every 30 minutes" for the feed freshness figures/,
    ]) expect(passes(lines).some((l) => re.test(l)), `${re} missing\n${out}`).toBe(true);
  });

  it("with no date given, the ghost row's :15 stamp dates the rows written after it", () => {
    const g = lastMinute((m) => m === 15);
    const fresh = after({ explore: [newRow(iso(g + 30_000))], rollup: rollupRows({ ghostAt: iso(g), covAt: lastHalfHour() }) });
    const ok = run(fresh);
    expect(fails(ok.lines), ok.out).toEqual([]);
    expect(has(ok.lines, "PASS", /the explore row .* comes from the new writer/), ok.out).toBe(true);
    // The same moment, with today's row: written after the :15 run, so after the change.
    const stale = run(after({ explore: [liveRow(iso(g + 30_000))], rollup: rollupRows({ ghostAt: iso(g), covAt: lastHalfHour() }) }));
    expect(fails(stale.lines), stale.out).toEqual([
      expect.stringMatching(/^FAIL  the explore row written at .*, after the change \(the ghost row stamped .*\), still carries field_curves, chip_coverage, role_rows, 8 denominators in totals: refresh_explore_cache was not re-issued/),
    ]);
  });

  it("a row it cannot date is INFO, never a verdict either way", () => {
    // Step 2 shows, but the ghost row is still the old schedule's (minute 35) and no date is given.
    const { lines, out } = run(after({ explore: [liveRow(lastAt(7))], rollup: rollupRows({ ghostAt: lastAt(35), covAt: lastHalfHour(), date: COV_DATE, descr: [{ ...COV_DESC[0], total: 1 }, COV_DESC[1]] }) }));
    expect(fails(lines), out).toEqual([]);
    expect(has(lines, "INFO", /the explore row .* still carries .* which this key cannot tell apart/), out).toBe(true);
    expect(has(lines, "INFO", /the coverage rows .* cannot be dated against the change/), out).toBe(true);
    expect(has(lines, "INFO", /the ghost row was written at \d\d:35 UTC .* on the earlier schedule/), out).toBe(true);
  });
});

describe("each claim broken is a FAIL", () => {
  const failsWith = (r: Route[], re: RegExp, at?: string) => {
    const { lines, out } = run(r, at);
    expect(fails(lines).some((l) => re.test(l)), `${re} not failed\n${out}`).toBe(true);
    return lines;
  };

  it("a job step 1 retires that is still scheduled", () => {
    failsWith(after({ cron: cron(AFTER(), { "board-recency-ladder": job("board-recency-ladder", "2-59/5 * * * *", null, 288) }) }), /^FAIL  board-recency-ladder is still scheduled .* 20261109100000 did not take/);
    failsWith(after({ cron: cron(AFTER(), { "refresh-explore-role-rows": job("refresh-explore-role-rows", "22 */6 * * *", "10min", 4) }) }), /^FAIL  refresh-explore-role-rows is still scheduled .* 20261109110000 did not take/);
  });

  it("the facets job left on its old minutes, without its timeout, or paused", () => {
    failsWith(after({ cron: cron(AFTER(), { "refresh-board-facets": { ch_schedule: "7,22,37,52 * * * *" } }) }), /^FAIL  refresh-board-facets: 7,22,37,52 \* \* \* \*, timeout 10min/);
    failsWith(after({ cron: cron(AFTER(), { "refresh-board-facets": { ch_timeout: null } }) }), /^FAIL  refresh-board-facets: 2,17,32,47 \* \* \* \*, timeout none/);
    failsWith(after({ cron: cron(AFTER(), { "refresh-board-facets": { ch_active: false } }) }), /^FAIL  refresh-board-facets: 2,17,32,47 \* \* \* \* PAUSED/);
  });

  it("the nightly purge without a timeout of its own once step 1 shows, and nothing to judge when the hourly delete is not scheduled", () => {
    failsWith(after({ cron: cron(AFTER(), { "scan-cache-and-telemetry-purge": { ch_timeout: null } }) }), /^FAIL  scan-cache-and-telemetry-purge: 10 4 \* \* \*, timeout none/);
    const { lines, out } = run(after({ cron: cron(AFTER(), { "scan-cache-and-telemetry-purge": { ch_timeout: null }, "scan-report-cache-retention": null }) }), THREE_HOURS_AGO());
    expect(fails(lines), out).toEqual([]);
    expect(has(lines, "INFO", /scan-report-cache-retention is not scheduled, so the nightly purge keeps its report-cache delete/), out).toBe(true);
  });

  it("an hourly delete that is switched off leaves the nightly purge as 20261109131000 found it, and that is no FAIL (review 2026-11-15)", () => {
    const { lines, out } = run(after({ cron: cron(AFTER(), { "scan-cache-and-telemetry-purge": { ch_timeout: null }, "scan-report-cache-retention": { ch_active: false } }) }), THREE_HOURS_AGO());
    expect(fails(lines), out).toEqual([]);
    expect(has(lines, "INFO", /scan-report-cache-retention is switched off, so the nightly purge keeps its report-cache delete/), out).toBe(true);
  });

  it("a one-shot dropper the watcher never retired, or one that keeps failing; a young one is INFO and marks step 1", () => {
    // The droppers and the watcher run once an hour (20261109190000), so the counts are ones an hour can reach.
    failsWith(after({ cron: cron(AFTER(), { "oneshot-drop-postings-company-token-idx": { ch_schedule: "26 * * * *", ch_runs: 2 } }) }), /^FAIL  oneshot-drop-postings-company-token-idx is still scheduled after 2 runs, 2 of them not failed .*the watcher has not retired it/);
    failsWith(after({ cron: cron(AFTER(), { "oneshot-drop-duplicate-indexes-watch": { ch_schedule: "50 * * * *", ch_runs: 5 } }) }), /^FAIL  oneshot-drop-duplicate-indexes-watch is still scheduled after 5 hourly passes/);
    failsWith(after({ cron: cron(AFTER(), { "oneshot-drop-ai-response-cache-expires-idx": { ch_schedule: "29 * * * *", ch_runs: 5, ch_failed: 3, ch_last_status: "failed" } }) }), /^FAIL  oneshot-drop-ai-response-cache-expires-idx failed 3 of 5 runs \(last failed\)/);
    for (const p of [{ ch_runs: 1 }, { ch_runs: 2, ch_failed: 1, ch_last_status: "failed" }]) {
      const young = run(after({ cron: cron(AFTER(), { "oneshot-drop-temp-resume-expires-idx": { ch_schedule: "28 * * * *", ...p } }) }), THREE_HOURS_AGO());
      expect(fails(young.lines), young.out).toEqual([]);
      expect(has(young.lines, "INFO", new RegExp(`oneshot-drop-temp-resume-expires-idx is still working \\(${p.ch_runs} runs`)), young.out).toBe(true);
    }
    const watching = run(after({ cron: cron(AFTER(), { "oneshot-drop-duplicate-indexes-watch": { ch_schedule: "50 * * * *", ch_runs: 4 } }) }), THREE_HOURS_AGO());
    expect(fails(watching.lines), watching.out).toEqual([]);
    expect(has(watching.lines, "INFO", /oneshot-drop-duplicate-indexes-watch is still working \(4 hourly passes/), watching.out).toBe(true);
    // Alone in cron health, a dropper is a mark of step 1, so the jobs step 1 retires are judged.
    const alone = run(before({ cron: cron(BEFORE, { "oneshot-drop-temp-resume-expires-idx": { ch_schedule: "28 * * * *", ch_runs: 1 } }) }));
    expect(has(alone.lines, "FAIL", /^FAIL  board-recency-ladder is still scheduled/), alone.out).toBe(true);
  });

  it("a schedule step 2 moves that did not move, or lost its timeout, and step 2 without step 1", () => {
    // 122000 (paste step 5) shows, so 121000 (paste step 3) had to apply before it.
    failsWith(after({ cron: cron(AFTER(), { "job-board-stats-rollup": { ch_schedule: "*/15 * * * *" } }) }), /^FAIL  job-board-stats-rollup: \*\/15 \* \* \* \*, timeout 4min.* 20261109122000 shows .* so 20261109121000, which leaves it on \*\/30 \* \* \* \*, did not take/);
    // The ghost job alone on its old schedule is judged only when COST_DB_APPLIED_AT says the paste finished.
    failsWith(after({ cron: cron(AFTER(), { "refresh-ghost-stats": { ch_schedule: "5,35 * * * *" } }) }), /^FAIL  refresh-ghost-stats: 5,35 \* \* \* \*, timeout 15min.* COST_DB_APPLIED_AT says the lane applied, and 20261109122000 leaves it on 15 \* \* \* \*/, THREE_HOURS_AGO());
    failsWith(after({ cron: cron(AFTER(), { "job-board-stats-rollup": { ch_timeout: null } }) }), /^FAIL  job-board-stats-rollup: \*\/30 \* \* \* \*, timeout none/);
    failsWith(before({ cron: cron(BEFORE, STEP2_PATCH) }), /^FAIL  step 2 shows in cron health .* with no mark of step 1/);
  });

  it("between paste steps 3 and 5 (121000 applied, 122000 not yet) every ghost claim is INFO and the rollup claims are judged (review 2026-11-15)", () => {
    const mid = cron(BEFORE, { ...STEP1_PATCH, "job-board-stats-rollup": STEP2_PATCH["job-board-stats-rollup"] });
    const { lines, out } = run(routes({
      cron: mid, explore: [newRow(lastAt(7))],
      rollup: rollupRows({ ghostAt: lastAt(5), covAt: lastHalfHour() }),
      page: PAGE_NEW,
    }));
    expect(fails(lines), out).toEqual([]);
    expect(has(lines, "PASS", /^PASS  job-board-stats-rollup runs on \*\/30 \* \* \* \* with its timeout \(4min\) in the command \(20261109121000\)/), out).toBe(true);
    expect(has(lines, "PASS", /^PASS  \/ghost-job-index says "recomputed every 30 minutes" for the feed freshness figures/), out).toBe(true);
    expect(has(lines, "INFO", /^INFO  before 20261109122000: refresh-ghost-stats runs \(5,35 .*\); the after-functions step moves it to 15 \* \* \* \* at paste step 5/), out).toBe(true);
    expect(has(lines, "INFO", /^INFO  before 20261109122000: the ghost row was written at \d\d:05 UTC/), out).toBe(true);
    expect(has(lines, "INFO", /^INFO  \/ghost-job-index already says "recomputed once an hour" for the ghost index figures while refresh-ghost-stats still runs on 5,35 .* before 20261109122000 applies at paste step 5/), out).toBe(true);
    // The same moment with the rollup's sentence still the old one is a FAIL: its own file has applied.
    failsWith(routes({ cron: mid, explore: [newRow(lastAt(7))], rollup: rollupRows({ ghostAt: lastAt(5), covAt: lastHalfHour() }), page: page("recomputed once an hour", "recomputed every 15 minutes") }),
      /^FAIL  \/ghost-job-index says "recomputed every 15 minutes" for the feed freshness figures, but job-board-stats-rollup runs on \*\/30/);
  });

  it("an explore row from the new writer that lost a part the page reads, or kept a denominator", () => {
    failsWith(after({ explore: [newRow(lastAt(7), { field_grid: undefined })] }), /^FAIL  the explore row .* comes from the new writer, but it has no field grid/);
    failsWith(after({ explore: [newRow(lastAt(7), { repost_index: undefined })] }), /^FAIL  the explore row .* comes from the new writer, but it has no repost index/);
    failsWith(after({ explore: [newRow(lastAt(7), { totals: { postings_n: 999_821, repost_flagged_n: 2 } })] }), /^FAIL  the explore row .* comes from the new writer, but its totals carry postings_n/);
  });

  it("an explore row written after the change that still carries the retired parts", () => {
    failsWith(after({ explore: [liveRow(lastAt(7))] }), /^FAIL  the explore row written at .*, after the change \(COST_DB_APPLIED_AT .*\), still carries field_curves/, THREE_HOURS_AGO());
  });

  it("coverage rows written after the change that disagree, carry two stamps or fall off the half hour; and a stalled rollup", () => {
    const at = THREE_HOURS_AGO();
    const cov = (o: Partial<Parameters<typeof rollupRows>[0]>) => after({ rollup: rollupRows({ ghostAt: lastAt(15), covAt: lastHalfHour(), ...o }) });
    failsWith(cov({ descr: [{ ...COV_DESC[0], total: 448_000 }, COV_DESC[1]] }), /^FAIL  the coverage rows written at .* disagree on 1 source total\(s\) \(workday: 448002 vs 448000\)/, at);
    failsWith(cov({ descr: [...COV_DESC, { source: "lever", total: 7, described: 7 }] }), /^FAIL  the coverage rows written at .* disagree on 1 source total\(s\) \(lever: absent vs 7\)/, at);
    const t = lastMinute((m) => m % 30 === 0);
    failsWith(cov({ covAt: iso(t), descAt: iso(t + 1_000) }), /^FAIL  the coverage rows written at .* carry different stamps/, at);
    failsWith(cov({ covAt: lastAt(15) }), /^FAIL  the coverage rows written at .* fall on minute 15, which \*\/30 never runs/, at);
    failsWith(cov({ covAt: ago(40) }), /^FAIL  the coverage rows were written 40 min ago .* so the rollup has stopped/);
    failsWith(cov({ drop: ["desc_coverage"] }), /^FAIL  the stats rollup lacks a coverage row \(date_coverage present, desc_coverage absent\)/);
  });

  it("a ghost row no :15 run has written for over an hour, or one written on the old minute after the change", () => {
    failsWith(after({ rollup: rollupRows({ ghostAt: ago(70), covAt: lastHalfHour() }) }), /^FAIL  the ghost row was written 70 min ago .* no :15 run has written it/);
    failsWith(after({ rollup: rollupRows({ ghostAt: lastAt(35), covAt: lastHalfHour() }) }), /^FAIL  the ghost row was written at \d\d:35 UTC, after the change .* another job still runs the old one/, THREE_HOURS_AGO());
  });

  it("a cadence sentence this deploy made false, and none before step 2 when the page moved first", () => {
    failsWith(after({ page: PAGE_TODAY }), /^FAIL  \/ghost-job-index says "recomputed every 15 minutes" for the feed freshness figures, but job-board-stats-rollup runs on \*\/30/);
    failsWith(after({ page: PAGE_TODAY }), /^FAIL  \/ghost-job-index says "recomputed twice an hour" for the ghost index figures, but refresh-ghost-stats runs on 15/);
    // The frontend publishes at merge: the new sentence is live while the old schedules still run.
    const early = run(before({ cron: STEP1(), page: PAGE_NEW }));
    expect(fails(early.lines), early.out).toEqual([]);
    expect(has(early.lines, "INFO", /\/ghost-job-index already says "recomputed every 30 minutes" .* while job-board-stats-rollup still runs on \*\/15/), early.out).toBe(true);
  });

  it("every unreadable answer is a FAIL that shows it; a deliberate permission refusal on the rollup is INFO", () => {
    failsWith(after({ cronBody: "<html>502 Bad Gateway</html>" }), /^FAIL  get_cron_health answered no JSON .*502 Bad Gateway/);
    failsWith(after({ cron: [] }), /^FAIL  get_cron_health answered no jobs at all/);
    failsWith(after({ cron: { code: "PGRST202", message: "not found" } }), /^FAIL  get_cron_health answered \{"code":"PGRST202"/);
    failsWith(after({ exploreBody: "<html>timeout</html>" }), /^FAIL  get_explore_cache answered no JSON/);
    failsWith(after({ explore: { code: "57014", message: "canceling statement" } }), /^FAIL  get_explore_cache answered \{"code":"57014"/);
    failsWith(after({ rollupBody: "<html>504</html>" }), /^FAIL  the stats rollup rows answered no JSON/);
    failsWith(after({ rollup: { code: "PGRST301", message: "JWT expired" }, rollupStatus: 401 }), /^FAIL  the stats rollup rows are not readable with this key \(PGRST301/);
    failsWith(after({ page: "" }), /^FAIL  \/ghost-job-index answered no page to a crawler/);
    const refused = run(after({ rollup: { code: "42501", message: "permission denied for table job_board_stats_rollup" }, rollupStatus: 401 }), THREE_HOURS_AGO());
    expect(fails(refused.lines), refused.out).toEqual([]);
    expect(has(refused.lines, "INFO", /the stats rollup rows are not readable with this key \(42501.*the lines that date them are skipped/), refused.out).toBe(true);
  });

  it("a COST_DB_APPLIED_AT that is no date, in the future, or set while cron health shows the lane unapplied", () => {
    failsWith(after(), /^FAIL  COST_DB_APPLIED_AT=yesterday is not a date/, "yesterday");
    failsWith(after(), /^FAIL  COST_DB_APPLIED_AT=.* is in the future/, iso(Date.now() + 3_600_000));
    failsWith(before(), /^FAIL  COST_DB_APPLIED_AT=.* says the lane applied, but cron health shows step 1 not applied/, THREE_HOURS_AGO());
    failsWith(before({ cron: STEP1() }), /^FAIL  COST_DB_APPLIED_AT=.* says the lane applied, but cron health shows step 2 not applied/, THREE_HOURS_AGO());
  });
});
