// A FIELD CURVE THAT TIMED OUT LIVE IS READ FROM THE HOURLY CACHE.
//
// WHAT HAPPENED. The field fill curve -- the function behind the Ghost Job
// Index's "by field" table and the field clause on every /jobs card -- was
// called LIVE on every visit to both pages. It answered in 34s on 2026-09-25,
// 47s at 14:xx on 2026-09-27, and hit its own 60-second statement timeout with
// NO rows at 18:xx and 23:xx the same day (scripts/verify-deploy.sh section
// 4e; reproduced once with the anon key: HTTP 500, code 57014, 60.63s). On the
// Ghost Job Index that call sat inside a caught Promise.all, so a timeout
// blanked the whole section silently; on /jobs it released an ask-once ref and
// the next render paid for the timeout again.
//
// THE PROPERTIES, each rendered where a render can show it and read off
// comment-stripped source where it cannot:
//   1. neither page calls the live function any more -- no file under
//      src/pages, src/hooks, src/components or src/lib does, in CODE;
//   2. both read the curve off the same hourly cache row the Ghost Job Index
//      already reads its six statistics from, through one shared reader;
//   3. the date printed beside the figures is the curve part's OWN stamp --
//      never the row's, never the tiles', never the leaderboard's -- and a
//      carried part says so beside its date;
//   4. an absent key renders the section in a "not yet computed" state, with
//      its heading, and never as an error and never as a live call; a cache
//      that could not be read at all says that instead, as a fact about our
//      read.
// Teeth: the source checkers are run against doctored copies of the shipped
// pages and must fail there; the reader is handed every refused shape.
//
// No literal any assertion below matches is spelled inside a comment in this
// file: the names live in constants, so a guard here cannot be satisfied by
// its own prose.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => stubTable(),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import GhostJobIndex from "../pages/GhostJobIndex";
import Jobs, { FILL_RATE_MIN_TRACKING_DAYS } from "../pages/Jobs";
import { readCachedFillCurve, FILL_CURVE_CACHE_KEY, FILL_CURVE_STAMP_KEY } from "../lib/fill-curve-cache";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const GHOST_PAGE = codeOf(read("src/pages/GhostJobIndex.tsx"));
const JOBS_PAGE = codeOf(read("src/pages/Jobs.tsx"));
const SLOW = { timeout: 8000 } as const;
const body = () => document.body.textContent ?? "";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3_600_000;

// ── the names, as data ──────────────────────────────────────────────────────
const LIVE_FN = "get_category_fill_curve";
const CACHE_FN = "get_stats_cache";
const READER = "readCachedFillCurve";
const HEADING = "How often roles are actually filled, by field";
const AS_OF = "Field figures as of ";
const NOT_YET = "have not been computed yet";
const UNREADABLE = "could not be read just now";
const FIELD_LINE = "Measured over every role in this field that we watched in the last";
const calls = (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn).length;

// ── fixtures ────────────────────────────────────────────────────────────────
/** A listed field row: sufficient at day 14, dated, watched past /jobs' floor,
 *  and with still_open_14 at or below one half so /jobs' comparison can speak. */
const fieldRow = (category: string) => ({
  category,
  n_at_risk_14: 400, fills_le_14: 120, fill_rate_14: 0.36, fill_rate_14_lo: 0.31, fill_rate_14_hi: 0.41,
  relist_rate_14: 0.17, still_open_14: 0.42, median_days_to_fill: null, median_censored: true,
  dated_coverage: 0.7, window_days: FILL_RATE_MIN_TRACKING_DAYS + 30, sufficient: true,
});
const GHOST = {
  total_open: 794317, total_companies: 32967, total_company_names: 32086, closed_90d: 1000,
  observed_days: 58, median_days_open: 13.8, median_days_to_close: 11, posted_coverage_pct: 99.4,
};
/** A cache row as the refresh writes it. `curve` is the fill-curve part, or
 *  absent; `stale` is stale_parts; `extra` lets a case add a sibling key. */
const cacheRow = (opts: { rowAt: string; curve?: unknown; stale?: string[]; extra?: Record<string, unknown> }) => ({
  computed_at: opts.rowAt,
  ghost_stats: { ...GHOST, computed_at: opts.rowAt },
  stale_parts: opts.stale ?? [],
  ...(opts.curve === undefined ? {} : { [FILL_CURVE_CACHE_KEY]: opts.curve }),
  ...(opts.extra ?? {}),
});

function mountGhost(cache: unknown) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === CACHE_FN) return { data: cache };
    if (fn === "get_ghost_job_index_stats") return { data: [GHOST] };
    if (fn === "get_actively_hiring_companies") return { data: [] };
    if (fn === "get_freshness_stats") return { data: [] };
    if (fn === "get_audit_result") return { data: null };
    if (fn === "get_date_coverage") return { data: [] };
    return { data: null };
  });
  return render(<MemoryRouter><GhostJobIndex /></MemoryRouter>);
}

type Row = {
  id: string; company: string; title: string; location: string; salary: null;
  applyUrl: string; source: string; token: string; category: string; postedAt: string | null;
};
const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const job = (over: Partial<Row> = {}): Row => ({
  id: "j0", company: "Acme", title: "Backend Engineer", location: "Remote", salary: null,
  applyUrl: "https://x/0", source: "greenhouse", token: "acme",
  category: "engineering", postedAt: daysAgoIso(24), ...over,
});

function mountJobs(cache: unknown, rows: Row[] = [job()]) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === CACHE_FN) return { data: cache, error: null };
    if (fn === "get_company_fill_curve") return { data: [], error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [], fits: {}, missing: {}, matched: {} } };
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: rows.find((r) => r.id === b.id) ?? null, description: "We need a backend engineer." } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: rows.length } };
      return {
        data: {
          jobs: rows, total: rows.length, totalAllCompanies: rows.length, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  window.history.replaceState({}, "", `/jobs?job=${rows[0].id}`);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE READER, handed every shape
// ════════════════════════════════════════════════════════════════════════════
describe("the shared reader accepts the written shapes and refuses the rest", () => {
  const at = iso(0);
  const rows = [fieldRow("alpha_field")];

  it("a cache that is not an object is unreadable, not absent", () => {
    for (const c of [null, undefined, "x", 3, [rows]]) {
      expect(readCachedFillCurve(c).state, JSON.stringify(c)).toBe("unreadable");
    }
  });

  it("a missing key, a null part, an unstamped part and rows that are not an array are absent", () => {
    expect(readCachedFillCurve({}).state).toBe("absent");
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: null }).state).toBe("absent");
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: { rows } }).state).toBe("absent");
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: { computed_at: "not a date", rows } }).state).toBe("absent");
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: { computed_at: at, rows: "alpha" } }).state).toBe("absent");
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: 7 }).state).toBe("absent");
    // A bare array with no stamp anywhere is unpublishable: a statistic names
    // its date basis, and this one cannot.
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: rows }).state).toBe("absent");
  });

  it("the part shape carries its OWN stamp, and a stamped empty array is an answer", () => {
    expect(readCachedFillCurve({ computed_at: iso(HOUR), [FILL_CURVE_CACHE_KEY]: { computed_at: at, rows } }))
      .toEqual({ state: "ready", rows, computedAt: at, carried: false });
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: { computed_at: at, rows: [] } }))
      .toEqual({ state: "ready", rows: [], computedAt: at, carried: false });
  });

  it("a bare array is dated by the sibling stamp first and the row's stamp second", () => {
    const rowAt = iso(2 * HOUR);
    const sibling = iso(3 * HOUR);
    expect(readCachedFillCurve({ computed_at: rowAt, [FILL_CURVE_CACHE_KEY]: rows, [FILL_CURVE_STAMP_KEY]: sibling }))
      .toEqual({ state: "ready", rows, computedAt: sibling, carried: false });
    expect(readCachedFillCurve({ computed_at: rowAt, [FILL_CURVE_CACHE_KEY]: rows }))
      .toEqual({ state: "ready", rows, computedAt: rowAt, carried: false });
  });

  it("carried is the refresh's own word: the part named in stale_parts, and only that part", () => {
    const part = { computed_at: at, rows };
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: part, stale_parts: ["ghost_stats", FILL_CURVE_CACHE_KEY] }))
      .toMatchObject({ state: "ready", carried: true });
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: part, stale_parts: ["ghost_stats"] }))
      .toMatchObject({ state: "ready", carried: false });
    expect(readCachedFillCurve({ [FILL_CURVE_CACHE_KEY]: part, stale_parts: "not a list" }))
      .toMatchObject({ state: "ready", carried: false });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. THE GHOST JOB INDEX, rendered
// ════════════════════════════════════════════════════════════════════════════
describe("the Ghost Job Index reads the curve off the cache and dates it with the part's own stamp", () => {
  it("renders the cached rows, prints the curve's stamp and not the row's, and never calls the live function", async () => {
    const rowAt = iso(0);
    const curveAt = iso(30 * 60_000);
    mountGhost(cacheRow({ rowAt, curve: { computed_at: curveAt, rows: [fieldRow("alpha_field")] } }));
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    expect(body()).toContain(HEADING);
    expect(body()).toContain(`${AS_OF}${new Date(curveAt).toLocaleString()}`);
    expect(body(), "the curve borrowed the row's stamp").not.toContain(`${AS_OF}${new Date(rowAt).toLocaleString()}`);
    expect(body()).toContain("recomputed hourly");
    expect(body()).not.toContain("carried forward");
    expect(body()).not.toContain(NOT_YET);
    expect(calls(LIVE_FN), "the live function was called although the cache carried the curve").toBe(0);
    expect(calls(CACHE_FN)).toBe(1);
  });

  it("a carried part says so beside its date", async () => {
    const curveAt = iso(26 * HOUR);
    mountGhost(cacheRow({ rowAt: iso(0), curve: { computed_at: curveAt, rows: [fieldRow("alpha_field")] }, stale: [FILL_CURVE_CACHE_KEY] }));
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    expect(body()).toContain(`${AS_OF}${new Date(curveAt).toLocaleString()} — carried forward`);
    expect(body()).toContain("did not finish");
    expect(calls(LIVE_FN)).toBe(0);
  });

  it("a bare-array part renders too, dated by its sibling stamp", async () => {
    const sibling = iso(3 * HOUR);
    mountGhost(cacheRow({ rowAt: iso(0), curve: [fieldRow("alpha_field")], extra: { [FILL_CURVE_STAMP_KEY]: sibling } }));
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    expect(body()).toContain(`${AS_OF}${new Date(sibling).toLocaleString()}`);
    expect(calls(LIVE_FN)).toBe(0);
  });

  it("an absent key renders the section as not yet computed -- heading kept, no table, no error, no live call", async () => {
    mountGhost(cacheRow({ rowAt: iso(0) }));
    await waitFor(() => expect(body()).toContain(NOT_YET), SLOW);
    expect(body()).toContain(HEADING);
    expect(body()).not.toContain("alpha field");
    expect(body()).not.toContain(AS_OF);
    expect(body()).not.toContain(UNREADABLE);
    expect(body(), "the tiles beside it still paint off the same row").toContain("794,317");
    // Settled: nothing arrives later to change the answer.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls(LIVE_FN), "an absent key was answered with the live function").toBe(0);
  });

  it("a cache that could not be read says so as a fact about our read, and still makes no live call", async () => {
    mountGhost(null);
    await waitFor(() => expect(body()).toContain(UNREADABLE), SLOW);
    expect(body()).toContain(HEADING);
    expect(body()).not.toContain(NOT_YET);
    expect(body()).not.toContain(AS_OF);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls(LIVE_FN)).toBe(0);
  });

  it("a computed curve with no row that clears the page's gate renders neither table nor empty state", async () => {
    mountGhost(cacheRow({ rowAt: iso(0), curve: { computed_at: iso(0), rows: [{ ...fieldRow("alpha_field"), sufficient: false }] } }));
    await waitFor(() => expect(body()).toContain("794,317"), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(body()).not.toContain(HEADING);
    expect(body()).not.toContain(NOT_YET);
    expect(body()).not.toContain(AS_OF);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. /JOBS, rendered
// ════════════════════════════════════════════════════════════════════════════
describe("/jobs reads the field curve off the same cache and dates its clause", () => {
  it("the field clause renders from the cached rows with the curve's stamp, and the live function is never called", async () => {
    const curveAt = iso(40 * 60_000);
    mountJobs(cacheRow({ rowAt: iso(0), curve: { computed_at: curveAt, rows: [fieldRow("engineering")] } }));
    await waitFor(() => expect(body()).toContain(FIELD_LINE), SLOW);
    expect(body()).toContain("Posted 24 days ago");
    expect(body()).toContain(AS_OF);
    expect(body()).not.toContain("carried forward");
    expect(calls(LIVE_FN)).toBe(0);
    expect(calls(CACHE_FN), "the cache is read once per mount").toBe(1);
  });

  it("a carried part is disclosed on the clause", async () => {
    mountJobs(cacheRow({ rowAt: iso(0), curve: { computed_at: iso(5 * HOUR), rows: [fieldRow("engineering")] }, stale: [FILL_CURVE_CACHE_KEY] }));
    await waitFor(() => expect(body()).toContain(FIELD_LINE), SLOW);
    expect(body()).toContain("carried forward");
    expect(calls(LIVE_FN)).toBe(0);
  });

  it("an absent key is silence on the card -- no clause, no error, no live call", async () => {
    mountJobs(cacheRow({ rowAt: iso(0) }));
    // The panel is genuinely open (this string exists nowhere else on the
    // page) and the cache has answered, so the clause's absence is a refusal
    // rather than a request that has not landed. With neither a field row nor
    // an employer curve the comparison block has nothing to compare against
    // and draws nothing at all, which is the page's existing rule.
    await waitFor(() => expect(body()).toContain("Apply on company site"), SLOW);
    await waitFor(() => expect(calls(CACHE_FN)).toBe(1), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(body()).toContain("Backend Engineer");
    expect(body()).not.toContain(FIELD_LINE);
    expect(body()).not.toContain(AS_OF);
    expect(body()).not.toContain(NOT_YET);
    expect(calls(LIVE_FN)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. THE SOURCE, comment-stripped, and its teeth
// ════════════════════════════════════════════════════════════════════════════
const DIRS = ["src/pages", "src/hooks", "src/components", "src/lib"];
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
/** Files whose CODE names the live function. Comments are stripped first, so
 *  a page may explain what it stopped doing without failing this. */
const liveCallers = (files: Array<[string, string]>): string[] =>
  files.filter(([, src]) => codeOf(src).includes(LIVE_FN)).map(([name]) => name);

describe("no page, hook, component or lib calls the live function", () => {
  it("across every source file under the four directories", () => {
    const files = DIRS.flatMap((d) => walk(resolve(ROOT, d))).map((p): [string, string] => [p.slice(ROOT.length + 1), readFileSync(p, "utf8")]);
    expect(files.length).toBeGreaterThan(50);
    expect(liveCallers(files)).toEqual([]);
  });

  it("teeth: a page that reads the live function again is named, whatever the spelling", () => {
    expect(JOBS_PAGE).toContain(`rpc("${CACHE_FN}")`);
    const mutant = JOBS_PAGE.replace(`rpc("${CACHE_FN}")`, `rpc("${LIVE_FN}")`);
    expect(mutant).not.toBe(JOBS_PAGE);
    expect(liveCallers([["Jobs.tsx", mutant]])).toEqual(["Jobs.tsx"]);
    expect(liveCallers([["x.ts", `await supabase.rpc(\`${LIVE_FN}\`, { p_days: 90 })`]])).toEqual(["x.ts"]);
    expect(liveCallers([["y.ts", `const fn = '${LIVE_FN}'; rpc(fn)`]])).toEqual(["y.ts"]);
  });

  it("teeth: a mention in a comment alone does not count, and a call beside one still does", () => {
    const commentOnly = `const x = 1;\n// ${LIVE_FN} used to be read here\n/* and ${LIVE_FN} here */\n`;
    expect(liveCallers([["c.ts", commentOnly]])).toEqual([]);
    expect(liveCallers([["d.ts", `${commentOnly}rpc("${LIVE_FN}");\n`]])).toEqual(["d.ts"]);
  });
});

/** The Ghost Job Index's properties as a function of its code, so the same
 *  checks run on the shipped page and on doctored copies. Returns violations. */
function ghostViolations(code: string): string[] {
  const out: string[] = [];
  if (code.includes(LIVE_FN)) out.push("the page still names the live function in code");
  if (!code.includes(`${READER}<FillCurveRow>(cache)`)) out.push("the page never reads the curve through the shared reader");
  if (!/setFillCurve\(cachedCurve\.rows\);[\s\S]{0,200}setFillCurveComputedAt\(cachedCurve\.computedAt\);[\s\S]{0,200}setFillCurveCarried\(cachedCurve\.carried\);/.test(code)) {
    out.push("the rows, the stamp and the carry flag are not taken from the same reading");
  }
  const stamp = "`" + AS_OF + "${new Date(fillCurveComputedAt).toLocaleString()}`";
  if (!code.includes(stamp)) out.push("the section does not print the curve's own computed_at");
  const h2 = code.indexOf(HEADING);
  const end = code.indexOf("Measured from our own lifecycle log over the last", h2);
  const section = h2 === -1 || end === -1 ? "" : code.slice(h2, end);
  if (!section) out.push("the section is gone");
  if (/statsComputedAt|cachedAt|leaderboardComputedAt|cache\??\.computed_at/.test(section)) out.push("the section borrows another stamp");
  if (!/fillCurveCarried\s*\?\s*" — carried forward/.test(section)) out.push("a carried part is not disclosed beside its date");
  if (!/fillCurveStatus === "absent"/.test(code) || !code.includes(NOT_YET)) out.push("no not-yet-computed state");
  if (!/fillCurveStatus === "unreadable"/.test(code) || !code.includes(UNREADABLE)) out.push("no unreadable state");
  return out;
}

describe("the Ghost Job Index source carries every property, comment-stripped", () => {
  it("no violations on the shipped page", () => {
    expect(ghostViolations(GHOST_PAGE)).toEqual([]);
  });

  it("teeth: a copy that dates the table with the tiles' stamp fails", () => {
    const mutant = GHOST_PAGE.replace("new Date(fillCurveComputedAt).toLocaleString()", "new Date(statsComputedAt as string).toLocaleString()");
    expect(mutant).not.toBe(GHOST_PAGE);
    const v = ghostViolations(mutant);
    expect(v).toContain("the section borrows another stamp");
    expect(v).toContain("the section does not print the curve's own computed_at");
  });

  it("teeth: a copy that stops reading the cache fails", () => {
    const mutant = GHOST_PAGE.replace(`${READER}<FillCurveRow>(cache)`, '({ state: "absent" } as const)');
    expect(mutant).not.toBe(GHOST_PAGE);
    expect(ghostViolations(mutant)).toContain("the page never reads the curve through the shared reader");
  });

  it("teeth: a copy with the empty state cut out fails", () => {
    const mutant = GHOST_PAGE.replace(NOT_YET, "are on their way");
    expect(mutant).not.toBe(GHOST_PAGE);
    expect(ghostViolations(mutant)).toContain("no not-yet-computed state");
  });
});

describe("/jobs source: the clause is dated in every locale", () => {
  const LOCALES = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
  it("reads the curve through the shared reader and prints the stamp through the two dated keys", () => {
    expect(JOBS_PAGE).toContain(`${READER}<FieldCurve>(cacheRow)`);
    expect(JOBS_PAGE).toMatch(/fillCurveCarried\s*\?\s*t\("jobsPage\.fieldCurveAsOfCarried"/);
    expect(JOBS_PAGE).toMatch(/t\("jobsPage\.fieldCurveAsOf",/);
    expect(JOBS_PAGE).toMatch(/new Date\(fillCurveComputedAt\)\.toLocaleString\(i18n\.language/);
  });

  it("both keys exist in all nine locales and carry the stamp placeholder", () => {
    expect(LOCALES.length).toBe(9);
    for (const f of LOCALES) {
      const j = JSON.parse(read(`src/i18n/locales/${f}`)) as { jobsPage: Record<string, string> };
      for (const k of ["fieldCurveAsOf", "fieldCurveAsOfCarried"]) {
        expect(j.jobsPage[k], `${f} lacks jobsPage.${k}`).toContain("{{when}}");
      }
    }
  });
});
