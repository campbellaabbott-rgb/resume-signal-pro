// @vitest-environment node
//
// Node, not jsdom: this file compiles the real edge-function source with
// esbuild, and esbuild refuses to run where `new TextEncoder().encode("")` is
// not a real Uint8Array — which is exactly what jsdom's globals give it. There
// is no DOM in this test.
//
// A WINDOW OF OURS IS NOT A CLOSURE OF THEIRS.
//
// `checkLive` is the moment-of-apply liveness probe. For the fifteen vendors
// with no per-job endpoint it fetches the whole board and asks whether the id
// is in it. It ended:
//
//     return ids.has(externalId);
//
// and never read `r.windowed` — the flag that says the vendor's OWN advertised
// total exceeded what we could fetch. A posting displaced past the page cap is
// absent from that set while being perfectly live on the employer's site.
// Measured 2026-07-21: 7 of 8 sampled "closures" on a windowed board were still
// open on the company's own site. ~4,348 of 44,542 boards sit on capped
// fetchers.
//
// The cost of the missing flag was not a wrong pixel. Verify-on-apply told the
// user "{{company}} took this one down" — a claim about a NAMED employer, made
// with no evidence — stamped the posting missing_since so it vanished for
// everyone, and then DELETEd it with no closure row, punching a hole in the
// lifecycle log, the one asset this product says cannot be re-derived.
//
// The refresh prune, 2,000 lines away, had the guard the whole time
// (`const truncatedFetch = r.windowed === true;`, and `partialRead` above it).
// Two paths, one rule, one of them missing it. So this guard does not pin a
// call site's spelling — it states the PROPERTY for the CLASS:
//
//   A POSTING ABSENT FROM A WINDOWED FETCH IS NEVER REPORTED AS CLOSED,
//   WHEREVER THAT DECISION IS MADE.
//
// and enumerates the decision sites out of the source, so a THIRD path added
// later fails here instead of shipping. A path may satisfy it in one of exactly
// two ways: derive the flag itself with the canonical predicate, or take its
// verdict from checkLive's tri-state and treat ONLY `=== false` as gone.
//
// The behavioural half compiles the real, shipped `checkLive` out of the module
// (esbuild strips the types; every free identifier is stubbed) and runs the 2x2
// truth table through it. A prose-only guard would have passed on the comment
// that was already there and wrong — this file has been bitten that way before.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

const SRC = resolve(__dirname, "../../supabase/functions/job-board/index.ts");
const RAW = readFileSync(SRC, "utf8");
/**
 * Comment-stripped source. Line comments first — a block-first strip treats the
 * `/*` inside a line comment as an opener and silently deletes real code — and
 * a `//` only opens a comment when it is not preceded by a colon or a word
 * character, or every `https://…` in the file eats the rest of its line.
 */
const CODE = RAW.replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");

// ─────────────────────────────────────────────────────────────────────────────
// The shipped checkLive, compiled and executable.
// ─────────────────────────────────────────────────────────────────────────────
const fnSource = (() => {
  const start = RAW.indexOf("async function checkLive(");
  expect(start, "checkLive not found in job-board/index.ts").toBeGreaterThan(-1);
  const end = RAW.indexOf("\n}", start); // only a column-0 brace closes a top-level fn
  return RAW.slice(start, end + 2);
})();

type Board = { jobs: Array<{ id: string }>; raw: unknown; windowed?: boolean } | null;
type Stubs = Record<string, unknown>;

/**
 * Build the real function with `deps` in scope.
 *
 * `with` over a Proxy rather than a fixed parameter list on purpose: an
 * identifier this harness does not know about reports itself by name instead of
 * failing as an inscrutable ReferenceError, so a future edit that reaches for a
 * new helper inside checkLive gets told what to stub.
 */
function buildCheckLive(deps: Stubs) {
  const js = transformSync(fnSource, { loader: "ts" }).code;
  const reached: string[] = [];
  const env = new Proxy(deps, {
    has: () => true,
    get: (t, k) => {
      if (typeof k === "symbol") return undefined;
      if (k in t) return (t as Stubs)[k];
      if (k in (globalThis as unknown as Stubs)) return (globalThis as unknown as Stubs)[k];
      reached.push(String(k));
      throw new Error(`checkLive reached an unstubbed dependency: ${String(k)}`);
    },
  });
  // eslint-disable-next-line no-new-func
  const make = new Function("__env", `with (__env) { ${js}\n return checkLive; }`) as (
    e: unknown,
  ) => (src: unknown, externalId: string, applyUrl?: string | null) => Promise<boolean | null>;
  return { fn: make(env), reached };
}

/** A probe against a board-membership vendor, with the fetch under our control. */
async function probe(
  opts: { source: string; token?: string; board: Board; ask: string; askTwice?: boolean },
): Promise<boolean | null> {
  const src = { name: "Acme", source: opts.source, token: opts.token ?? "acme" };
  let fetches = 0;
  const { fn } = buildCheckLive({
    liveBoardMemo: new Map(),
    fetchBoard: async () => { fetches++; return opts.board; },
    fetchWithTimeout: async () => { throw new Error("a membership vendor must not hit a per-job endpoint"); },
    greenhouseApi: () => ({ host: "x", token: "y" }),
    leverApi: () => ({ host: "x", token: "y" }),
    workdayCxsUrl: () => null,
  });
  const first = await fn(src, opts.ask, null);
  if (!opts.askTwice) return first;
  // Second probe on the same board: answered from the memo. If the memo kept
  // only the id set, this is where a windowed board turns back into a closure.
  const second = await fn(src, opts.ask, null);
  expect(fetches, "the board should have been fetched once and memoized").toBe(1);
  return second;
}

/** An ashby-shaped board: ids read from the RAW payload. */
const ashby = (ids: string[], windowed?: boolean): Board => ({
  jobs: ids.map((i) => ({ id: `ashby:acme:${i}` })),
  raw: { jobs: ids.map((i) => ({ id: i })) },
  windowed,
});
/** Everyone else: ids read from our normalized `source:token:externalId`. */
const normalized = (source: string, ids: string[], windowed?: boolean): Board => ({
  jobs: ids.map((i) => ({ id: `${source}:acme:${i}` })),
  raw: {},
  windowed,
});

describe("a window of ours is not a closure of theirs", () => {
  it("compiles the REAL checkLive — not a copy of it", async () => {
    // Vacuity check: if the extraction ever grabs the wrong text, or a stub
    // silently absorbs the vendor branches, every assertion below is theatre.
    expect(fnSource).toContain("async function checkLive(");
    expect(fnSource.length).toBeGreaterThan(2_000);
    const { fn } = buildCheckLive({
      liveBoardMemo: new Map(),
      fetchBoard: async () => null,
      fetchWithTimeout: async (u: string) => ({ status: u.includes("dead") ? 404 : 200, ok: !u.includes("dead") }),
      greenhouseApi: (t: string) => ({ host: "boards-api.greenhouse.io", token: t }),
      leverApi: (t: string) => ({ host: "api.lever.co", token: t }),
      workdayCxsUrl: () => null,
    });
    const gh = { name: "Acme", source: "greenhouse", token: "acme" };
    expect(await fn(gh, "live-1", null), "a 200 on the per-job endpoint is live").toBe(true);
    expect(await fn(gh, "dead-1", null), "a 404 on the per-job endpoint is the vendor saying gone").toBe(false);
  });

  // ── THE 2x2 THAT SHIPPED WRONG ────────────────────────────────────────────
  it("ABSENT from a WINDOWED fetch is null — never a closure", async () => {
    expect(await probe({ source: "ashby", board: ashby(["A1"], true), ask: "A2" })).toBeNull();
    expect(await probe({ source: "icims", board: normalized("icims", ["E1"], true), ask: "E2" })).toBeNull();
    // Every vendor that can window, probed as a class. These are the ones whose
    // fetchers compute a real `windowed` and that reach board membership —
    // they arrived long after the "only ashby / workable / bamboohr" comment.
    for (const v of ["icims", "rippling", "adp", "ukg", "usajobs", "jazzhr"]) {
      expect(
        await probe({ source: v, board: normalized(v, ["E1"], true), ask: "E2" }),
        `${v}: a page-capped read cannot prove the employer took a posting down`,
      ).toBeNull();
    }
  });

  it("ABSENT from an EXHAUSTIVE fetch is still a confirmed closure", async () => {
    // The fix must not blunt the honest answer: on a board we read whole,
    // absence IS evidence, and the lifecycle log depends on it.
    expect(await probe({ source: "ashby", board: ashby(["A1"], false), ask: "A2" })).toBe(false);
    expect(await probe({ source: "icims", board: normalized("icims", ["E1"], false), ask: "E2" })).toBe(false);
    // A fetcher that reports no flag at all is exhaustive by construction
    // (workable, bamboohr, recruitee, breezy, … return `{ jobs, raw }`).
    expect(await probe({ source: "workable", board: normalized("workable", ["E1"]), ask: "E2" })).toBe(false);
  });

  it("PRESENT is live, windowed or not", async () => {
    expect(await probe({ source: "ashby", board: ashby(["A1"], true), ask: "A1" })).toBe(true);
    expect(await probe({ source: "ashby", board: ashby(["A1"], false), ask: "A1" })).toBe(true);
    expect(await probe({ source: "icims", board: normalized("icims", ["E1"], true), ask: "E1" })).toBe(true);
  });

  it("the MEMO carries windowed, so the second probe answers the same way", async () => {
    // The memo is per-request and shared across the ids in one verify batch. A
    // memo holding only the id set would answer the first probe null and the
    // rest false — the worst possible shape, since it looks fixed under test.
    expect(await probe({ source: "ashby", board: ashby(["A1"], true), ask: "A2", askTwice: true })).toBeNull();
    expect(await probe({ source: "ashby", board: ashby(["A1"], false), ask: "A2", askTwice: true })).toBe(false);
  });

  it("a fetch that fails outright is unknown, not closed", async () => {
    expect(await probe({ source: "ashby", board: null, ask: "A1" })).toBeNull();
  });

  // ── THE CLASS RULE ────────────────────────────────────────────────────────
  /** Top-level function ranges, so a site can be attributed to its owner. */
  const ranges = (() => {
    const heads = [...CODE.matchAll(/^(?:async function|function) ([A-Za-z_$][\w$]*)\s*[(<]|^Deno\.serve\(/gm)];
    return heads.map((m, i) => ({
      name: m[1] ?? "Deno.serve",
      start: m.index!,
      end: i + 1 < heads.length ? heads[i + 1].index! : CODE.length,
    }));
  })();
  const owner = (idx: number) => ranges.find((r) => idx >= r.start && idx < r.end);

  /**
   * Every function that fetches a board for itself. Derived, never listed: a
   * new one is exactly the thing this guard exists to catch.
   */
  const boardFetchers = (() => {
    const out = new Map<string, { name: string; body: string }>();
    for (const m of CODE.matchAll(/\bfetchBoard\(/g)) {
      const o = owner(m.index!);
      if (!o || o.name === "fetchBoard") continue; // the definition itself
      out.set(o.name, { name: o.name, body: CODE.slice(o.start, o.end) });
    }
    return [...out.values()];
  })();

  /** Markers of a verdict that a posting is GONE, as opposed to merely absent. */
  const CLOSURE_MARKERS = [/missing_since/, /job_board_closures/, /\bvanished\b/, /\breturn\b[^;\n]*\bfalse\b/];
  /** The one canonical way to read the flag. Both existing paths spell it this way. */
  const CANONICAL = /\.windowed === true/;
  /**
   * `null` means we could not tell. `if (!live)` reads that as a takedown and
   * puts the whole defect back at a site that never mentions `windowed`, so a
   * path that delegates to checkLive only counts as safe while every one of its
   * verdicts is consumed by an explicit comparison.
   */
  const COLLAPSES_UNKNOWN = /if\s*\(\s*!\s*(live|alive|r)\b\s*[)&|]/;
  const delegatesToCheckLive = (body: string) =>
    /\bcheckLive\(/.test(body) &&
    [...body.matchAll(/\bcheckLive\(/g)].every((m) => !COLLAPSES_UNKNOWN.test(body.slice(m.index!, m.index! + 900)));

  it("enumerates the board-fetching functions, and finds more than one", () => {
    expect(boardFetchers.map((f) => f.name).sort().join(", ")).not.toBe("");
    expect(boardFetchers.length, "the enumeration broke — every assertion below went vacuous").toBeGreaterThan(2);
    expect(boardFetchers.map((f) => f.name)).toContain("checkLive");
    expect(boardFetchers.map((f) => f.name)).toContain("runRefresh");
  });

  it("EVERY path that turns absence into a closure applies the windowed rule", () => {
    const offenders = boardFetchers
      .filter((f) => CLOSURE_MARKERS.some((re) => re.test(f.body)))
      .filter((f) => {
        // Two ways to be right, and no third.
        if (CANONICAL.test(f.body)) return false; // derives the flag itself
        // …or delegates to checkLive and treats ONLY an explicit false as gone.
        return !delegatesToCheckLive(f.body);
      })
      .map((f) => f.name);
    expect(
      offenders.join(", "),
      "these functions can report a posting closed from a board fetch without proving the fetch was exhaustive — read `X.windowed === true` and answer null when it is, or take the verdict from checkLive and branch on `=== false`",
    ).toBe("");
  });

  /** Extent of the balanced pair opened by `src[open]`. */
  const balanced = (src: string, open: number, o = "{", c = "}") => {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === o) depth++;
      else if (src[i] === c && --depth === 0) return i;
    }
    return src.length;
  };
  /** Regions dominated by an `if` whose condition reads one of `flags`. */
  const guardedBy = (body: string, flags: string[]) => {
    const out: Array<[number, number]> = [];
    for (const m of body.matchAll(/\bif\s*\(/g)) {
      const condEnd = balanced(body, m.index! + m[0].length - 1, "(", ")");
      const cond = body.slice(m.index!, condEnd);
      if (!flags.some((f) => new RegExp(`\\b${f}\\b`).test(cond))) continue;
      const brace = body.indexOf("{", condEnd);
      if (brace < 0) continue;
      out.push([brace, balanced(body, brace)]);
    }
    return out;
  };

  it("the flag is APPLIED, not merely mentioned", () => {
    // The class rule above is satisfied by a function that reads `windowed`
    // ANYWHERE in its body — and runRefresh is three thousand lines long, so
    // one of its two applications could be deleted while the other kept the
    // guard green. This states the narrower property: the absence set and the
    // closure log are each filtered by a windowed-derived flag, with the flag
    // names DERIVED from the source rather than pinned, so a rename is fine and
    // a deletion is not. (checkLive's half is proven behaviourally above.)
    for (const f of boardFetchers) {
      const flags = [...f.body.matchAll(/const (\w+) = [\w.]+\.windowed === true/g)].map((m) => m[1]);
      const absenceLoops = [...f.body.matchAll(/for \(const \w+ of (\w*[Vv]anish\w*)\b/g)];
      const closureWrites = [...f.body.matchAll(/from\(\s*"job_board_closures"\s*\)\s*\n?\s*\.insert/g)];
      if (absenceLoops.length === 0 && closureWrites.length === 0) continue;
      expect(flags.length, `${f.name} decides absence but derives no windowed flag`).toBeGreaterThan(0);
      for (const loop of absenceLoops) {
        const brace = f.body.indexOf("{", loop.index!);
        const bodyOfLoop = f.body.slice(brace, balanced(f.body, brace));
        expect(
          flags.some((fl) => new RegExp(`\\b${fl}\\b`).test(bodyOfLoop)),
          `${f.name}: the loop over ${loop[1]} deletes or stamps ids without asking whether the fetch was windowed`,
        ).toBe(true);
      }
      const guarded = guardedBy(f.body, flags);
      for (const w of closureWrites) {
        expect(
          guarded.some(([a, b]) => w.index! > a && w.index! < b),
          `${f.name}: a closure row is written outside any windowed-guarded branch — a page cap of ours would be logged as a takedown of theirs`,
        ).toBe(true);
      }
    }
  });

  it("the verify path and the refresh prune apply the SAME rule, spelled the same way", () => {
    // Three derivations today: checkLive's memo, the prune's `partialRead`, the
    // closure log's `truncatedFetch`. If they drift apart in spelling they will
    // drift apart in meaning next.
    // Reads only: skip object-literal keys (`windowed:`), shorthand
    // (`windowed,` / `windowed}`) and ASSIGNMENTS (`note.windowed = true`,
    // which is how checkLive reports WHY it answered null) — a write is not a
    // derivation of the rule, and `=` without a second `=` is what separates
    // them.
    const reads = [...CODE.matchAll(/\.windowed\b(?!\s*[:,}]|\s*=[^=])/g)].map((m) =>
      CODE.slice(m.index!, m.index! + 24).replace(/\s+/g, " "),
    );
    // NO EXEMPTIONS. The first version of this test excluded the memo's own
    // re-read (`memo.windowed ? null : false`) as "not really a derivation" —
    // which exempted the single site that turns the flag into a user-visible
    // verdict, i.e. the one most worth pinning. `memo.windowed ?? false`, or a
    // truthy non-boolean, would have passed. checkLive now spells the rule the
    // same four tokens as the prune and the closure log, so the exemption is
    // gone and the sentence above is true of every site without qualification.
    expect(reads.length, "no consumer reads `windowed` at all").toBeGreaterThanOrEqual(4);
    for (const r of reads) {
      expect(r, "every consumer must derive the flag as `X.windowed === true`").toMatch(CANONICAL);
    }
    // And the tri-state tail is pinned in full, so the verdict cannot be
    // rearranged into a two-state one without this failing.
    expect(CODE, "checkLive's tri-state tail changed shape").toMatch(
      /const truncatedFetch = memo\.windowed === true;[\s\S]{0,80}if \(memo\.ids\.has\(externalId\)\) return true;\s*if \(truncatedFetch\) \{[^}]*return null; \}\s*return false;/,
    );
  });

  it("a checkLive verdict of `null` must not reach a client as `true`", () => {
    // THE GUARD STOPPED ONE LINE SHORT OF THE WIRE. checkLive returned three
    // states and the verify action collapsed them to two — `else liveMap[id] =
    // true` — so `null` left the function indistinguishable from a confirmed
    // live probe, and Jobs.tsx turned that into "{{company}}'s own board still
    // lists this role as open" for a user who had just correctly reported the
    // posting gone. Proving the edge function's three states is not the
    // property; the property is that a client can tell them apart.
    const verify = CODE.slice(CODE.indexOf('if (action === "verify")'));
    expect(verify.slice(0, 3000), "the response map must be able to carry the third state")
      .toMatch(/const liveMap: Record<string, boolean \| null> = \{\};/);
    expect(verify.slice(0, 3000), "the unknown verdict must ship as itself, not as true")
      .toMatch(/else liveMap\[id\] = live;/);
    expect(verify.slice(0, 3000), "closing is still gated on an explicit false")
      .toMatch(/if \(live === false\) \{ liveMap\[id\] = false; deadIds\.push\(id\); \}/);
    // ...and the client that renders the confident sentence must branch on it.
    const JOBS = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
    expect(JOBS, "verifyJob still returns a boolean — the third state dies at the client instead")
      .toMatch(/const verifyJob = async \(job: BoardJob\): Promise<boolean \| null> =>/);
    expect(JOBS, "the 'still open' toast must require an explicit true")
      .toMatch(/if \(stillLive === true\) \{/);
    expect(JOBS, "there must be a distinct string for the undecidable case")
      .toMatch(/jobsPage\.reportUncheckableBody/);
    const EN = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/en.json"), "utf8"));
    // It must not reuse either CONFIRMED sentence, and it must actually say we
    // could not tell. (It may of course contain the word "gone" — saying "we
    // can't confirm this one is gone" is the entire point.)
    for (const confident of [EN.jobsPage.reportCheckedBody, EN.jobsPage.postingClosedBody]) {
      expect(EN.jobsPage.reportUncheckableBody, "the undecidable copy reuses a confirmed verdict's sentence")
        .not.toBe(confident);
    }
    expect(EN.jobsPage.reportUncheckableBody, "the undecidable copy must not assert the employer still lists it")
      .not.toMatch(/still lists this role as open|took this one down/i);
    expect(EN.jobsPage.reportUncheckableBody, "the undecidable copy must say we could not tell")
      .toMatch(/can'?t confirm|could not confirm|couldn'?t confirm/i);
  });

  it("no caller of checkLive may collapse `unknown` into `closed`", () => {
    const sites = [...CODE.matchAll(/\bcheckLive\(/g)].map((m) => m.index!);
    expect(sites.length, "checkLive is called from somewhere").toBeGreaterThan(1);
    for (const at of sites) {
      expect(
        CODE.slice(at, at + 900),
        "a checkLive verdict is consumed by truthiness here — only `=== false` is a closure",
      ).not.toMatch(COLLAPSES_UNKNOWN);
    }
    // And the surviving consumers say so explicitly.
    expect(CODE, "the verify action must close only on an explicit false").toMatch(/if \(live === false\)/);
  });

  // ── AND THE COMMENT, WHICH WAS THE ACCOMPLICE ─────────────────────────────
  it("the membership fallback no longer claims only three vendors reach it", () => {
    const i = RAW.indexOf("async function checkLive(");
    const body = RAW.slice(i, RAW.indexOf("\n}", i));
    expect(
      body,
      "the stale 'Only ashby / workable / bamboohr reach here' comment is what made the missing guard easy to miss",
    ).not.toMatch(/Only ashby \/ workable \/ bamboohr reach here/);
    const prose = body.replace(/\n\s*\/?\/?\s*/g, " ");
    expect(prose, "the fallback must say how many vendors actually reach it").toMatch(/FIFTEEN vendors reach here/i);
    expect(prose, "and name the rule it applies").toMatch(/WINDOWED-ABSENCE RULE/);
  });
});
