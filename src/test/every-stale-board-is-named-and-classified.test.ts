import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROTOTYPE_NAMES,
  STALE_EXCLUDE_MAX,
  STALE_LANE_MIN_AGE_H,
  STALE_PER_SLICE,
  STALE_TRIES_MAX,
  bumpStaleTries,
  classifyStale,
  countByClass,
  isPrototypeName,
  readStaleTries,
  selectStaleLane,
  staleExclusion,
  tokensOf,
  unresolvedTokens,
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

  it("a token the ROTATION stamped leaves the map too, even at STALE_TRIES_MAX — an excluded board that recovers is not hidden for good", () => {
    // Since .71 'beta' (at the max) is sent as p_exclude: the lane never sees
    // it in a window or fetches it again, so a stamp from another lane is the
    // only thing that can ever clear its entry. okSet at the fold is every
    // stamp the slice landed, and the fold must use it for every entry.
    const before = new Map([["alpha", 1], ["beta", STALE_TRIES_MAX]]);
    const after = bumpStaleTries(before, [], new Set(["beta", "unrelated"]));
    expect([...after]).toEqual([["alpha", 1]]);
    expect([...before]).toEqual([["alpha", 1], ["beta", STALE_TRIES_MAX]]); // pure
    // The same hop can fetch something else and still forget the recovered board.
    const mixed = bumpStaleTries(before, ["gamma"], new Set(["beta"]));
    expect([...mixed]).toEqual([["alpha", 1], ["gamma", 1]]);
    // A stamp for a token with no entry is a no-op, not an insertion.
    expect(bumpStaleTries(new Map(), [], new Set(["beta"])).size).toBe(0);
  });

  it("unresolvedTokens names every entry at or past the max, in map order, and staleExclusion excludes exactly those", () => {
    const tries = new Map([["alpha", 1], ["beta", STALE_TRIES_MAX], ["gamma", STALE_TRIES_MAX + 2], ["delta", STALE_TRIES_MAX - 1]]);
    expect(unresolvedTokens(tries)).toEqual(["beta", "gamma"]);
    expect(unresolvedTokens(tries, 1)).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(unresolvedTokens(new Map())).toEqual([]);
    const ex = staleExclusion({ oversize: [], tries });
    expect(ex.filter((t) => tries.has(t))).toEqual(["beta", "gamma"]);
    expect([...tries.keys()]).toEqual(["alpha", "beta", "gamma", "delta"]); // pure
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
    // The excluded unresolved tokens are named from the tries map, not the window.
    expect(header).toMatch(/excludedUnresolved: unresolvedTokens\(tries\)/);
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
    expect(IDX).toMatch(/import \{ STALE_LANE_MIN_AGE_H, STALE_PER_SLICE, bumpStaleTries, classifyStale, countByClass, readStaleTries, selectStaleLane, staleExclusion, tokensOf, unresolvedTokens, writeStaleTries, type StaleClass, type StaleRow, type StaleVerdict \} from "\.\/stale-lane\.ts";/);
    // The exclusion set is the module's, not a copy: no second Object.prototype enumeration, no second cap.
    expect(IDX).not.toMatch(/getOwnPropertyNames\(Object\.prototype\)/);
    expect(IDX).not.toMatch(/const STALE_EXCLUDE_MAX\b/);
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
    // .71: the third argument is p_exclude, present on the ordinary ask and
    // absent on the one-shot PGRST202 fallback — the same call site serves both.
    expect(IDX).toMatch(/client\.rpc\("get_stalest_boards", \{ p_limit: STALE_RPC_LIMIT, p_min_age_hours: STALE_LANE_MIN_AGE_H, \.\.\.\(exclude \? \{ p_exclude: exclude \} : \{\}\) \}\)/);
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
    expect(IDX).toMatch(/rpc: rpcErr \? "error" : "timeout", asked: 0, windowFull: false, excluded: 0,/);
    expect(IDX).toMatch(/windowFull: boolean;/);
  });

  // ── .71: THE STALE WINDOW FILLS WITH WHAT IT CANNOT FIX ──────────────────
  // Live, first pass after .70: asked 60, oversize 59, prototype_name 1,
  // unexplained 0, windowFull, fetched 0 — every pass, forever. The lane now
  // tells the RPC what it already knows cannot be fetched.
  it("passes p_exclude = staleExclusion(oversize ∪ unresolved ∪ prototype names) built from the Map and the tries Map", () => {
    expect(IDX).toMatch(/const staleExclude = staleExclusion\(\{ oversize: OVERSIZE_BOARDS\.keys\(\), tries: staleTries \}\);/);
    expect(IDX).toMatch(/let rpc = await askStale\(staleExclude\);/);
    expect(IDX).toMatch(/let excluded = staleExclude\.length;/);
    // The tries map is read BEFORE the exclusion is built (unresolved comes from it).
    const lane = IDX.slice(IDX.indexOf("let staleBoards: JobSource[] = [];"), IDX.indexOf("const slice = [...demandBoards"));
    expect(lane.indexOf("staleTries = readStaleTries(slMeta?.v);")).toBeLessThan(lane.indexOf("const staleExclude = staleExclusion("));
    // Nothing else is excluded here: the ladder of what a fetch can fix is the module's.
    expect(lane).not.toMatch(/staleExclusion\(\{[^}]*(dormant|failing|quarantined|catalogued)/);
  });

  it("a PGRST202 (the RPC predates the p_exclude arm) falls back ONCE to the unexcluded ask, through the same call site, and says so", () => {
    expect(IDX).toMatch(/if \(rpcErr\?\.code === "PGRST202"\) \{/);
    expect(IDX).toMatch(/rpc = await askStale\(null\);\s*excluded = 0;\s*rpcErr = errOf\(rpc\);/);
    expect(IDX).toMatch(/has no p_exclude arm yet \(apply migration 20260909222000\)/);
    expect((IDX.match(/await askStale\(/g) ?? []).length, "exactly two asks: the excluded one and its fallback").toBe(2);
  });

  it("the durable record: `excluded` rides the meta row and status, and a window STILL full after exclusion is a warn line", () => {
    expect(IDX).toMatch(/excluded: number;/);
    const ok = IDX.slice(IDX.indexOf("asked: rows.length,"), IDX.indexOf("} catch (e) {", IDX.indexOf("asked: rows.length,")));
    expect(ok).toMatch(/windowFull: rows\.length >= STALE_RPC_LIMIT[^\n]*\n\s*excluded,/);
    expect(ok).toMatch(/if \(staleLane\.windowFull\) \{/);
    expect(ok).toMatch(/console\.warn\(`\[JOB-BOARD\] stale lane: window STILL full after excluding \$\{excluded\} tokens — \$\{rows\.length\} rows, none fetchable \(\$\{filled\}\); the tail behind row \$\{STALE_RPC_LIMIT\} is unexamined`\);/);
    expect(IDX).toMatch(/excluded: typeof v\.excluded === "number" \? v\.excluded : null,/);
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
    // okSet is EVERY stamp the slice landed, so the fold forgets a recovered
    // board the rotation stamped, not only one this lane fetched — the only
    // way an entry at STALE_TRIES_MAX (excluded from the window) can clear.
    expect(IDX).toMatch(/const okSet = new Set\(okTokens\);/);
    expect(IDX).not.toMatch(/bumpStaleTries\(staleTries, attempted, new Set\(/);
    expect(IDX).toMatch(/\{ k: "stale_lane", v: \{ \.\.\.staleLane, tries: writeStaleTries\(nextTries\) \}, updated_at: new Date\(\)\.toISOString\(\) \}/);
    expect((IDX.match(/k: "stale_lane"/g) ?? []).length, "one writer, one key").toBe(1);
    // staleTries ride slice_stats beside the budget note.
    expect(IDX).toMatch(/\.\.\.\(sliceStaleNote \? \{ staleTries: sliceStaleNote\.tries, staleResolved: sliceStaleNote\.resolved \} : \{\}\),/);
    expect(IDX).toMatch(/sliceStaleNote = \{ tries: attempted\.length, resolved \};/);
  });

  it("status publishes staleLane: asked, classes, fetched, resolved, and the two classes no fetch can fix", () => {
    expect(IDX).toMatch(/staleLane: \(\(\) => \{/);
    const block = IDX.slice(IDX.indexOf("staleLane: (() => {"), IDX.indexOf("chainWatchdog,", IDX.indexOf("staleLane: (() => {")));
    for (const f of ["asked:", "windowFull:", "excluded:", "classes:", "fetched:", "resolved:", "unresolved:", "prototypeNames:", "excludedUnresolved:", "triesPending:", "rpc:", "lastSlice:"]) {
      expect(block, `status.staleLane is missing ${f}`).toContain(f);
    }
    // The tokens p_exclude hides are named from the tries the fold wrote — the
    // window's 'unresolved' verdicts read [] once the exclusion works, and a
    // count (triesPending) does not say which boards to look at.
    expect(block).toMatch(/excludedUnresolved: unresolvedTokens\(readStaleTries\(v\)\),/);
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

// ── .71: THE STALE WINDOW FILLS WITH WHAT IT CANNOT FIX ──────────────────────
//
// Live, the first pass after .70 deployed (status.staleLane): rpc ok, asked 60,
// windowFull true, classes { oversize 59, prototype_name 1, everything else 0 },
// selected [], fetched 0. Sixty rows, sixty permanent residents, and 145
// boards in the OVERSIZE registry behind them — no window is wide enough.
// So the lane hands the RPC what it already knows cannot be fetched.

describe("staleExclusion — what the lane tells the RPC to leave out", () => {
  it("is prototype names first, then oversize, then the unresolved — deduplicated, in that order", () => {
    const ex = staleExclusion({
      oversize: new Set(["cgsfederal", "gopuff", "constructor"]),
      tries: new Map([["applied", STALE_TRIES_MAX], ["gopuff", STALE_TRIES_MAX + 2], ["feverup", STALE_TRIES_MAX - 1]]),
    });
    expect(ex.slice(0, PROTOTYPE_NAMES.length)).toEqual([...PROTOTYPE_NAMES]);
    expect(ex.slice(PROTOTYPE_NAMES.length)).toEqual(["cgsfederal", "gopuff", "applied"]);
    expect(new Set(ex).size).toBe(ex.length);
    expect(ex).not.toContain("feverup"); // one try short of unresolved: still the lane's candidate
  });

  it("names every Object.prototype property even with nothing else to exclude — 'constructor' can never occupy the window", () => {
    const ex = staleExclusion({ oversize: [], tries: new Map() });
    expect(ex).toEqual([...PROTOTYPE_NAMES]);
    for (const t of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) expect(ex).toContain(t);
    for (const t of PROTOTYPE_NAMES) expect(isPrototypeName(t), t).toBe(true);
    expect(PROTOTYPE_NAMES.length).toBeGreaterThanOrEqual(12);
  });

  it("accepts a Map's keys() iterator (the call site's shape) and skips empty or non-string entries", () => {
    const m = new Map<string, unknown>([["alpha", 1], ["", 2]]);
    const ex = staleExclusion({ oversize: m.keys(), tries: new Map() });
    expect(ex).toContain("alpha");
    expect(ex).not.toContain("");
  });

  it("is bounded at STALE_EXCLUDE_MAX, cutting the youngest unresolved first, and the bound fits a POST body", () => {
    const many = new Map<string, number>();
    for (let i = 0; i < 1000; i++) many.set(`u${i}`, STALE_TRIES_MAX);
    const oversize = Array.from({ length: 200 }, (_, i) => `o${i}`);
    const ex = staleExclusion({ oversize, tries: many });
    expect(ex.length).toBe(STALE_EXCLUDE_MAX);
    expect(ex.slice(0, PROTOTYPE_NAMES.length)).toEqual([...PROTOTYPE_NAMES]);      // never cut
    expect(ex.slice(PROTOTYPE_NAMES.length, PROTOTYPE_NAMES.length + 200)).toEqual(oversize); // never cut
    expect(ex.at(-1)).toBe(`u${STALE_EXCLUDE_MAX - PROTOTYPE_NAMES.length - 200 - 1}`);
    expect(staleExclusion({ oversize, tries: many }, 5)).toEqual(PROTOTYPE_NAMES.slice(0, 5));
    expect(staleExclusion({ oversize, tries: many }, -1)).toEqual([]);
    // The bound: 12 prototype names + OVERSIZE_CAP (200) + 188 unresolved.
    expect(STALE_EXCLUDE_MAX).toBe(400);
    const idx = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
    expect(idx).toMatch(/const OVERSIZE_CAP = 200;/);
    expect(STALE_EXCLUDE_MAX).toBeGreaterThanOrEqual(PROTOTYPE_NAMES.length + 200);
    // Measured against the catalogue, not asserted: the longest token quoted
    // 400 times is well under 30 KB — and a fifth of the RPC's own 2,000 cap.
    const longest = Math.max(...JOB_SOURCES.map((s) => s.token.length));
    expect(STALE_EXCLUDE_MAX * (longest + 3)).toBeLessThan(30_000);
  });

  it("the live window, excluded: the 59 oversize boards and 'constructor' leave, and the four unexplained are what the RPC would return", () => {
    const OVERSIZE_LIVE = new Set(["cgsfederal", "cscgeneration-2", "paytmpayments", "gopuff", "trilongroup", "gorh", "aaff"]);
    const ex = new Set(staleExclusion({ oversize: OVERSIZE_LIVE, tries: new Map() }));
    const survivors = LIVE_STAMPS.map(([t]) => t).filter((t) => !ex.has(t));
    expect(survivors).toEqual(["applied", "duravermeer", "aloyoga", "feverup"]);
    // And on those survivors the classifier finds only candidates: the window is no longer clogged.
    const verdicts = classifyStale(survivors.map((t) => row(t)), ctx({ catalogued: CATALOGUE, oversize: OVERSIZE_LIVE }));
    expect(countByClass(verdicts).unexplained).toBe(4);
    expect(selectStaleLane(verdicts, { perSlice: STALE_PER_SLICE, exclude: new Set() }).length).toBe(3);
  });

  it("is pure and uses only Sets, Maps and iterables — never a token-keyed Record", () => {
    const src = readFileSync(resolve(ROOT, "supabase/functions/job-board/stale-lane.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function staleExclusion("), src.indexOf("export function classifyStale("));
    expect(fn).not.toMatch(/Record<string/);
    expect(fn).not.toMatch(/\[\s*t\s*\]/); // no bracket read by token
    const tries = new Map([["a", STALE_TRIES_MAX]]);
    const over = new Set(["b"]);
    const a = staleExclusion({ oversize: over, tries });
    const b = staleExclusion({ oversize: over, tries });
    expect(a).toEqual(b);
    expect([...tries]).toEqual([["a", STALE_TRIES_MAX]]);
    expect([...over]).toEqual(["b"]);
  });
});

describe("20260909222000 — get_stalest_boards takes p_exclude, inside the capped scan", () => {
  const STAMP2 = "20260909222000";
  const FILE2 = readdirSync(MIG_DIR).find((f) => f.startsWith(STAMP2));
  const RAW2 = FILE2 ? readFileSync(resolve(MIG_DIR, FILE2), "utf8") : "";
  const SQL2 = RAW2.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const BODY2_AT = SQL2.indexOf("AS $$");
  const BODY2 = SQL2.slice(BODY2_AT, SQL2.indexOf("$$;", BODY2_AT + 5));
  const PROSE2 = RAW2.replace(/\n--[ \t]*/g, " ");

  it("exists, is the NEWEST migration defining get_stalest_boards (the OUT-param guard slices the newest), and defines exactly ONE function", () => {
    expect(FILE2, "the migration is missing").toBeTruthy();
    const defining = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /FUNCTION public\.get_stalest_boards\s*\(/.test(readFileSync(resolve(MIG_DIR, f), "utf8")));
    expect(defining.at(-1)).toBe(FILE2);
    const defs = SQL2.match(/CREATE (?:OR REPLACE )?FUNCTION\s+public\.\w+/g) ?? [];
    expect(defs).toEqual(["CREATE OR REPLACE FUNCTION public.get_stalest_boards"]);
  });

  it("adds p_exclude text[] DEFAULT '{}' as the THIRD parameter and keeps the first two, defaults included", () => {
    const head = SQL2.slice(SQL2.indexOf("CREATE OR REPLACE FUNCTION"), SQL2.indexOf("RETURNS TABLE"));
    expect(head).toMatch(/p_limit integer DEFAULT 20,\s*p_min_age_hours integer DEFAULT 72,\s*p_exclude text\[\] DEFAULT '\{\}'\s*\)/);
  });

  it("DROPS the (integer, integer) signature BEFORE creating the new one — an overload would be PGRST203 for the .70 bundle's two-argument call", () => {
    const dropAt = SQL2.indexOf("DROP FUNCTION IF EXISTS public.get_stalest_boards(integer, integer);");
    expect(dropAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(SQL2.indexOf("CREATE OR REPLACE FUNCTION public.get_stalest_boards"));
    // And the catalog self-check refuses a second signature at apply time.
    expect(SQL2).toMatch(/IF v_count <> 1 THEN\s*RAISE EXCEPTION 'get_stalest_boards has % signatures in pg_proc/);
    expect(SQL2).toMatch(/pg_get_function_identity_arguments\(pr\.oid\)/);
    expect(SQL2).toMatch(/'p_limit integer, p_min_age_hours integer, p_exclude text\[\]'/);
  });

  it("keeps every OUT name, in order, and never refers to one bare", () => {
    const outs = /RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE/.exec(SQL2)?.[1] ?? "";
    const names = outs.split("\n").map((l) => l.trim().split(/\s+/)[0]?.replace(/,$/, "")).filter(Boolean);
    expect(names).toEqual(["stale_token", "stale_vendor", "stamped_at", "age_min", "posting_rows", "live_rows", "newest_effective"]);
    for (const n of names) expect(BODY2).not.toMatch(new RegExp(`(?<![\\w.])${n}(?![\\w])`));
    // The plpgsql variables introduced here collide with no column of either table.
    for (const v of ["v_exclude", "c_exclude_cap"]) expect(BODY2).toMatch(new RegExp(`\\b${v}\\b`));
  });

  it("the p_exclude arm sits INSIDE the capped inner scan — evaluated per index tuple before LIMIT c_scan_cap, never as a post-filter", () => {
    const oldest = BODY2.slice(BODY2.indexOf("WITH oldest AS ("), BODY2.indexOf("held AS ("));
    expect(oldest).toMatch(/WHERE ver\.verified_at < now\(\) - v_min_age\s+AND NOT \(ver\.company_token = ANY\(v_exclude\)\)\s+ORDER BY ver\.verified_at ASC\s+LIMIT c_scan_cap/);
    const rest = BODY2.slice(BODY2.indexOf("held AS ("));
    expect(rest, "no exclusion after the cap").not.toMatch(/v_exclude|p_exclude/);
    // The cap itself is unchanged, named, and the only LIMITs are named.
    expect(BODY2).toMatch(/c_scan_cap\s+constant integer := 2000;/);
    expect(BODY2).not.toMatch(/LIMIT \d/);
    expect(BODY2).toMatch(/ORDER BY o\.stamp_at ASC\s+LIMIT v_limit/);
  });

  it("a NULL array reads as empty, NULL elements are removed (one would drop every row), and the array is capped at a named constant", () => {
    expect(BODY2).toMatch(/c_exclude_cap constant integer := 2000;/);
    expect(BODY2).toMatch(/v_exclude\s+text\[\]\s+:= \(array_remove\(COALESCE\(p_exclude, '\{\}'::text\[\]\), NULL\)\)\[1:c_exclude_cap\];/);
    // The prose states what happens past the cap: degradation to the pre-fix window, never an error.
    expect(PROSE2).toMatch(/WHEN THE EXCLUSION LIST EXCEEDS THE CAP/);
    expect(PROSE2).toMatch(/c_scan_cap bounds SURVIVING stamps, not examined ones/);
  });

  it("the population predicate and ordering are untouched: with an empty exclusion, row one is still the rollup's max", () => {
    const held = BODY2.slice(BODY2.indexOf("held AS ("), BODY2.indexOf("SELECT\n    h.tok"));
    expect(held).toMatch(/EXISTS \(\s*SELECT 1 FROM public\.job_board_postings p\s+WHERE p\.company_token = o\.tok\s*\)/);
    expect(held).not.toMatch(/missing_since/);
    expect(BODY2).toMatch(/ORDER BY h\.stamp_at ASC;/);
    expect(BODY2).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 20\), 1\), 200\)/);
    expect(BODY2).toMatch(/GREATEST\(COALESCE\(p_min_age_hours, 72\), 0\)/);
    expect(BODY2).toMatch(/count\(\*\) FILTER \(WHERE p\.missing_since IS NULL\)/);
  });

  it("stays DEFINER with search_path pinned and the 5s timeout, revokes from PUBLIC AND anon by name on the NEW signature, then grants", () => {
    const head = SQL2.slice(SQL2.indexOf("CREATE OR REPLACE FUNCTION"), SQL2.indexOf("AS $$"));
    expect(head).toMatch(/SECURITY DEFINER/);
    expect(head).toMatch(/SET search_path = public, pg_temp/);
    expect(head).toMatch(/SET statement_timeout = '5s'/);
    expect(head).toMatch(/\bSTABLE\b/);
    expect(SQL2).toMatch(/REVOKE ALL ON FUNCTION public\.get_stalest_boards\(integer, integer, text\[\]\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL2).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_stalest_boards\(integer, integer, text\[\]\) TO anon, authenticated, service_role;/);
    expect(SQL2).toMatch(/COMMENT ON FUNCTION public\.get_stalest_boards\(integer, integer, text\[\]\)/);
    expect(SQL2).not.toMatch(/get_stalest_boards\(integer, integer\)\s+(TO|FROM)/); // no grant on the dropped shape
    expect(SQL2).toMatch(/pr\.prosecdef/);
    expect(SQL2).toMatch(/NOTIFY pgrst, 'reload schema';/);
  });

  it("reuses the index and touches no data: no CREATE INDEX, no DML, no PERFORM", () => {
    expect(SQL2).not.toMatch(/CREATE INDEX/);
    expect(SQL2).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(SQL2).not.toMatch(/\bPERFORM\b/);
    expect(SQL2).toMatch(/job_board_verifications_verified_at_idx/); // asserted present, not rebuilt
  });

  it("names the live numbers it answers and the harness that proves the placement", () => {
    expect(PROSE2).toMatch(/asked: 60, windowFull: true/);
    expect(PROSE2).toMatch(/oversize: 59, prototype_name: 1/);
    expect(PROSE2).toMatch(/scripts\/verify-migration-20260909222000\.mjs/);
    expect(readdirSync(resolve(ROOT, "scripts"))).toContain("verify-migration-20260909222000.mjs");
  });
});
