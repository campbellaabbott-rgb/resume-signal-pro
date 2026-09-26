/**
 * THE THRESHOLD THE COPY PRINTS IS THE ONE THE SERVER GATED ON.
 *
 * Every number a layoff surface prints -- the display window, the worker bar,
 * the employer floor and share cap of the Ghost Index partition, EVERY BAR OF
 * THE DAY-30 GATE, the stale bound, the two cadence words -- is spelled ONCE
 * in src/config/layoffs.ts and interpolated into copy. The same numbers are
 * enforced in FOUR other runtimes that no compiler links to that file:
 *
 *   SQL   the readers' bar CTE (get_employer_layoff_filings, _all), the
 *         partition writer's k CTE (refresh_layoff_partition), the partition
 *         reader's k CTE (get_layoff_partition), the cron rows the cadence
 *         words describe, and the two fill curves that hold the OTHER TWO
 *         COPIES of the day-30 gate (get_category_fill_curve,
 *         get_company_fill_curve);
 *
 * THE DAY-30 GATE IS DUPLICATED IN THREE FUNCTIONS AND INHERITED BY NONE OF
 * THEM. An earlier version of this file said the partition inherited the
 * category curve's, and compared two bars: the risk-set floor and the
 * half-width ceiling. On 2026-09-25 the category curve gained a positive
 * control -- a floor on the cohort's own events, a floor on its fills, a
 * balance term, and a ceiling on the half-width relative to the complement --
 * and the partition kept the four vacuous terms it had. The two gates had
 * diverged by a whole term and this guard was green, because the bars it
 * compared were exactly the ones that had not moved. A guard that pins the
 * spellings that did not change proves nothing about the ones that did, so
 * every bar of the gate is now compared across all three copies.
 *   Deno  the poller (layoff-filings), the MCP server's LAYOFF_BARS, and the
 *         heartbeat's bounds.
 *
 * Copy goes false when the thing it describes moves runtimes (the "no
 * subscriptions" incident; project_claim_drift). This is the cross-runtime
 * guard: it reads every mirror off COMMENT-STRIPPED source by regex, fails on
 * any drift, and proves on a mutated copy of each side that it can fire.
 * The cadence words are checked against the SHAPE of the cron expression --
 * "hourly" is one fixed minute every hour, "nightly" is one fixed minute and
 * hour every day -- so the word cannot outrun the schedule.
 *
 * A mirror whose file has not landed yet is reported as a skip with the path
 * named, never as a pass; a mirror whose file exists is asserted.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripTs = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const MIGRATION_DIR = resolve(ROOT, "supabase/migrations");
const MIGRATIONS = readdirSync(MIGRATION_DIR).filter((n) => n.endsWith(".sql")).sort();

/** The newest migration whose CODE defines the function. */
function newestDefining(fn: string): string {
  const hits = MIGRATIONS.filter((n) => new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`).test(stripSql(read(`supabase/migrations/${n}`))));
  const f = hits[hits.length - 1];
  if (!f) throw new Error(`no migration defines ${fn}`);
  return `supabase/migrations/${f}`;
}
function newestScheduling(job: string): string {
  const hits = MIGRATIONS.filter((n) => new RegExp(`cron\\.schedule\\(\\s*'${job}'`).test(stripSql(read(`supabase/migrations/${n}`))));
  const f = hits[hits.length - 1];
  if (!f) throw new Error(`no migration schedules ${job}`);
  return `supabase/migrations/${f}`;
}

// ── parsers, each a pure function of one text ───────────────────────────────

/** `<value>(::numeric)? AS <name>` pairs inside the FIRST `k AS (SELECT …)` after the function's CREATE. */
export function barsOfFunction(sql: string, fn: string): Record<string, number> {
  const code = stripSql(sql);
  const at = code.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`));
  if (at < 0) throw new Error(`${fn} is not defined in the text`);
  const m = /\bk AS \(\s*SELECT([\s\S]*?)\)\s*,/.exec(code.slice(at));
  if (!m) throw new Error(`the k CTE of ${fn} was not found`);
  const out: Record<string, number> = {};
  for (const p of m[1].matchAll(/(?<![\w'.])(\d+(?:\.\d+)?)(?:::numeric)?\s+AS\s+([a-z_0-9]+)/g)) out[p[2]] = Number(p[1]);
  return out;
}

/** Every `export const LAYOFF_<NAME> = <number>` plus the two object literals. */
export function configOf(ts: string): { nums: Record<string, number>; staleHours: Record<string, number>; cadence: Record<string, string>; schedules: Record<string, string> } {
  const code = stripTs(ts);
  const nums: Record<string, number> = {};
  for (const m of code.matchAll(/export const (LAYOFF_[A-Z0-9_]+)\s*=\s*(\d+(?:\.\d+)?)\s*;/g)) nums[m[1]] = Number(m[2]);
  const obj = (name: string) => {
    const m = new RegExp(`export const ${name}\\s*=\\s*\\{([^}]*)\\}`).exec(code);
    if (!m) throw new Error(`${name} is not an object literal in src/config/layoffs.ts`);
    return m[1];
  };
  const staleHours: Record<string, number> = {};
  for (const m of obj("LAYOFF_STALE_HOURS").matchAll(/(\w+)\s*:\s*(\d+)/g)) staleHours[m[1]] = Number(m[2]);
  const cadence: Record<string, string> = {};
  for (const m of obj("LAYOFF_READ_CADENCE").matchAll(/(\w+)\s*:\s*"([^"]*)"/g)) cadence[m[1]] = m[2];
  const schedules: Record<string, string> = {};
  for (const m of obj("LAYOFF_CRON_SCHEDULES").matchAll(/(\w+)\s*:\s*"([^"]*)"/g)) schedules[m[1]] = m[2];
  return { nums, staleHours, cadence, schedules };
}

export function scheduleOf(sql: string, job: string): string {
  const m = new RegExp(`cron\\.schedule\\(\\s*'${job}',\\s*'([^']+)'`).exec(stripSql(sql));
  if (!m) throw new Error(`${job} is not scheduled in the text`);
  return m[1].trim();
}

/** The one word a five-field cron expression earns; anything else is spelled out. */
export function cadenceOf(schedule: string): string {
  const f = schedule.trim().split(/\s+/);
  if (f.length !== 5) return `unreadable:${schedule}`;
  const fixed = (x: string) => /^\d+$/.test(x);
  const every = (x: string) => x === "*";
  if (fixed(f[0]) && every(f[1]) && every(f[2]) && every(f[3]) && every(f[4])) return "hourly";
  if (fixed(f[0]) && fixed(f[1]) && every(f[2]) && every(f[3]) && every(f[4])) return "nightly";
  return `other:${schedule}`;
}

/** `LAYOFF_BARS = { … }` in agent-mcp, keys normalised so `warnMinWorkers` and `LAYOFF_WARN_MIN_WORKERS` compare. */
export function barsOfMcp(ts: string): Record<string, number | string> {
  const m = /const LAYOFF_BARS\s*=\s*\{([\s\S]*?)\}\s*as const;/.exec(stripTs(ts));
  if (!m) throw new Error("agent-mcp has no LAYOFF_BARS");
  const out: Record<string, number | string> = {};
  for (const p of m[1].matchAll(/(\w+)\s*:\s*(?:"([^"]*)"|(\d+(?:\.\d+)?))/g)) out[norm(p[1])] = p[2] !== undefined ? p[2] : Number(p[3]);
  return out;
}
export const norm = (k: string) => k.replace(/^LAYOFF_/, "").replace(/_/g, "").toLowerCase();

/** Every `LAYOFF_<NAME> = <number>` and `LAYOFF_STALE_HOURS = {…}` in a Deno file. */
export function layoffConstsOf(ts: string): { nums: Record<string, number>; staleHours: Record<string, number> | null } {
  const code = stripTs(ts);
  const nums: Record<string, number> = {};
  for (const m of code.matchAll(/\b(LAYOFF_[A-Z0-9_]+)\s*=\s*(\d+(?:\.\d+)?)\b/g)) nums[m[1]] = Number(m[2]);
  const sh = /\bLAYOFF_STALE_HOURS\s*=\s*\{([^}]*)\}/.exec(code);
  const staleHours: Record<string, number> | null = sh ? {} : null;
  if (sh && staleHours) for (const m of sh[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) staleHours[m[1]] = Number(m[2]);
  return { nums, staleHours };
}

// ── THE PROPERTY, as one routine that returns every drift it finds ──────────

type Sources = {
  config: string; readerSql: string; readerAllSql: string; writerSql: string; partitionReaderSql: string; cronSql: string; categorySql: string; companySql: string;
  mcp?: string; poller?: string; heartbeat?: string;
};
export function drifts(s: Sources): string[] {
  const d: string[] = [];
  const c = configOf(s.config);
  const want = (name: string) => {
    if (!(name in c.nums)) d.push(`config:missing:${name}`);
    return c.nums[name];
  };
  const eq = (where: string, key: string, got: number | string | undefined, exp: number | string | undefined) => {
    if (got === undefined) d.push(`${where}:missing:${key}`);
    else if (got !== exp) d.push(`${where}:${key}:${got}!=${exp}`);
  };

  for (const [label, sql, fn] of [["reader", s.readerSql, "get_employer_layoff_filings"], ["reader-all", s.readerAllSql, "get_employer_layoff_filings_all"]] as const) {
    const k = barsOfFunction(sql, fn);
    eq(label, "layoff_display_max_age_days", k.layoff_display_max_age_days, want("LAYOFF_DISPLAY_MAX_AGE_DAYS"));
    eq(label, "layoff_warn_min_workers", k.layoff_warn_min_workers, want("LAYOFF_WARN_MIN_WORKERS"));
  }
  const w = barsOfFunction(s.writerSql, "refresh_layoff_partition");
  eq("writer", "layoff_lookback_days", w.layoff_lookback_days, want("LAYOFF_LOOKBACK_DAYS"));
  eq("writer", "layoff_warn_min_workers", w.layoff_warn_min_workers, want("LAYOFF_WARN_MIN_WORKERS"));
  eq("writer", "min_arm_employers", w.min_arm_employers, want("LAYOFF_MIN_ARM_EMPLOYERS"));
  eq("writer", "max_employer_share", w.max_employer_share, want("LAYOFF_MAX_EMPLOYER_SHARE"));
  eq("writer", "min_n_at_risk_30", w.min_n_at_risk_30, want("LAYOFF_PARTITION_MIN_N_AT_RISK_30"));
  eq("writer", "max_half_width_30", w.max_half_width_30, want("LAYOFF_PARTITION_MAX_HALF_WIDTH_30"));
  eq("writer", "min_events_30", w.min_events_30, want("LAYOFF_PARTITION_MIN_EVENTS_30"));
  eq("writer", "min_fills_30", w.min_fills_30, want("LAYOFF_PARTITION_MIN_FILLS_30"));
  eq("writer", "max_rel_half_width_30", w.max_rel_half_width_30, want("LAYOFF_PARTITION_MAX_REL_HALF_WIDTH_30"));
  const pr = barsOfFunction(s.partitionReaderSql, "get_layoff_partition");
  eq("partition-reader", "min_arm_employers", pr.min_arm_employers, want("LAYOFF_MIN_ARM_EMPLOYERS"));
  eq("partition-reader", "max_employer_share", pr.max_employer_share, want("LAYOFF_MAX_EMPLOYER_SHARE"));
  eq("partition-reader", "min_n_at_risk_30", pr.min_n_at_risk_30, want("LAYOFF_PARTITION_MIN_N_AT_RISK_30"));
  eq("partition-reader", "max_half_width_30", pr.max_half_width_30, want("LAYOFF_PARTITION_MAX_HALF_WIDTH_30"));
  eq("partition-reader", "min_events_30", pr.min_events_30, want("LAYOFF_PARTITION_MIN_EVENTS_30"));
  eq("partition-reader", "min_fills_30", pr.min_fills_30, want("LAYOFF_PARTITION_MIN_FILLS_30"));
  eq("partition-reader", "max_rel_half_width_30", pr.max_rel_half_width_30, want("LAYOFF_PARTITION_MAX_REL_HALF_WIDTH_30"));
  eq("partition-reader", "layoff_stale_hours_warn", pr.layoff_stale_hours_warn, c.staleHours.warn);
  // THE DAY-30 GATE IS DUPLICATED IN THREE FUNCTIONS, NOT INHERITED BY ANY OF
  // THEM. The comment here used to say the partition inherited the category
  // curve's gate; it never did, and on 2026-09-25 the two diverged by a whole
  // term -- the category curve gained a positive control and the partition kept
  // the four vacuous ones -- while this guard stayed green, because the only
  // bars it compared were the two that had not moved. Every bar of the gate is
  // compared across all three now, so the claim is enforced.
  for (const [label, sql, fn] of [
    ["category-curve", s.categorySql, "get_category_fill_curve"],
    ["company-curve", s.companySql, "get_company_fill_curve"],
  ] as const) {
    const g = barsOfFunction(sql, fn);
    eq(label, "min_n_at_risk_30", g.min_n_at_risk_30, want("LAYOFF_PARTITION_MIN_N_AT_RISK_30"));
    eq(label, "max_half_width_30", g.max_half_width_30, want("LAYOFF_PARTITION_MAX_HALF_WIDTH_30"));
    eq(label, "min_events_30", g.min_events_30, want("LAYOFF_PARTITION_MIN_EVENTS_30"));
    eq(label, "min_fills_30", g.min_fills_30, want("LAYOFF_PARTITION_MIN_FILLS_30"));
    eq(label, "max_rel_half_width_30", g.max_rel_half_width_30, want("LAYOFF_PARTITION_MAX_REL_HALF_WIDTH_30"));
  }
  // The cadence words describe the cron rows, by shape.
  for (const [key, job] of [["edgar", "layoff-edgar-atom"], ["warn", "layoff-warn"]] as const) {
    const sched = scheduleOf(s.cronSql, job);
    eq("cron", `${key}-schedule`, sched, c.schedules[key]);
    eq("cron", `${key}-cadence`, cadenceOf(sched), c.cadence[key]);
  }
  if (s.mcp !== undefined) {
    const b = barsOfMcp(s.mcp);
    eq("mcp", "displaymaxagedays", b.displaymaxagedays, want("LAYOFF_DISPLAY_MAX_AGE_DAYS"));
    eq("mcp", "warnminworkers", b.warnminworkers, want("LAYOFF_WARN_MIN_WORKERS"));
    eq("mcp", "cadenceedgar", b.cadenceedgar, c.cadence.edgar);
    eq("mcp", "cadencewarn", b.cadencewarn, c.cadence.warn);
    // Any further numeric bar the server names must agree with the config's constant of the same (normalised) name.
    const byNorm = Object.fromEntries(Object.entries(c.nums).map(([k, v]) => [norm(k), v]));
    for (const [k, v] of Object.entries(b)) if (typeof v === "number" && k in byNorm && byNorm[k] !== v) d.push(`mcp:${k}:${v}!=${byNorm[k]}`);
  }
  if (s.poller !== undefined) {
    const p = layoffConstsOf(s.poller);
    // Every constant the poller shares by NAME with the config must agree.
    for (const [k, v] of Object.entries(p.nums)) if (k in c.nums && c.nums[k] !== v) d.push(`poller:${k}:${v}!=${c.nums[k]}`);
    eq("poller", "LAYOFF_FEED_STALE_DAYS", p.nums.LAYOFF_FEED_STALE_DAYS, want("LAYOFF_FEED_STALE_DAYS"));
  }
  if (s.heartbeat !== undefined) {
    const h = layoffConstsOf(s.heartbeat);
    for (const [k, v] of Object.entries(h.nums)) if (k in c.nums && c.nums[k] !== v) d.push(`heartbeat:${k}:${v}!=${c.nums[k]}`);
    eq("heartbeat", "LAYOFF_MIN_ARM_EMPLOYERS", h.nums.LAYOFF_MIN_ARM_EMPLOYERS, want("LAYOFF_MIN_ARM_EMPLOYERS"));
    if (!h.staleHours) d.push("heartbeat:missing:LAYOFF_STALE_HOURS");
    else for (const k of ["edgar", "warn"]) eq("heartbeat", `LAYOFF_STALE_HOURS.${k}`, h.staleHours[k], c.staleHours[k]);
  }
  return [...new Set(d)];
}

// ── the real files ──────────────────────────────────────────────────────────

const CONFIG = "src/config/layoffs.ts";
const MCP = "supabase/functions/agent-mcp/index.ts";
const POLLER = "supabase/functions/layoff-filings/index.ts";
const HEARTBEAT = "supabase/functions/scan-heartbeat/index.ts";
// THE TWO CURVES ARE FOUND BY THE SAME RULE AS EVERY OTHER FUNCTION HERE --
// newestDefining, by stamp -- rather than pinned by filename. A pinned name is
// how this guard came to read a superseded file once already: the field curve
// was re-issued on 2026-09-25 with a positive control, and a spelled filename
// would have kept the comparison on the old gate while the live one moved.
const has = (p: string) => existsSync(resolve(ROOT, p));

/** The real files, read ONCE: the migration scan touches ~600 files and would otherwise run per test. */
const REAL: Sources = {
  config: read(CONFIG),
  readerSql: read(newestDefining("get_employer_layoff_filings")),
  readerAllSql: read(newestDefining("get_employer_layoff_filings_all")),
  writerSql: read(newestDefining("refresh_layoff_partition")),
  partitionReaderSql: read(newestDefining("get_layoff_partition")),
  cronSql: read(newestScheduling("layoff-edgar-atom")),
  categorySql: read(newestDefining("get_category_fill_curve")),
  companySql: read(newestDefining("get_company_fill_curve")),
};

describe("every runtime gates on the number the copy prints", () => {
  const sources = (): Sources => ({ ...REAL });

  it("the config exists and spells every constant the surfaces interpolate", () => {
    expect(has(CONFIG), `${CONFIG} is missing -- the copy has nothing to derive its numbers from`).toBe(true);
    const c = configOf(read(CONFIG));
    for (const k of ["LAYOFF_LOOKBACK_DAYS", "LAYOFF_DISPLAY_MAX_AGE_DAYS", "LAYOFF_WARN_MIN_WORKERS", "LAYOFF_MIN_ARM_EMPLOYERS",
      "LAYOFF_MAX_EMPLOYER_SHARE", "LAYOFF_FEED_STALE_DAYS", "LAYOFF_PARTITION_MIN_N_AT_RISK_30", "LAYOFF_PARTITION_MAX_HALF_WIDTH_30",
      "LAYOFF_PARTITION_MIN_EVENTS_30", "LAYOFF_PARTITION_MIN_FILLS_30", "LAYOFF_PARTITION_MAX_REL_HALF_WIDTH_30"]) {
      expect(c.nums, `${k} missing from ${CONFIG}`).toHaveProperty(k);
    }
    expect(Object.keys(c.staleHours).sort()).toEqual(["edgar", "warn"]);
    expect(Object.keys(c.cadence).sort()).toEqual(["edgar", "warn"]);
    expect(Object.keys(c.schedules).sort()).toEqual(["edgar", "warn"]);
  });

  it("SQL: the readers, the partition writer and reader, all three copies of the day-30 gate and the cron rows all agree with the config", () => {
    expect(drifts(sources())).toEqual([]);
  });

  it("the cadence words never say more than the schedules do", () => {
    const c = configOf(read(CONFIG));
    for (const k of ["edgar", "warn"]) {
      expect(["hourly", "nightly"], `${k} cadence word must be one the shape routine can confirm`).toContain(c.cadence[k]);
      expect(cadenceOf(c.schedules[k])).toBe(c.cadence[k]);
      expect(c.cadence[k]).not.toMatch(/live|real.?time|now|minute|instant/i);
    }
  });

  (has(MCP) ? it : it.skip)(`agent-mcp's LAYOFF_BARS agrees with the config (${MCP})`, () => {
    expect(drifts({ ...sources(), mcp: read(MCP) })).toEqual([]);
  });

  (has(POLLER) ? it : it.skip)(`the poller's constants agree with the config (${POLLER} not landed yet)`, () => {
    expect(drifts({ ...sources(), poller: read(POLLER) })).toEqual([]);
  });

  (has(HEARTBEAT) ? it : it.skip)(`the heartbeat's bounds agree with the config (${HEARTBEAT})`, () => {
    expect(drifts({ ...sources(), heartbeat: read(HEARTBEAT) })).toEqual([]);
  });
});

describe("the guard has teeth: one copy edited, the specific drift named", () => {
  const base = (): Sources => ({ ...REAL });

  it("the day-30 event floor moved in one copy of the gate and not the others: every disagreeing copy is named", () => {
    // THE DRIFT THIS GUARD DID NOT CATCH, AS A MUTANT. One copy of the gate
    // relaxes its positive control and the other two keep theirs — which is
    // exactly the shape that put a controlled field table beside an
    // uncontrolled layoff sentence on one page.
    const s = base();
    const loosen = (sql: string) => sql.replace(/(\n\s*)5(\s+AS min_events_30)/, (_m, a: string, b: string) => `${a}1${b}`);
    const w = loosen(s.writerSql);
    expect(w, "the writer fixture must actually differ").not.toBe(s.writerSql);
    expect(drifts({ ...s, writerSql: w })).toEqual(["writer:min_events_30:1!=5"]);
    const cat = loosen(s.categorySql);
    expect(cat).not.toBe(s.categorySql);
    expect(drifts({ ...s, categorySql: cat })).toEqual(["category-curve:min_events_30:1!=5"]);
    const co = loosen(s.companySql);
    expect(co).not.toBe(s.companySql);
    expect(drifts({ ...s, companySql: co })).toEqual(["company-curve:min_events_30:1!=5"]);
    // ...and the relative bar, the term an absolute width cannot express.
    const wide = (sql: string) => sql.replace(/0\.50(::numeric\s+AS max_rel_half_width_30)/, "0.99$1")
      .replace(/0\.50(\s+AS max_rel_half_width_30)/, "0.99$1");
    const w2 = wide(s.writerSql);
    expect(w2).not.toBe(s.writerSql);
    expect(drifts({ ...s, writerSql: w2 })).toEqual(["writer:max_rel_half_width_30:0.99!=0.5"]);
    const pr = wide(s.partitionReaderSql);
    expect(pr).not.toBe(s.partitionReaderSql);
    expect(drifts({ ...s, partitionReaderSql: pr })).toEqual(["partition-reader:max_rel_half_width_30:0.99!=0.5"]);
  });

  it("a copy of the gate that drops the event floor entirely is named as missing, not passed over", () => {
    const s = base();
    const strip = (sql: string) => sql.replace(/\n\s*5\s+AS min_events_30,/, "\n");
    for (const [key, label] of [["writerSql", "writer"], ["categorySql", "category-curve"],
      ["companySql", "company-curve"], ["partitionReaderSql", "partition-reader"]] as const) {
      const mutated = strip(s[key]);
      expect(mutated, `${label} fixture must differ`).not.toBe(s[key]);
      expect(drifts({ ...s, [key]: mutated })).toEqual([`${label}:missing:min_events_30`]);
    }
  });

  it("the config's worker bar moved to 49: every SQL mirror is named", () => {
    const s = base();
    const cfg = s.config.replace(/(LAYOFF_WARN_MIN_WORKERS\s*=\s*)50/, (_m, g1: string) => `${g1}49`);
    expect(cfg).not.toBe(s.config);
    const d = drifts({ ...s, config: cfg });
    expect(d).toEqual(expect.arrayContaining(["reader:layoff_warn_min_workers:50!=49", "reader-all:layoff_warn_min_workers:50!=49", "writer:layoff_warn_min_workers:50!=49"]));
  });

  it("the writer's employer floor moved to 5: the writer alone is named", () => {
    const s = base();
    const w = s.writerSql.replace(/(\d+)(\s+AS min_arm_employers)/, "5$2");
    expect(w).not.toBe(s.writerSql);
    expect(drifts({ ...s, writerSql: w })).toEqual(["writer:min_arm_employers:5!=10"]);
  });

  it("the partition reader's stale bound moved to 72 h: named", () => {
    const s = base();
    const p = s.partitionReaderSql.replace(/(\d+)(\s+AS layoff_stale_hours_warn)/, "72$2");
    expect(p).not.toBe(s.partitionReaderSql);
    expect(drifts({ ...s, partitionReaderSql: p })).toEqual(["partition-reader:layoff_stale_hours_warn:72!=48"]);
  });

  it("the warn cron moved to weekly while the copy still says nightly: the schedule AND the word are named", () => {
    const s = base();
    const cron = s.cronSql.replace(/cron\.schedule\(\s*'layoff-warn',\s*'40 3 \* \* \*'/, "cron.schedule(\n    'layoff-warn',\n    '40 3 * * 1'");
    expect(cron).not.toBe(s.cronSql);
    const d = drifts({ ...s, cronSql: cron });
    expect(d).toContain("cron:warn-schedule:40 3 * * 1!=40 3 * * *");
    expect(d).toContain("cron:warn-cadence:other:40 3 * * 1!=nightly");
  });

  it("the copy's word outruns the schedule (hourly on a nightly job): named", () => {
    const s = base();
    const cfg = s.config.replace(/warn:\s*"nightly"/, 'warn: "hourly"');
    expect(cfg).not.toBe(s.config);
    expect(drifts({ ...s, config: cfg })).toContain("cron:warn-cadence:nightly!=hourly");
  });

  it("a mirror spelled only in a COMMENT is not a mirror", () => {
    const s = base();
    const w = s.writerSql.replace(/(\d+)(\s+AS min_arm_employers)/, "5$2") + "\n-- 10 AS min_arm_employers\n";
    expect(drifts({ ...s, writerSql: w })).toEqual(["writer:min_arm_employers:5!=10"]);
  });

  it("an MCP bar that disagrees is named under its normalised key", () => {
    const mcp = `const LAYOFF_BARS = {\n  displayMaxAgeDays: 120,\n  warnMinWorkers: 50,\n  cadenceEdgar: "hourly",\n  cadenceWarn: "nightly",\n} as const;`;
    expect(drifts({ ...base(), mcp })).toEqual(["mcp:displaymaxagedays:120!=90"]);
    expect(drifts({ ...base(), mcp: mcp.replace("120", "90").replace('"hourly"', '"live"') })).toEqual(["mcp:cadenceedgar:live!=hourly"]);
  });

  it("a poller or heartbeat constant that shares a name with the config and disagrees is named", () => {
    expect(drifts({ ...base(), poller: "const LAYOFF_FEED_STALE_DAYS = 14;\nconst LAYOFF_WARN_MIN_WORKERS = 50;" }))
      .toEqual(["poller:LAYOFF_FEED_STALE_DAYS:14!=21"]);
    expect(drifts({ ...base(), poller: "const NOTHING = 1;" })).toEqual(["poller:missing:LAYOFF_FEED_STALE_DAYS"]);
    expect(drifts({ ...base(), heartbeat: "const LAYOFF_MIN_ARM_EMPLOYERS = 10;\nconst LAYOFF_STALE_HOURS = { edgar: 6, warn: 24 };" }))
      .toEqual(["heartbeat:LAYOFF_STALE_HOURS.warn:24!=48"]);
    expect(drifts({ ...base(), heartbeat: "const LAYOFF_MIN_ARM_EMPLOYERS = 10;" })).toEqual(["heartbeat:missing:LAYOFF_STALE_HOURS"]);
  });
});
