import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  STALE_LANE_MIN_AGE_H,
  STALE_PER_SLICE,
  STALE_TRIES_MAX,
  bumpStaleTries,
  classifyStale,
  countByClass,
  isPrototypeName,
  readStaleTries,
  selectStaleLane,
  tokensOf,
  writeStaleTries,
  type StaleContext,
  type StaleRow,
} from "../../supabase/functions/job-board/stale-lane.ts";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources.ts";

/**
 * EVERY STALE BOARD IS NAMED AND CLASSIFIED.
 *
 * Live 2026-09-10 02:45 UTC: get_freshness_stats() = boards 33,574, p50 168.8,
 * p95 346.5, max_min 20,961.0 minutes. The oldest stamp, 'constructor'
 * (2026-08-26 13:24), is 20,961 minutes old at that instant — the max is one
 * uncatalogued token whose rows the blocked orphan prune never retires. The
 * second, 'applied', is the same shape. Neither can be fixed by a fetch, and
 * 'constructor' would corrupt every token-keyed Record it touched.
 *
 * Two artefacts, both new files, neither wired:
 *   - 20260909218000: get_stalest_boards(), which names the tail, and the
 *     verified_at index it walks.
 *   - job-board/stale-lane.ts: classifyStale(), pure, and the lane selector.
 *
 * Behavioural tests over the module; text tests over the migration, against
 * comment-stripped SQL so prose about a rule is never mistaken for the rule.
 */
const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const STAMP = "20260909218000";
const MIG_FILE = readdirSync(MIG_DIR).find((f) => f.startsWith(STAMP));
const RAW = MIG_FILE ? readFileSync(resolve(MIG_DIR, MIG_FILE), "utf8") : "";
const SQL = RAW.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
/** The function's own body: from its `AS $$` to its closing `$$;` — not the COMMENT or the DO block after it. */
const BODY_AT = SQL.indexOf("AS $$");
const BODY = SQL.slice(BODY_AT, SQL.indexOf("$$;", BODY_AT + 5));
/** RAW with `-- ` line prefixes collapsed, so a prose assertion survives a re-wrap. */
const PROSE = RAW.replace(/\n--[ \t]*/g, " ");

const CATALOGUE = new Set(JOB_SOURCES.map((s) => s.token));

/** The twelve oldest stamps as read live 2026-09-10 (job_board_verifications, anon key). */
const LIVE_STAMPS: Array<[string, string]> = [
  ["constructor", "2026-08-26T13:24:02.389+00:00"],
  ["applied", "2026-08-26T23:44:49.363+00:00"],
  ["duravermeer", "2026-08-29T15:55:48.654+00:00"],
  ["cgsfederal", "2026-08-29T16:06:31.512+00:00"],
  ["cscgeneration-2", "2026-08-30T23:54:54.586+00:00"],
  ["aaff", "2026-08-31T00:24:40.605+00:00"],
  ["gopuff", "2026-08-31T00:24:40.867+00:00"],
  ["paytmpayments", "2026-08-31T00:24:51.225+00:00"],
  ["aloyoga", "2026-08-31T00:34:05.304+00:00"],
  ["gorh", "2026-08-31T00:34:59.604+00:00"],
  ["trilongroup", "2026-08-31T07:55:51.629+00:00"],
  ["feverup", "2026-08-31T08:04:09.87+00:00"],
];
const ROLLUP_AT = Date.parse("2026-09-10T02:45:00.046Z");
const ROLLUP_MAX_MIN = 20961.0;

function row(token: string, over: Partial<StaleRow> = {}): StaleRow {
  return {
    stale_token: token,
    stale_vendor: "greenhouse",
    stamped_at: "2026-08-30T00:00:00+00:00",
    age_min: 5000,
    posting_rows: 10,
    live_rows: 10,
    newest_effective: "2026-08-29T00:00:00+00:00",
    ...over,
  };
}
function ctx(over: Partial<StaleContext> = {}): StaleContext {
  return {
    catalogued: new Set(["alpha", "beta", "gamma", "delta"]),
    quarantinedVendors: new Set(),
    oversize: new Set(),
    dormant: new Set(),
    failing: new Set(),
    tries: new Map(),
    ...over,
  };
}

describe("the live tail, classified", () => {
  it("the oldest stamp IS the published max_min, to the minute — the self-check the RPC is built on", () => {
    const ageMin = (ROLLUP_AT - Date.parse(LIVE_STAMPS[0][1])) / 60_000;
    expect(Math.round(ageMin * 10) / 10).toBeCloseTo(ROLLUP_MAX_MIN, 0);
  });

  it("every one of the twelve IS catalogued — the 'uncatalogued' theory was a grep artefact", () => {
    // A quoted-token grep of sources.ts finds neither 'constructor' nor
    // 'applied'; JOB_SOURCES holds both as packed u(...) entries (ashby
    // "Constructor", ashby "Applied"). The tail is not orphans.
    for (const [t] of LIVE_STAMPS) expect(CATALOGUE.has(t), `${t} should be catalogued`).toBe(true);
    expect(JOB_SOURCES.find((s) => s.token === "constructor")?.source).toBe("ashby");
    expect(JOB_SOURCES.find((s) => s.token === "applied")?.source).toBe("ashby");
    // And exactly one catalogued token is an Object.prototype name.
    expect(JOB_SOURCES.filter((s) => isPrototypeName(s.token)).map((s) => s.token)).toEqual(["constructor"]);
  });

  it("classifies the live rows against the state /status exposed 2026-09-10 03:06 UTC", () => {
    // oversizeBoards (145 in the registry, top 50 shown) named seven of the
    // twelve; quarantinedVendors was []; dormantBoards is a count (279), not
    // names, so the dormant/failing dimension is empty here and the remaining
    // four read as 'unexplained' — which is honest: nothing anon-visible names
    // their cause, and they are exactly what the lane would fetch.
    const OVERSIZE_LIVE = new Set(["cgsfederal", "cscgeneration-2", "paytmpayments", "gopuff", "trilongroup", "gorh", "aaff"]);
    const VENDOR = new Map(JOB_SOURCES.map((s) => [s.token, s.source] as const)); // a Map: 'constructor' is a real key here
    const rows = LIVE_STAMPS.map(([t, at]) =>
      row(t, { stamped_at: at, age_min: (ROLLUP_AT - Date.parse(at)) / 60_000, stale_vendor: VENDOR.get(t) ?? null }),
    );
    const verdicts = classifyStale(rows, ctx({ catalogued: CATALOGUE, oversize: OVERSIZE_LIVE }));
    expect(Object.fromEntries(verdicts.map((v) => [v.token, v.cls]))).toEqual({
      constructor: "prototype_name",
      applied: "unexplained",
      duravermeer: "unexplained",
      cgsfederal: "oversize",
      "cscgeneration-2": "oversize",
      aaff: "oversize",
      gopuff: "oversize",
      paytmpayments: "oversize",
      aloyoga: "unexplained",
      gorh: "oversize",
      trilongroup: "oversize",
      feverup: "unexplained",
    });
    expect(countByClass(verdicts)).toEqual({
      prototype_name: 1, uncatalogued: 0, oversize: 7, quarantined: 0,
      dormant: 0, failing: 0, unresolved: 0, unexplained: 4,
    });
    // The lane fetches the three oldest it could actually help — never the
    // prototype name, never an oversize board.
    expect(selectStaleLane(verdicts, { perSlice: STALE_PER_SLICE, exclude: new Set() }))
      .toEqual(["applied", "duravermeer", "aloyoga"]);
  });
});

describe("prototype names are decided first and never indexed", () => {
  it("names every Object.prototype property, and nothing else", () => {
    for (const t of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"]) {
      expect(isPrototypeName(t), t).toBe(true);
    }
    for (const t of ["applied", "apply", "call", "bind", "length", "prototype", "gopuff", ""]) {
      expect(isPrototypeName(t), t).toBe(false);
    }
  });

  it("the executable proof: an empty Record 'has' constructor, an empty Set does not", () => {
    const rec: Record<string, number> = {};
    expect(rec["constructor"] != null).toBe(true);        // the trap
    expect(typeof rec["constructor"]).toBe("function");
    expect(new Set<string>().has("constructor")).toBe(false); // the module's shape
    expect(tokensOf({}).has("constructor")).toBe(false);      // the sanctioned ingest
    expect(tokensOf({ constructor: 1, gopuff: 2 })).toEqual(new Set(["constructor", "gopuff"]));
  });

  it("wins over every other class, even when the token is catalogued, dormant and failing", () => {
    const [v] = classifyStale([row("constructor")], ctx({
      catalogued: new Set(["constructor"]),
      dormant: new Set(["constructor"]),
      failing: new Set(["constructor"]),
      oversize: new Set(["constructor"]),
    }));
    expect(v.cls).toBe("prototype_name");
    expect(v.reason).toMatch(/Object\.prototype/);
  });
});

describe("classifyStale precedence, one class each", () => {
  const t = "alpha";
  const cases: Array<[string, Partial<StaleContext>, Partial<StaleRow>, string]> = [
    ["uncatalogued", { catalogued: new Set() }, {}, "uncatalogued"],
    ["oversize", { oversize: new Set([t]), quarantinedVendors: new Set(["greenhouse"]), dormant: new Set([t]) }, {}, "oversize"],
    ["quarantined", { quarantinedVendors: new Set(["greenhouse"]), dormant: new Set([t]), failing: new Set([t]) }, {}, "quarantined"],
    ["dormant", { dormant: new Set([t]), failing: new Set([t]), tries: new Map([[t, 99]]) }, {}, "dormant"],
    ["failing", { failing: new Set([t]), tries: new Map([[t, 99]]) }, {}, "failing"],
    ["unresolved", { tries: new Map([[t, STALE_TRIES_MAX]]) }, {}, "unresolved"],
    ["unexplained", { tries: new Map([[t, STALE_TRIES_MAX - 1]]) }, {}, "unexplained"],
  ];
  for (const [name, c, r, want] of cases) {
    it(`${name}`, () => {
      const [v] = classifyStale([row(t, r)], ctx(c));
      expect(v.cls).toBe(want);
      expect(v.token).toBe(t);
      expect(v.reason.length).toBeGreaterThan(40);
      expect(v.reason).toMatch(/\d+ rows, \d+ live, stamped /); // every reason carries the row's facts
    });
  }

  it("quarantine is judged by the row's vendor, and a null vendor never matches", () => {
    const q = ctx({ quarantinedVendors: new Set(["workday"]) });
    expect(classifyStale([row(t, { stale_vendor: "workday" })], q)[0].cls).toBe("quarantined");
    expect(classifyStale([row(t, { stale_vendor: "greenhouse" })], q)[0].cls).toBe("unexplained");
    expect(classifyStale([row(t, { stale_vendor: null })], q)[0].cls).toBe("unexplained");
  });

  it("triesMax can be overridden, and defaults to the exported constant", () => {
    expect(classifyStale([row(t)], ctx({ tries: new Map([[t, 2]]), triesMax: 2 }))[0].cls).toBe("unresolved");
    expect(classifyStale([row(t)], ctx({ tries: new Map([[t, STALE_TRIES_MAX - 1]]) }))[0].cls).toBe("unexplained");
    expect(classifyStale([row(t)], ctx({ tries: new Map([[t, STALE_TRIES_MAX]]) }))[0].cls).toBe("unresolved");
  });

  it("is pure: inputs untouched, order preserved, deterministic", () => {
    const rows = [row("beta"), row("alpha"), row("zeta")];
    const c = ctx({ dormant: new Set(["alpha"]) });
    const snapshot = JSON.stringify(rows);
    const a = classifyStale(rows, c);
    const b = classifyStale(rows, c);
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(a.map((v) => v.token)).toEqual(["beta", "alpha", "zeta"]);
    expect(a).toEqual(b);
    expect(c.dormant.size).toBe(1);
    expect(classifyStale([], c)).toEqual([]);
  });
});

describe("the lane selector and its state fold", () => {
  it("fetches only 'unexplained', oldest first, minus the slice, capped", () => {
    const verdicts = classifyStale([
      row("alpha", { age_min: 100 }),
      row("beta", { age_min: 900 }),
      row("gamma", { age_min: 500 }),
      row("delta", { age_min: 700 }),
      row("orphan", { age_min: 9999 }),
    ], ctx({ dormant: new Set(["gamma"]) }));
    expect(selectStaleLane(verdicts, { perSlice: 2, exclude: new Set() })).toEqual(["beta", "delta"]);
    expect(selectStaleLane(verdicts, { perSlice: 5, exclude: new Set(["beta"]) })).toEqual(["delta", "alpha"]);
    expect(selectStaleLane(verdicts, { perSlice: 0, exclude: new Set() })).toEqual([]);
    expect(selectStaleLane(verdicts, { perSlice: -1, exclude: new Set() })).toEqual([]);
  });

  it("a stamped token leaves the tries map; an unstamped one counts one more; others are untouched", () => {
    const before = new Map([["alpha", 1], ["beta", 3]]);
    const after = bumpStaleTries(before, ["alpha", "gamma"], new Set(["alpha"]));
    expect([...after]).toEqual([["beta", 3], ["gamma", 1]]);
    expect([...before]).toEqual([["alpha", 1], ["beta", 3]]); // pure
    const again = bumpStaleTries(after, ["gamma"], new Set());
    expect(again.get("gamma")).toBe(2);
  });

  it("tries round-trip through the meta shape, and garbage reads as empty", () => {
    const m = new Map([["alpha", 2], ["constructor", 1]]);
    const json = writeStaleTries(m);
    expect(Object.keys(json)).toEqual(["alpha", "constructor"]);
    expect(readStaleTries({ tries: json })).toEqual(m);
    for (const bad of [null, undefined, "x", 3, [], { tries: null }, { tries: [1] }, { tries: "no" }]) {
      expect(readStaleTries(bad).size, JSON.stringify(bad)).toBe(0);
    }
    expect(readStaleTries({ tries: { a: 0, b: -1, c: 1.5, d: "2", e: 2 } })).toEqual(new Map([["e", 2]]));
    // Reading never sees inherited names: an empty tries object has no 'constructor'.
    expect(readStaleTries({ tries: {} }).has("constructor")).toBe(false);
  });

  it("the header's wiring plan quotes the constants the module exports", () => {
    const src = readFileSync(resolve(ROOT, "supabase/functions/job-board/stale-lane.ts"), "utf8");
    const header = src.slice(0, src.indexOf("export const STALE_PER_SLICE"));
    expect(header).toMatch(new RegExp(`STALE_PER_SLICE = ${STALE_PER_SLICE}\\b`));
    expect(header).toMatch(/STALE_LANE_MIN_AGE_H\b/);
    expect(header).toMatch(/STALE_TRIES_MAX\b/);
    expect(STALE_PER_SLICE).toBe(3);
    expect(STALE_LANE_MIN_AGE_H).toBe(72);
    expect(STALE_TRIES_MAX).toBeGreaterThanOrEqual(2);
    // Wired in .69, and says so.
    expect(header).toMatch(/WIRED in 2026-09-09\.69/);
    expect(header).not.toMatch(/NOT WIRED/);
  });
});

describe("the lane is WIRED into index.ts the way the header planned it (2026-09-09.69)", () => {
  // Comment-stripped with the `://`-safe stripper, so prose about a site is
  // never mistaken for the site.
  const IDX = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8")
    .replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");

  it("imports the module and never re-implements it", () => {
    expect(IDX).toMatch(/import \{ STALE_LANE_MIN_AGE_H, STALE_PER_SLICE, bumpStaleTries, classifyStale, countByClass, readStaleTries, selectStaleLane, tokensOf, writeStaleTries, type StaleClass, type StaleRow, type StaleVerdict \} from "\.\/stale-lane\.ts";/);
    expect(IDX, "the class ladder lives in stale-lane.ts only").not.toMatch(/"prototype_name"\s*:/);
  });

  it("cold slices only, on the retry lane's shed ladder, one step smaller (3 -> 1 -> 0)", () => {
    expect(IDX).toMatch(/const effStalePerSlice = shedLevel === 2 \? 0 : shedLevel === 1 \? 1 : STALE_PER_SLICE;/);
    expect(IDX).toMatch(/if \(!inHotPhase && effStalePerSlice > 0\) \{/);
    // The same try/catch shape as the retry lane: an accelerator, never a failed slice.
    const lane = IDX.slice(IDX.indexOf("let staleBoards: JobSource[] = [];"), IDX.indexOf("const slice = [...demandBoards"));
    expect(lane).toMatch(/\} catch \(e\) \{/);
    expect(lane).toMatch(/staleBoards = \[\];/);
    // And the throughput constant it is sized by is the module's, not a copy.
    expect(IDX).not.toMatch(/const STALE_PER_SLICE\b/);
  });

  it("reads the tail once per hop through get_stalest_boards, bounded, and an absent RPC is a warning, never a throw", () => {
    expect(IDX).toMatch(/client\.rpc\("get_stalest_boards", \{ p_limit: STALE_RPC_LIMIT, p_min_age_hours: STALE_LANE_MIN_AGE_H \}\)/);
    expect(IDX).toMatch(/withDeadline\(\s*client\.rpc\("get_stalest_boards"/);
    expect(IDX).toMatch(/const STALE_RPC_DEADLINE_MS = 4_000;/);      // under the RPC's own 5s statement_timeout
    // 60, not 20: the head of the oldest-first list is where permanent
    // residents live (oversize boards never stamp; unresolved tokens stay),
    // and at 20 the window clogged silently. Still under the RPC's 200 cap.
    expect(IDX).toMatch(/const STALE_RPC_LIMIT = 60;/);
    // PostgREST answers a missing function as an error OBJECT, not a rejection: read it as "no lane this hop".
    expect(IDX).toMatch(/const rows = !rpcErr && Array\.isArray\(rpc\.data\) \? \(rpc\.data as StaleRow\[\]\) : null;/);
    expect(IDX).toMatch(/console\.warn\(`\[JOB-BOARD\] stale lane: get_stalest_boards unavailable — no lane this hop \(\$\{why\}\)`\);/);
    expect(IDX).toMatch(/rpc: rpcErr \? "error" : "timeout"/);
    expect((IDX.match(/rpc\("get_stalest_boards"/g) ?? []).length, "one call site").toBe(1);
    // Cancelled at the deadline, never abandoned unread; a REJECTED request
    // (network/TLS/abort) is mapped to an error object BEFORE withDeadline, so
    // it publishes as rpc:"error" with its cause rather than as "timeout".
    expect(IDX).toMatch(/\.abortSignal\(AbortSignal\.timeout\(STALE_RPC_DEADLINE_MS \+ 500\)\)/);
    expect(IDX).toMatch(/\.then\(\(r\) => r, \(e: unknown\) => \(\{ data: null, error: \{ code: "rejected", message: String\(e\)\.slice\(0, 160\) \} \}\)\)/);
  });

  it("names the clogged window: a full window with nothing fetchable in it is windowFull, on the meta row and on status", () => {
    expect(IDX).toMatch(/windowFull: rows\.length >= STALE_RPC_LIMIT && classes\.unexplained === 0 && staleBoards\.length === 0,/);
    expect(IDX).toMatch(/rpc: rpcErr \? "error" : "timeout", asked: 0, windowFull: false,/);
    expect(IDX).toMatch(/windowFull: boolean;/);
  });

  it("builds the context from Sets and Maps the hop already holds — never a token-keyed Record", () => {
    expect(IDX).toMatch(/const CATALOGUE_TOKENS: ReadonlySet<string> = new Set\(JOB_SOURCES\.map\(\(s\) => s\.token\)\);/);
    expect(IDX).toMatch(/catalogued: CATALOGUE_TOKENS,/);
    expect(IDX).toMatch(/quarantinedVendors,\s*oversize: new Set\(OVERSIZE_BOARDS\.keys\(\)\),/);
    expect(IDX).toMatch(/dormant: tokensOf\(boardFailures\.dormant\),/);
    expect(IDX).toMatch(/failing: new Set\(\[\.\.\.tokensOf\(boardFailures\.failedAt\), \.\.\.tokensOf\(boardFailures\.streaks\)\]\),/);
    expect(IDX).toMatch(/tries: staleTries,/);
    expect(IDX).toMatch(/staleTries = readStaleTries\(slMeta\?\.v\);/);
    // The quarantine set is read BEFORE the slice is sealed, or the context is empty by construction.
    expect(IDX.indexOf('eq("k", "vendor_breaker")')).toBeLessThan(IDX.indexOf("const slice = [...demandBoards"));
    expect(IDX.indexOf('eq("k", "stale_lane")')).toBeLessThan(IDX.indexOf("const slice = [...demandBoards"));
  });

  it("takes up to STALE_PER_SLICE 'unexplained' tokens not already in the slice, through the ordinary fetch path", () => {
    expect(IDX).toMatch(/const taken = new Set\(\[\.\.\.baseSlice, \.\.\.demandBoards, \.\.\.bootstrapBoards, \.\.\.retryBoards, \.\.\.deepBoards\]\.map\(\(s\) => s\.token\)\);\s*staleBoards = selectStaleLane\(verdicts, \{ perSlice: effStalePerSlice, exclude: taken \}\)/);
    // Appended to the composed slice ahead of the base rotation, behind retry — the ordinary loop fetches it.
    expect(IDX).toMatch(/const slice = \[\.\.\.demandBoards, \.\.\.bootstrapBoards, \.\.\.retryBoards, \.\.\.staleBoards, \.\.\.baseSlice, \.\.\.deepBoards\];/);
    // No second fetch path, no second budget: the lane has no fetchBoard call of its own.
    const lane = IDX.slice(IDX.indexOf("let staleBoards: JobSource[] = [];"), IDX.indexOf("const slice = [...demandBoards"));
    expect(lane).not.toMatch(/fetchBoard\(/);
    expect(lane).not.toMatch(/SLICE_POSTING_BUDGET|inFlightReserve/);
  });

  it("folds tries at hop end: a stamped board leaves the map, an attempted one counts, a budget-deferred one is untouched", () => {
    expect(IDX).toMatch(/const attempted = staleBoards\.map\(\(s\) => s\.token\)\.filter\(\(tk\) => !budgetSkippedSet\.has\(tk\)\);/);
    expect(IDX).toMatch(/const resolved = attempted\.filter\(\(tk\) => okSet\.has\(tk\)\)\.length;/);
    expect(IDX).toMatch(/const nextTries = bumpStaleTries\(staleTries, attempted, okSet\);/);
    expect(IDX).toMatch(/\{ k: "stale_lane", v: \{ \.\.\.staleLane, tries: writeStaleTries\(nextTries\) \}, updated_at: new Date\(\)\.toISOString\(\) \}/);
    expect((IDX.match(/k: "stale_lane"/g) ?? []).length, "one writer, one key").toBe(1);
    // staleTries ride slice_stats beside the budget note.
    expect(IDX).toMatch(/\.\.\.\(sliceStaleNote \? \{ staleTries: sliceStaleNote\.tries, staleResolved: sliceStaleNote\.resolved \} : \{\}\),/);
    expect(IDX).toMatch(/sliceStaleNote = \{ tries: attempted\.length, resolved \};/);
  });

  it("status publishes staleLane: asked, classes, fetched, resolved, and the two classes no fetch can fix", () => {
    expect(IDX).toMatch(/staleLane: \(\(\) => \{/);
    const block = IDX.slice(IDX.indexOf("staleLane: (() => {"), IDX.indexOf("chainWatchdog,", IDX.indexOf("staleLane: (() => {")));
    for (const f of ["asked:", "windowFull:", "classes:", "fetched:", "resolved:", "unresolved:", "prototypeNames:", "triesPending:", "rpc:", "lastSlice:"]) {
      expect(block, `status.staleLane is missing ${f}`).toContain(f);
    }
    // APPENDED to the status read, never inserted (the positional-destructure rule).
    const at = IDX.indexOf("hwMeta, deepCur, chainKick, sliceStatsRow, descCov, traceRow");
    expect(at).toBeGreaterThan(-1);
    const arr = IDX.slice(at);
    expect(arr.indexOf('eq("k", "stale_lane")')).toBeGreaterThan(arr.indexOf('eq("k", "oracle_subsite_repair")'));
  });
});

describe("20260909218000 — get_stalest_boards and its index", () => {
  it("exists and sorts after the newest applied migration this lane built on", () => {
    expect(MIG_FILE, "the migration is missing").toBeTruthy();
    expect(STAMP > "20260909214000").toBe(true);
  });

  it("defines exactly ONE function — the OUT-param guard slices a file from first $$ to last", () => {
    const defs = SQL.match(/CREATE (?:OR REPLACE )?FUNCTION\s+public\.\w+/g) ?? [];
    expect(defs).toEqual(["CREATE OR REPLACE FUNCTION public.get_stalest_boards"]);
  });

  it("returns seven DISTINCT names, none a column of either table it touches", () => {
    const outs = /RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE/.exec(SQL)?.[1] ?? "";
    const names = outs.split("\n").map((l) => l.trim().split(/\s+/)[0]?.replace(/,$/, "")).filter(Boolean);
    expect(names).toEqual(["stale_token", "stale_vendor", "stamped_at", "age_min", "posting_rows", "live_rows", "newest_effective"]);
    expect(new Set(names).size).toBe(7);
    const verifications = ["company_token", "verified_at", "feed_total"];
    const postings = ["id", "source", "company_token", "company", "title", "location", "remote", "department", "category",
      "posted_at", "apply_url", "first_seen", "last_seen", "country", "description", "missing_since", "salary",
      "salary_min_annual", "salary_max_annual", "salary_rank_usd", "lap_epoch", "effective_posted", "work_mode",
      "employment_type", "title_tsv", "search_tsv"];
    for (const n of names) {
      expect(verifications.includes(n), `${n} collides with job_board_verifications`).toBe(false);
      expect(postings.includes(n), `${n} collides with job_board_postings`).toBe(false);
    }
    // And the body never refers to an OUT name bare (the 42702 shape), even though none collides.
    for (const n of names) {
      expect(BODY).not.toMatch(new RegExp(`(?<![\\w.])${n}(?![\\w])`));
    }
  });

  it("aliases every table it selects from and qualifies every column", () => {
    const unaliased: string[] = [];
    for (const m of BODY.matchAll(/FROM\s+public\.(\w+)\s*(\w*)/g)) {
      if (!m[2] || /^(WHERE|ORDER|LIMIT|GROUP|ON|AND|INTO)$/i.test(m[2])) unaliased.push(m[1]);
    }
    expect(unaliased).toEqual([]);
    expect(BODY).toMatch(/ver\.verified_at/);
    expect(BODY).toMatch(/p\.company_token = o\.tok/);
    expect(BODY).toMatch(/p\.missing_since IS NULL/);
    expect(BODY).toMatch(/max\(p\.effective_posted\)/);
    expect(BODY).not.toMatch(/(?<![\w.])(verified_at|company_token|missing_since|effective_posted)\b/);
  });

  it("is DEFINER because the postings side is closed to anon — and says so from the catalog", () => {
    // The reason lives in the tree: 20260827130000 revoked anon's SELECT.
    const lockdown = readFileSync(resolve(MIG_DIR, "20260827130000_the_key_wall_had_a_door_beside_it.sql"), "utf8");
    expect(lockdown).toMatch(/REVOKE SELECT ON public\.job_board_postings FROM anon, authenticated;/);
    const head = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION"), SQL.indexOf("AS $$"));
    expect(head).toMatch(/SECURITY DEFINER/);
    expect(head).toMatch(/SET search_path = public, pg_temp/);
    expect(head).toMatch(/SET statement_timeout = '5s'/);
    expect(head).toMatch(/\bSTABLE\b/);
    expect(head).toMatch(/LANGUAGE plpgsql/);
    // Verified from pg_proc at apply time, not assumed.
    expect(SQL).toMatch(/pr\.prosecdef/);
    expect(SQL).toMatch(/search_path=public, pg_temp/);
  });

  it("revokes from PUBLIC AND anon by name, then grants deliberately", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.get_stalest_boards\(integer, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_stalest_boards\(integer, integer\) TO anon, authenticated, service_role;/);
  });

  it("orders by verified_at BEFORE any limit, so row one is the rollup's max by construction", () => {
    expect(BODY).toMatch(/ORDER BY ver\.verified_at ASC\s+LIMIT c_scan_cap/);
    expect(BODY).toMatch(/ORDER BY o\.stamp_at ASC\s+LIMIT v_limit/);
    expect(BODY).toMatch(/ORDER BY h\.stamp_at ASC;/);
    // The rollup's own predicate: EXISTS postings, no missing_since filter on it.
    const held = BODY.slice(BODY.indexOf("held AS ("), BODY.indexOf("SELECT\n    h.tok"));
    expect(held).toMatch(/EXISTS \(\s*SELECT 1 FROM public\.job_board_postings p\s+WHERE p\.company_token = o\.tok\s*\)/);
    expect(held).not.toMatch(/missing_since/);
    // Stated as the self-check in prose, naming max_min.
    expect(RAW).toMatch(/first\.age_min == freshness\.max_min/);
  });

  it("caps the inner scan at a NAMED constant and clamps both parameters", () => {
    expect(BODY).toMatch(/c_scan_cap constant integer := 2000;/);
    expect(BODY).toMatch(/LIMIT c_scan_cap/);
    expect(BODY).not.toMatch(/LIMIT \d/); // no bare numeric limit anywhere
    expect(BODY).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 20\), 1\), 200\)/);
    expect(BODY).toMatch(/GREATEST\(COALESCE\(p_min_age_hours, 72\), 0\)/);
    expect(SQL).toMatch(/p_min_age_hours integer DEFAULT 72/);
    expect(SQL).toMatch(/p_limit integer DEFAULT 20/);
  });

  it("builds the verified_at index with a lock timeout, and holds the lock for nothing else", () => {
    expect(SQL).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS job_board_verifications_verified_at_idx\s+ON public\.job_board_verifications \(verified_at ASC, company_token\);/);
    // The 20260909211000 lesson: no seed, no measurement, no DML in the same transaction.
    expect(SQL).not.toMatch(/\bPERFORM\b/);
    expect(SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(SQL).toMatch(/NOTIFY pgrst, 'reload schema';/);
  });

  it("names its date basis and population for every number it quotes", () => {
    expect(PROSE).toMatch(/2026-09-10 02:45 UTC/);
    expect(PROSE).toMatch(/population = every verification stamp whose token still holds at least one posting/);
    expect(PROSE).toMatch(/max_min 20,961\.0/);
    expect(PROSE).toMatch(/boards 33,574/);
  });
});
