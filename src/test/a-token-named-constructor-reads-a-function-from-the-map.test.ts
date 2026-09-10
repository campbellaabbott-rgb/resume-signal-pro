import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyDormancy, selectRetries } from "../../supabase/functions/job-board/dormancy.ts";

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
 * THE WAIVER EXPIRES ITSELF. index.ts and dormancy.ts are not this lane's to
 * edit, so the traps they hold today are named in KNOWN_TRAPS and the guard
 * asserts the detected set EQUALS it: a new token-keyed Record fails the
 * build, and a trap that gets FIXED also fails it — with the instruction to
 * remove it from the list. A waiver that can only shrink is not a hole.
 */
const DIR = resolve(__dirname, "../../supabase/functions/job-board");
const FETCH_PATH = ["index.ts", "dormancy.ts", "stale-lane.ts", "rotation.ts", "paging.ts"] as const;

/** Traps present at HEAD 87351855 (2026-09-09). Remove an entry when its map becomes a Map or its reads are hasOwn-guarded. */
const KNOWN_TRAPS = new Set([
  "index.ts:deepCursors",     // deep_cursor meta, read at the fetch call and the cursor fold
  "index.ts:openMap",         // companiesOpen facet: a company token named 'constructor' serves open = Object
  "dormancy.ts:dormant",      // classifyDormancy / selectRetries: the token is skipped as dormant
  "dormancy.ts:streaks",      // selectRetries / updateBoardFailures: NaN backoff
  "dormancy.ts:firstFailedAt", // updateBoardFailures: the prune floor never elapses (NaN)
]);

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
      if (new RegExp(`Object\\.hasOwn\\(\\s*(?:\\w+\\.)?${name}\\s*,`).test(window)) continue;
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
