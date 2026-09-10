import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyDormancy, selectRetries, updateBoardFailures } from "../../supabase/functions/job-board/dormancy.ts";
import { tokenMapFromRecord, tokenMapToRecord } from "../../supabase/functions/job-board/token-map.ts";

/**
 * A TOKEN NAMED 'constructor' READS A FUNCTION FROM THE MAP.
 *
 * Found 2026-09-10 while naming the freshness tail: the oldest verification
 * stamp in production (14.6 days) belongs to the token 'constructor' — a real,
 * catalogued ashby board ("Constructor"). It is stale because it is SKIPPED on
 * every cold slice: index.ts hands the slice's tokens to classifyDormancy with
 * the dormant map, dormancy.ts reads `dormant[t]`, and for this token that is
 * Object.prototype.constructor — a function, not undefined — so `now - since`
 * is NaN, `NaN >= recheckMs` is false, and the board goes into `skip` as
 * "dormant, not due". Every slice, since the skip-list shipped (2026-07-14).
 * Its only stamps come from demand fetches, which bypass the skip-list. Every
 * `Record<string, …>` keyed by token on the fetch path misreads it the same
 * way:
 *
 *   dormant[t]                       -> Object            (skipped as dormant, forever)
 *   params.streaks[token] ?? 1       -> Object, not 1     (NaN backoff, never due)
 *   deepCursors[s.token] ?? 0        -> Object, not 0     (NaN offset)
 *
 * This repo has met Object.prototype three times already; this is the fourth
 * and it is live. The property this guard asserts is structural, not a
 * spelling: on the fetch path, a map keyed by a board token is a Map, or
 * every read of it is guarded by Object.hasOwn.
 *
 * DERIVED, NOT LISTED. The offenders are found by reading the source: every
 * identifier declared `: Record<string, …>` (const, param or field) that is
 * READ by a bracket whose key is a token expression (`t`, `tk`, `tok`,
 * `token`, `x.token`). Writes are not the trap (an own property shadows the
 * inherited one) and are skipped; `delete` is skipped; a read within two
 * lines of `Object.hasOwn(<map>,` is guarded. Comment-stripped first, with
 * the `://`-safe stripper, so prose about the trap is never counted as one.
 *
 * THE WAIVER EXPIRED ITSELF. When this guard was written (HEAD 87351855,
 * 2026-09-09) index.ts and dormancy.ts held five traps, named in KNOWN_TRAPS
 * so the guard could assert the detected set EQUALS it: a new token-keyed
 * Record fails the build, and a trap that gets FIXED also fails it — with the
 * instruction to remove it from the list. 2026-09-09.69 fixed all five
 * (deepCursors is a Map bridged by token-map.ts; openMap's read and every
 * dormancy.ts read are hasOwn-guarded), so the list is EMPTY and the property
 * is now unconditional. The list stays as the mechanism, not as a hole: a
 * future trap must be waived here by name, and a waived trap must be real.
 */
const DIR = resolve(__dirname, "../../supabase/functions/job-board");
const FETCH_PATH = ["index.ts", "dormancy.ts", "stale-lane.ts", "token-map.ts", "chain-watchdog.ts", "rotation.ts", "paging.ts"] as const;

/**
 * Traps waived by name. EMPTY since 2026-09-09.69 — the five present at HEAD
 * 87351855 (index.ts:deepCursors, index.ts:openMap, dormancy.ts:dormant,
 * dormancy.ts:streaks, dormancy.ts:firstFailedAt) were all fixed. Add an entry
 * only for a trap that is live and cannot be fixed in the same change; remove
 * it when the map becomes a Map or its reads are hasOwn-guarded.
 */
const KNOWN_TRAPS = new Set<string>([]);

/** Line comments first (never after `:` or a word char, so URLs survive), then block comments. */
const stripped = (raw: string) => raw.replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
const TOKEN_KEY = /^(?:t|tk|tok|token|\w+\.token)$/;

interface Offender { name: string; key: string; text: string }

/** Every identifier typed `Record<string, …>` — a const, a parameter or an interface field. */
export function recordNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\??\s*:\s*Record<\s*string\s*,/g)) names.add(m[1]);
  return names;
}

/** Bracket READS of a Record<string,…> by a token key, unguarded by Object.hasOwn. */
export function tokenKeyedRecordReads(code: string): Offender[] {
  const names = recordNames(code);
  const lines = code.split("\n");
  const out: Offender[] = [];
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/\b([A-Za-z_$][\w$]*)\[([^\]]+)\]/g)) {
      const [whole, name, key] = m;
      if (!names.has(name) || !TOKEN_KEY.test(key.trim())) continue;
      const after = ln.slice(m.index! + whole.length);
      const before = ln.slice(0, m.index!);
      if (/^\s*=[^=]/.test(after)) continue;     // a write: an own property shadows the prototype
      if (/\bdelete\s+$/.test(before)) continue;  // delete never reads
      const window = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
      // Either spelling of an own-property test guards the read: Object.hasOwn
      // (ES2022; index.ts runs on Deno) or Object.prototype.hasOwnProperty.call
      // (dormancy.ts is also type-checked under the app's ES2020 lib).
      if (new RegExp(`(?:Object\\.hasOwn|Object\\.prototype\\.hasOwnProperty\\.call)\\(\\s*(?:\\w+\\.)?${name}\\s*,`).test(window)) continue;
      out.push({ name, key: key.trim(), text: ln.trim().slice(0, 120) });
    }
  });
  return out;
}

describe("the detector has teeth (pre-fix code is flagged, fixed code is not)", () => {
  // Verbatim shape of index.ts at 4143–4147 and the read at 4530, HEAD 87351855.
  const PRE_FIX = `
  const deepCursors: Record<string, number> = (() => {
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(deepCursorRow)) if (Number.isInteger(n) && (n as number) > 0) out[k] = n as number;
    return out;
  })();
  try { r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors[s.token] ?? 0); }
  `;
  const MAP_FIX = `
  const deepCursors = new Map<string, number>();
  for (const [k, n] of Object.entries(deepCursorRow)) if (Number.isInteger(n) && (n as number) > 0) deepCursors.set(k, n as number);
  try { r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors.get(s.token) ?? 0); }
  `;
  const HASOWN_FIX = `
  const deepCursors: Record<string, number> = {};
  const start = Object.hasOwn(deepCursors, s.token) ? deepCursors[s.token] : 0;
  try { r = await fetchBoard(s, (m) => { failReason = m; }, start); }
  `;
  const WRITE_ONLY = `
  const deepCursors: Record<string, number> = {};
  deepCursors[s.token] = r.nextOffset;
  delete deepCursors[s.token];
  `;
  const PROSE_ONLY = `
  // the old form was deepCursors[s.token] ?? 0 and it read a function for 'constructor'
  /* deepCursors[token] */
  const deepCursors = new Map<string, number>();
  `;

  it("flags the pre-fix deepCursors read, by name and by key", () => {
    const hits = tokenKeyedRecordReads(stripped(PRE_FIX));
    expect(hits.map((h) => `${h.name}[${h.key}]`)).toEqual(["deepCursors[s.token]"]);
  });

  it("passes a Map, a hasOwn-guarded read, a write-only map, and prose about the trap", () => {
    for (const [label, src] of [["Map", MAP_FIX], ["hasOwn", HASOWN_FIX], ["write-only", WRITE_ONLY], ["prose", PROSE_ONLY]] as const) {
      expect(tokenKeyedRecordReads(stripped(src)), label).toEqual([]);
    }
  });

  it("only a TOKEN key counts — a Record keyed by a phase name or a category is not this trap", () => {
    const OTHER = `
    const phase: Record<string, number> = {};
    const took = phase[name] ?? 0;
    const counts: Record<string, number> = {};
    const n = counts[cat] ?? 0;
    `;
    expect(tokenKeyedRecordReads(stripped(OTHER))).toEqual([]);
  });

  it("the '://'-safe stripper keeps a URL on the same line as a read", () => {
    const SRC = `const m: Record<string, number> = {}; const u = "https://x.y/z"; const v = m[token] ?? 0;`;
    expect(tokenKeyedRecordReads(stripped(SRC)).map((h) => h.name)).toEqual(["m"]);
  });
});

describe("every token-keyed map on the fetch path is a Map, or every read is hasOwn-guarded", () => {
  const detected = new Map<string, Offender[]>();
  for (const f of FETCH_PATH) {
    const code = stripped(readFileSync(resolve(DIR, f), "utf8"));
    for (const o of tokenKeyedRecordReads(code)) {
      const k = `${f}:${o.name}`;
      detected.set(k, [...(detected.get(k) ?? []), o]);
    }
  }

  it("found the fetch path at all, and reads Records in it (guards the guard)", () => {
    const idx = stripped(readFileSync(resolve(DIR, "index.ts"), "utf8"));
    expect(recordNames(idx).size).toBeGreaterThan(20);
    expect(idx).toMatch(/fetchBoard\(/);
  });

  it("no NEW token-keyed Record read has appeared", () => {
    const fresh = [...detected.keys()].filter((k) => !KNOWN_TRAPS.has(k));
    expect(
      fresh,
      `token-keyed Record<string, …> read on the fetch path — a token named 'constructor' (live in ` +
        `job_board_verifications today) reads a FUNCTION here. Use a Map, or guard the read with ` +
        `Object.hasOwn(map, token). Offenders:\n  ` +
        fresh.map((k) => `${k}: ${detected.get(k)!.map((o) => o.text).join(" | ")}`).join("\n  "),
    ).toEqual([]);
  });

  it("every waived trap is still real — a fixed one must leave KNOWN_TRAPS", () => {
    const stale = [...KNOWN_TRAPS].filter((k) => !detected.has(k));
    expect(
      stale,
      `these are in KNOWN_TRAPS but no longer detected — they were fixed (good); remove them from ` +
        `the list so the waiver keeps shrinking:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the new stale-lane module carries none", () => {
    expect([...detected.keys()].filter((k) => k.startsWith("stale-lane.ts:"))).toEqual([]);
  });

  it("the waiver is empty, so the property holds with no exceptions on the fetch path", () => {
    expect(KNOWN_TRAPS.size).toBe(0);
    expect([...detected.keys()]).toEqual([]);
  });

  it("STILL HAS TEETH after the fixes: a fresh unguarded Record keyed by token in index.ts fails the guard", () => {
    // The assertion above is "detected minus KNOWN_TRAPS is empty". Prove it
    // is not vacuous by handing the SAME detector the real index.ts with one
    // new offender appended — the shape a future lane would most plausibly
    // write — and checking it surfaces as a fresh key.
    const idx = stripped(readFileSync(resolve(DIR, "index.ts"), "utf8"));
    const INJECTED = `
  const laneTries: Record<string, number> = {};
  const n = laneTries[s.token] ?? 0;
  `;
    const fresh = tokenKeyedRecordReads(idx + INJECTED).map((o) => `index.ts:${o.name}`).filter((k) => !KNOWN_TRAPS.has(k));
    expect(fresh).toEqual(["index.ts:laneTries"]);
    // And the real file, unmodified, contributes nothing to that list.
    expect(tokenKeyedRecordReads(idx)).toEqual([]);
  });
});

describe("the deep cursor round-trips a token named 'constructor' through the meta row", () => {
  // deepCursors is serialised into job_board_meta.deep_cursor and read back
  // every cold hop. A Map in memory is only a fix if the JSON bridge keeps a
  // prototype-named token as a REAL entry in both directions.
  it("Map -> JSON -> Map keeps 'constructor' and '__proto__' as own entries with their offsets", () => {
    const m = new Map<string, number>([["constructor", 500], ["__proto__", 250], ["gopuff", 1000]]);
    const rec = tokenMapToRecord(m);
    const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    expect(has(rec, "constructor")).toBe(true);
    expect(has(rec, "__proto__")).toBe(true);   // Object.fromEntries defines an OWN property; `out[k] = n` would have hit the setter
    const json = JSON.stringify({ ...rec, __lane: { selected: 1 }, __laps: { "workday:x": { e: 1 } } });
    expect(json).toContain('"constructor":500');
    const back = tokenMapFromRecord(JSON.parse(json));
    expect(back.get("constructor")).toBe(500);
    expect(back.get("__proto__")).toBe(250);
    expect(back.get("gopuff")).toBe(1000);
    // The nested lane and lap objects are not positive integers and stay out
    // of the cursor map, exactly as they did through the Record form.
    expect([...back.keys()].sort()).toEqual(["__proto__", "constructor", "gopuff"]);
  });

  it("an empty row yields an empty Map — it does not 'have' constructor", () => {
    expect(tokenMapFromRecord({}).has("constructor")).toBe(false);
    expect(tokenMapFromRecord({}).get("constructor")).toBeUndefined();
    for (const bad of [null, undefined, "x", 3, [1, 2]]) expect(tokenMapFromRecord(bad).size, String(bad)).toBe(0);
    expect(tokenMapFromRecord({ a: 0, b: -1, c: 1.5, d: "2", e: 2 })).toEqual(new Map([["e", 2]]));
  });

  it("index.ts reads the cursor through the bridge and writes it back through the bridge", () => {
    const idx = stripped(readFileSync(resolve(DIR, "index.ts"), "utf8"));
    expect(idx).toMatch(/const deepCursors: Map<string, number> = tokenMapFromRecord\(deepCursorRow\);/);
    expect(idx).toMatch(/deepCursors\.get\(s\.token\) \?\? 0\)/);
    expect(idx).toMatch(/deepCursors\.set\(s\.token, r\.nextOffset\); deepCursorsDirty = true;/);
    expect(idx).toMatch(/deepCursors\.delete\(s\.token\); deepCursorsDirty = true;/);
    expect(idx).toMatch(/k: "deep_cursor", v: \{ \.\.\.tokenMapToRecord\(deepCursors\),/);
    expect(idx, "the cursor map is read by bracket somewhere").not.toMatch(/deepCursors\[/);
  });
});

describe("dormancy.ts with a board named 'constructor' — the fourth incident, closed", () => {
  const now = 1_000_000_000;

  it("updateBoardFailures: 'constructor' failing is a real streak with a real clock, and it prunes at the threshold like any board", () => {
    // Before the fix `firstFailedAt['constructor'] == null` was false (it read
    // Object), the start stamp was never written, `failingFor` was NaN, and
    // the prune floor never elapsed.
    let state = { streaks: {}, dormant: {}, failedAt: {}, firstFailedAt: {} } as ReturnType<typeof updateBoardFailures>;
    for (let i = 0; i < 6; i++) {
      state = updateBoardFailures({
        okTokens: [], failedTokens: ["constructor", "gopuff"], recheckTokens: new Set(),
        streaks: state.streaks, dormant: state.dormant, failedAt: state.failedAt, firstFailedAt: state.firstFailedAt,
        deadThreshold: 6, minFailureAgeMs: 5 * 3_600_000, dormantCap: 100, now: now + i * 3_600_000,
      });
    }
    expect(state.toPrune.sort()).toEqual(["constructor", "gopuff"]);
    expect(Object.prototype.hasOwnProperty.call(state.dormant, "constructor")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(state.streaks, "constructor")).toBe(false);
  });

  it("every token-keyed read in dormancy.ts goes through the hasOwn helper", () => {
    const src = stripped(readFileSync(resolve(DIR, "dormancy.ts"), "utf8"));
    expect(src).toMatch(/const own = \(rec: Record<string, number>, t: string\): number \| undefined => \(Object\.prototype\.hasOwnProperty\.call\(rec, t\) \? rec\[t\] : undefined\);/);
    expect(src).toMatch(/own\(params\.dormant, token\)/);
    expect(src).toMatch(/own\(params\.streaks, token\) \?\? 1/);
    expect(src).toMatch(/const since = own\(dormant, t\);/);
    expect(src).toMatch(/const streak = \(own\(streaks, t\) \?\? 0\) \+ 1;/);
    expect(src).toMatch(/const firstAt = own\(firstFailedAt, t\) \?\? params\.now;/);
  });
});

describe("the live module exhibits exactly what the waiver says it does", () => {
  // These assertions are DERIVED from KNOWN_TRAPS: while dormancy.ts:dormant
  // is waived the module must show the trap (proving the waiver is honest, not
  // stale); once it is removed, the module must not. Neither branch is a test
  // that has to be deleted on a fix.
  const trapped = KNOWN_TRAPS.has("dormancy.ts:dormant");
  const now = 1_000_000_000;

  it(`classifyDormancy(['constructor'], {}) ${trapped ? "skips it as dormant (the trap)" : "treats it as an active board"}`, () => {
    const { skip, recheck } = classifyDormancy(["constructor"], {}, now, 12 * 3_600_000);
    // With an EMPTY dormant map, an active board must be neither skipped nor
    // rechecked. Today `dormant['constructor']` is Object, `now - Object` is
    // NaN, `NaN >= recheckMs` is false, and the board lands in `skip`.
    expect(skip.has("constructor") || recheck.has("constructor")).toBe(trapped);
    // A board with a real name behaves correctly either way.
    const ok = classifyDormancy(["gopuff"], {}, now, 12 * 3_600_000);
    expect(ok.skip.size + ok.recheck.size).toBe(0);
  });

  it(`selectRetries ${trapped ? "never offers 'constructor' a retry, however overdue" : "retries 'constructor' like any board"}`, () => {
    const due = selectRetries({
      streaks: { constructor: 1, gopuff: 1 },
      failedAt: { constructor: now - 5 * 3_600_000, gopuff: now - 5 * 3_600_000 },
      dormant: {},
      exclude: new Set(),
      now,
      cap: 10,
    });
    expect(due.includes("gopuff")).toBe(true);
    expect(due.includes("constructor")).toBe(!trapped);
  });
});
