/**
 * THE VERIFIER JUDGES THE FIELD CURVE BY THE CACHE IT IS SERVED FROM.
 *
 * The field curve's live RPC answered in 34 s on 2026-09-25, 47 s at 14:xx on
 * 09-27, and 60 s with no rows at 18:xx and 23:xx that day -- its own
 * statement timeout. The deploy verifier measured that, but it also called
 * the function live FIVE times a run and passed its curve section only when
 * the live call came back under 45 s with rows. The fix moved the two pages
 * that read the curve on every visit onto the hourly stats cache's new part;
 * a verifier that still passed on the live call's speed would then be grading
 * a path no visitor waits on, and failing the deploy on the one thing the
 * deploy deliberately stopped promising.
 *
 * What this file pins, property by property, on the comment-stripped script.
 * Every name it pins lives in a constant below, never in this prose, and a
 * test at the foot reads this file's own comments to prove that:
 *
 *   1. The live RPC is invoked ONCE in the whole verifier, in the curve
 *      section, and the statement that consumes its answer prints an
 *      informational line and never a verdict.
 *   2. That section's verdict lines are computed from the cache read: the
 *      time the read took, and the age of the stamp on the cached part. The
 *      bars are named constants, and they are no looser than the numbers the
 *      fix committed to (two seconds for the read, three hours for the stamp).
 *   3. The API section reads the same curve off the keyed stats endpoint and
 *      checks the deprecation notice names the replacement exactly when the
 *      replacement is served -- with the literal the edge function ships, not
 *      a copy that can drift.
 *   4. The edge function reads the part through one normaliser that accepts
 *      either storage shape and dates the block with the PART's own stamp;
 *      the normaliser is unit-tested here on every shape, and the version
 *      literal moved together with the probe that pins it.
 *
 * TEETH. Each verifier check is a function over the script text, and each is
 * run against a mutated copy that reintroduces the defect it guards -- a
 * verdict on the live call, a second live call, a looser bar, a verdict
 * computed from the live answer's file by a body that never names the
 * function -- and must fail there. A guard that cannot go red has not been
 * shown to read anything.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOf, commentsOf } from "./helpers/strip-comments";
import { fillCurveFromCache } from "../../supabase/functions/public-api/fill-curve-cache";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// The names this file pins. They live here and in code below, never in a comment.
const LIVE_FN = "get_category_fill_curve";
const CACHE_FN = "get_stats_cache";
const PART = "fill_curve";
const RETIRED_HELPER = "Rslow";
const MS_BAR = "MAX_CACHE_MS";
const AGE_BAR = "MAX_CURVE_AGE_H";
const VERSION_CONST = "API_VERSION";
const STATS_PATH = "/v1/stats";

/**
 * A shell script with its whole-line comments gone, in both dialects it
 * carries: bash `#` lines and the `//` lines inside its node -e bodies. Only
 * whole lines are cut, because a `//` inside a node string is a URL.
 */
const shellCodeOf = (src: string) => src.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n");

const SCRIPT_RAW = read("scripts/verify-deploy.sh");
const SCRIPT = shellCodeOf(SCRIPT_RAW);
const API = codeOf(read("supabase/functions/public-api/index.ts"));
const PROBE = codeOf(read("scripts/api-contract-probe.mjs"));

/** One `== id. ... ==` section: from its echo line up to the next section's echo line. */
function section(script: string, id: string): string {
  const open = new RegExp(`^echo "== ${id}\\. `, "m").exec(script);
  if (!open) throw new Error(`no section ${id} in the verifier`);
  const rest = script.slice(open.index + 1);
  const next = /^echo "== /m.exec(rest);
  return script.slice(open.index, next ? open.index + 1 + next.index : undefined);
}

/** Every node body in a stretch of script, inline or through the cached-rows helper: the text between its single quotes. */
const bodies = (text: string): string[] => [...text.matchAll(/(?:node -e|CAT) '([^']*)'/g)].map((m) => m[1]);

/** An invocation of the live category curve: through the short helper, the retired long-wait helper, or a raw REST path. */
const LIVE_CALL = new RegExp(`(?:\\bR\\s+|\\b${RETIRED_HELPER}\\s+|rpc/)${LIVE_FN}\\b`, "g");

/** The file the live answer is written to, captured without the separator that follows it on the line. */
const sinkOf = (s4e: string): string | null => new RegExp(`rpc/${LIVE_FN}[^\\n]*?>\\s*([^\\s;]+)`).exec(s4e)?.[1] ?? null;

const verdicts = (body: string) => /"(PASS|FAIL)/.test(body);

// ── the checks, each a function of the script so the negative controls can share them ──

/** Violations of property 1: where the live call is made, and what the consumer of its answer prints. */
function liveCallViolations(script: string): string[] {
  const out: string[] = [];
  const calls = [...script.matchAll(LIVE_CALL)];
  if (calls.length !== 1) out.push(`the live RPC is invoked ${calls.length} times; the verifier may observe it once`);
  const s4e = section(script, "4e");
  for (const c of calls) {
    const inside = c.index! >= script.indexOf(s4e) && c.index! < script.indexOf(s4e) + s4e.length;
    if (!inside) out.push("a live invocation sits outside §4e");
  }
  // The answer is written to a file; whichever body reads that file, and
  // whichever body names the function, must print an informational line and
  // nothing graded.
  const sink = sinkOf(s4e);
  for (const b of bodies(s4e)) {
    const touchesLive = b.includes(LIVE_FN) || (sink !== null && b.includes(sink));
    if (touchesLive && verdicts(b)) out.push("the body that consumes the live answer prints a verdict");
    if (touchesLive && !b.includes('"INFO')) out.push("the body that consumes the live answer does not print INFO");
  }
  return out;
}

/** Violations of property 2: the cache path is what §4e grades, against bars no looser than the fix's. */
function cachePathViolations(script: string): string[] {
  const out: string[] = [];
  const ms = /^MAX_CACHE_MS=(\d+)$/m.exec(script);
  const h = /^MAX_CURVE_AGE_H=(\d+)$/m.exec(script);
  if (!ms) out.push(`no ${MS_BAR} constant`);
  else if (Number(ms[1]) > 2000) out.push(`${MS_BAR}=${ms[1]} is looser than 2000`);
  if (!h) out.push(`no ${AGE_BAR} constant`);
  else if (Number(h[1]) > 3) out.push(`${AGE_BAR}=${h[1]} is looser than 3`);
  if (!new RegExp(`^export ${MS_BAR} ${AGE_BAR}$`, "m").test(script)) out.push("the bars are not exported to the node bodies");
  if (!new RegExp(`\\bR ${CACHE_FN}\\b`).test(section(script, "4"))) out.push(`§4 does not read ${CACHE_FN}`);
  const graded = bodies(section(script, "4e")).filter(verdicts);
  if (graded.length === 0) out.push("§4e grades nothing");
  for (const b of graded) {
    if (b.includes(LIVE_FN)) out.push("a graded body in §4e names the live RPC");
    if (!b.includes(MS_BAR)) out.push(`a graded body in §4e does not compare the read time to ${MS_BAR}`);
    if (!b.includes(AGE_BAR)) out.push(`a graded body in §4e does not compare the stamp age to ${AGE_BAR}`);
    if (!b.includes("computed_at")) out.push("a graded body in §4e does not read a computed_at");
    if (!new RegExp(`\\b${PART}\\b`).test(b)) out.push(`a graded body in §4e does not name the ${PART} part`);
  }
  return out;
}

describe("the live RPC is observed once and never graded", () => {
  it("the verifier invokes get_category_fill_curve exactly once, in §4e, and only INFO consumes the answer", () => {
    expect(liveCallViolations(SCRIPT)).toEqual([]);
  });

  it("no other section of the S(30) block fetches category rows live: they read what §4 cached", () => {
    for (const id of ["4", "4a", "4b", "4d"]) {
      const s = section(SCRIPT, id);
      expect(s, `§${id} invokes the live curve`).not.toMatch(LIVE_CALL);
      expect(s, `§${id} does not read the cached rows`).toMatch(/\bCAT '/);
    }
    // The 240-second helper that existed only to wait on the live call is gone.
    expect(SCRIPT).not.toMatch(new RegExp(`^${RETIRED_HELPER}\\(\\)`, "m"));
  });

  it("the live observation is opt-in: the default run never holds a five-minute statement open on the server", () => {
    // The callee's own header is five minutes and a client that gives up at
    // 70s does not cancel the statement; a verifier that fired it on every run
    // would pin a pooled connection for the full header on a path no visitor
    // waits on. The gate defaults to skipping and reads the same variable
    // either way.
    const s4e = section(SCRIPT, "4e");
    const gate = /if \[ "\$\{SKIP_LIVE_CURVE:-(\d)\}" != "1" \]; then/.exec(s4e);
    expect(gate, "the live observation is not behind a gate").toBeTruthy();
    expect(gate![1]).toBe("1");
    const callAt = s4e.search(LIVE_CALL);
    expect(callAt).toBeGreaterThan(gate!.index);
    expect(s4e.indexOf("\nfi\n", callAt)).toBeGreaterThan(callAt);
  });

  it("teeth: grading the live answer, or calling it twice, fails the check", () => {
    const graded = SCRIPT.replace('"INFO  live get_category_fill_curve', '"PASS  live get_category_fill_curve');
    expect(graded).not.toBe(SCRIPT);
    expect(liveCallViolations(graded)).toContain("the body that consumes the live answer prints a verdict");

    const twice = SCRIPT.replace(
      /^(echo "== 4a\. [^\n]*\n)/m,
      `$1R get_category_fill_curve '{"p_days":90,"p_min_n":300}' > /tmp/vd_cat.json\n`,
    );
    expect(twice).not.toBe(SCRIPT);
    expect(liveCallViolations(twice).some((v) => v.startsWith("the live RPC is invoked 2 times"))).toBe(true);

    const moved = SCRIPT.replace(/^(echo "== 4e\. [^\n]*)$/m, 'echo "== 4x. moved"').replace(
      /^echo "== 4f\. /m,
      'echo "== 4e. placeholder"\necho "== 4f. ',
    );
    expect(() => liveCallViolations(moved)).not.toThrow();
    expect(liveCallViolations(moved)).toContain("a live invocation sits outside §4e");

    // A verdict computed from the live answer's FILE by a body that never
    // names the function. This is caught only if the sink is captured
    // without the separator that follows it on the script line -- the first
    // version of this file captured it WITH that separator, and this body
    // would have slipped past.
    const s4e = section(SCRIPT, "4e");
    const sink = sinkOf(s4e);
    expect(sink).toBeTruthy();
    expect(sink!.endsWith(";")).toBe(false);
    const viaSink = SCRIPT.replace(
      s4e,
      s4e.replace(/^fi$/m, `fi\nnode -e 'const j=JSON.parse(require("fs").readFileSync("${sink}","utf8"));console.log("PASS  "+j.length+" live rows")'`),
    );
    expect(viaSink).not.toBe(SCRIPT);
    expect(viaSink).not.toMatch(new RegExp(`console\\.log\\("PASS  "\\+j\\.length[^\\n]*${LIVE_FN}`));
    expect(liveCallViolations(viaSink)).toContain("the body that consumes the live answer prints a verdict");
  });
});

describe("§4e's verdict is the cache path", () => {
  it("grades the get_stats_cache read time and the fill_curve stamp age against the fix's bars", () => {
    expect(cachePathViolations(SCRIPT)).toEqual([]);
  });

  it("teeth: a looser bar, a dropped comparison, or a graded body naming the live RPC fails the check", () => {
    const loose = SCRIPT.replace(new RegExp(`^${AGE_BAR}=3$`, "m"), `${AGE_BAR}=48`);
    expect(loose).not.toBe(SCRIPT);
    expect(cachePathViolations(loose)).toContain(`${AGE_BAR}=48 is looser than 3`);

    const slow = SCRIPT.replace(new RegExp(`^${MS_BAR}=2000$`, "m"), `${MS_BAR}=60000`);
    expect(cachePathViolations(slow)).toContain(`${MS_BAR}=60000 is looser than 2000`);

    const s4e = section(SCRIPT, "4e");
    const ungraded = SCRIPT.replace(s4e, s4e.replace(new RegExp(AGE_BAR, "g"), "ANY_AGE"));
    expect(ungraded).not.toBe(SCRIPT);
    expect(cachePathViolations(ungraded)).toContain(`a graded body in §4e does not compare the stamp age to ${AGE_BAR}`);

    const named = SCRIPT.replace(s4e, s4e.replace(`"  ${CACHE_FN} answered in "`, `"  ${LIVE_FN} via ${CACHE_FN} in "`));
    expect(named).not.toBe(SCRIPT);
    expect(cachePathViolations(named)).toContain("a graded body in §4e names the live RPC");
  });

  it("the bars are stated in the script, not only in this test", () => {
    // Two seconds is the bar the fix set for a read the pages make on every
    // visit; three hours is the hourly cron plus two missed runs. The
    // script's own numbers.
    expect(new RegExp(`^${MS_BAR}=2000$`, "m").test(SCRIPT)).toBe(true);
    expect(new RegExp(`^${AGE_BAR}=3$`, "m").test(SCRIPT)).toBe(true);
  });
});

describe("§4g reads the curve off /v1/stats with the literal the endpoint ships", () => {
  const s4g = section(SCRIPT, "4g");

  it("exists, reads data.lifecycle.fillCurve with the owner's API key, and degrades to an informational line without one", () => {
    expect(s4g).toContain(STATS_PATH);
    expect(s4g).toMatch(/Bearer \$RB/);
    expect(s4g).toMatch(/-z "\$RB"/);
    expect(s4g).toMatch(/fillCurve/);
    expect(s4g).toMatch(/carriedForward/);
    // The anon JWT must be refused: the section proves the keyed API is not
    // anon-reachable rather than assuming it.
    expect(s4g).toMatch(/Bearer \$K[^\n]*\n\[ "\$acode" = "401" \]/);
  });

  it("checks the deprecation notice with the replacement-present literal from public-api, not a copy", () => {
    const lit = /hasFillCurve\s*\?\s*"([^"]+)"/.exec(API)?.[1];
    expect(lit, "public-api chooses the replacement-present basis on hasFillCurve").toBeTruthy();
    const trimmed = lit!.trim();
    // The section tests the literal as a regex, so its dots are escaped there.
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(s4g).toContain(escaped);
    // And it requires agreement in BOTH directions: named iff served.
    expect(s4g).toMatch(/served\s*\?\s*names\s*:\s*!names/);
  });

  it("the age bar §4g applies to fillCurve.asOf is the same MAX_CURVE_AGE_H §4e applies to the cache", () => {
    const graded = bodies(s4g).filter(verdicts);
    expect(graded.length).toBeGreaterThan(0);
    expect(graded.some((b) => b.includes("MAX_CURVE_AGE_H") && b.includes("asOf"))).toBe(true);
  });
});

describe("public-api dates the curve with the part's own stamp", () => {
  const ROWS = [{ category: "engineering", n_at_risk_14: 300, window_days: 90 }];

  it("a bare array is served, dated by the sibling stamp when present and the cache root otherwise", () => {
    expect(fillCurveFromCache({ fill_curve: ROWS, computed_at: "2026-09-27T23:12:00Z" })).toEqual({
      rows: ROWS,
      asOf: "2026-09-27T23:12:00Z",
      carriedForward: false,
    });
    expect(
      fillCurveFromCache({ fill_curve: ROWS, fill_curve_computed_at: "2026-09-27T21:12:00Z", computed_at: "2026-09-27T23:12:00Z" })!.asOf,
    ).toBe("2026-09-27T21:12:00Z");
  });

  it("the {computed_at, rows} shape is served dated by ITS stamp, which beats every other", () => {
    const r = fillCurveFromCache({
      fill_curve: { computed_at: "2026-09-27T20:12:00Z", rows: ROWS },
      fill_curve_computed_at: "2026-09-27T21:12:00Z",
      computed_at: "2026-09-27T23:12:00Z",
    });
    expect(r).toEqual({ rows: ROWS, asOf: "2026-09-27T20:12:00Z", carriedForward: false });
  });

  it("stale_parts naming the curve marks it carried forward, and the stamp stays the earlier one", () => {
    const r = fillCurveFromCache({
      fill_curve: { computed_at: "2026-09-27T20:12:00Z", rows: ROWS },
      stale_parts: ["fill_curve"],
      computed_at: "2026-09-27T23:12:00Z",
    });
    expect(r?.carriedForward).toBe(true);
    expect(r?.asOf).toBe("2026-09-27T20:12:00Z");
    expect(fillCurveFromCache({ fill_curve: ROWS, stale_parts: ["actively_hiring"], computed_at: "2026-09-27T23:12:00Z" })?.carriedForward).toBe(false);
  });

  it("absent, empty, or malformed is null -- never an empty data array", () => {
    expect(fillCurveFromCache(null)).toBeNull();
    expect(fillCurveFromCache([])).toBeNull();
    expect(fillCurveFromCache({ computed_at: "x" })).toBeNull();
    expect(fillCurveFromCache({ fill_curve: [] })).toBeNull();
    expect(fillCurveFromCache({ fill_curve: { computed_at: "x", rows: [] } })).toBeNull();
    expect(fillCurveFromCache({ fill_curve: { computed_at: "x" } })).toBeNull();
    expect(fillCurveFromCache({ fill_curve: "18 rows" })).toBeNull();
    expect(fillCurveFromCache({ fill_curve: [null, 3, "row"] })).toBeNull();
    // Junk rows are dropped, not served.
    expect(fillCurveFromCache({ fill_curve: [null, ROWS[0]], computed_at: "2026-09-27T23:12:00Z" })?.rows).toEqual(ROWS);
    // A stamp that is not a date is no stamp: refused, exactly as the page reader refuses it.
    expect(fillCurveFromCache({ fill_curve: { computed_at: "soon", rows: ROWS }, computed_at: "2026-09-27T23:12:00Z" })).toBeNull();
  });

  it("a cache with no stamp anywhere is not served at all: a figure without a date basis is not published", () => {
    // The page reader refuses the same input as absent; the two runtimes
    // agree, and two-readers-of-one-cache-part-serve-the-same-figure feeds
    // both the same fixtures to prove it.
    expect(fillCurveFromCache({ fill_curve: ROWS })).toBeNull();
    expect(fillCurveFromCache({ fill_curve: ROWS, computed_at: "" })).toBeNull();
    expect(fillCurveFromCache({ fill_curve: ROWS, computed_at: 1727478720 })).toBeNull();
    expect(fillCurveFromCache({ fill_curve: { rows: ROWS } })).toBeNull();
    // ...and never an invented one: the stamp served is always one the cache carried.
    expect(fillCurveFromCache({ fill_curve: ROWS, computed_at: "2026-09-27T23:12:00Z" })?.asOf).toBe("2026-09-27T23:12:00Z");
  });

  it("index.ts reads the part through the normaliser and publishes ITS asOf and carriedForward", () => {
    expect(API).toMatch(/import \{ fillCurveFromCache \} from "\.\/fill-curve-cache\.ts"/);
    expect(API).toMatch(/const fillCurve = fillCurveFromCache\(cache\)/);
    expect(API).toMatch(/const hasFillCurve = fillCurve !== null/);
    const from = API.indexOf("fillCurve: fillCurve");
    expect(from).toBeGreaterThan(-1);
    const block = API.slice(from, API.indexOf("observedDays:", from));
    expect(block).toMatch(/asOf:\s*fillCurve\.asOf/);
    expect(block).toMatch(/carriedForward:\s*fillCurve\.carriedForward/);
    expect(block).not.toMatch(/asOf:\s*cacheAsOf/);
    expect(block).toMatch(/data:\s*fillCurve\.rows\.map/);
    // The root-array-only read that could never see the object shape is gone.
    expect(API).not.toMatch(new RegExp(`Array\\.isArray\\(cache\\?\\.${PART}\\)`));
  });

  it("both basis wordings still exist and the served one is chosen by hasFillCurve", () => {
    expect(API).toMatch(/hasFillCurve\s*\?\s*"[^"]*fillCurve[^"]*"\s*:\s*"[^"]*not serve it yet[^"]*"/);
  });

  it("the version literal moved with the change and the contract probe pins the same literal", () => {
    const v = new RegExp(`const ${VERSION_CONST} = "([^"]+)"`).exec(API)?.[1];
    expect(v).toBeTruthy();
    expect(v! > "2026-09-23.1", `${VERSION_CONST} ${v} must postdate the last bump`).toBe(true);
    const pinned = /apiVersion === "([^"]+)"/.exec(PROBE)?.[1];
    expect(pinned).toBe(v);
  });
});

describe("no guard literal here rests on a comment", () => {
  it("the checks above hold on the comment-stripped script and change nothing when comments are added", () => {
    // The script's comments are prose that names the same things this file
    // guards. Stripping them is what makes the checks read code: adding a
    // comment that quotes the forbidden shape must not move any check.
    const withLie = SCRIPT_RAW.replace(
      /^(echo "== 4e\. [^\n]*)$/m,
      `$1\n# R ${LIVE_FN} '{}' | node -e 'console.log("PASS  ${LIVE_FN} answered")'`,
    );
    expect(withLie).not.toBe(SCRIPT_RAW);
    expect(shellCodeOf(withLie)).toBe(SCRIPT);
    expect(liveCallViolations(shellCodeOf(withLie))).toEqual([]);
    expect(cachePathViolations(shellCodeOf(withLie))).toEqual([]);
  });

  it("this file's own comments carry none of the literals it pins", () => {
    const own = commentsOf(readFileSync(__filename, "utf8"));
    for (const lit of [LIVE_FN, CACHE_FN, PART, RETIRED_HELPER, MS_BAR, AGE_BAR, VERSION_CONST, STATS_PATH, "carriedForward", "hasFillCurve", "asOf:", "cacheAsOf", '"PASS', '"FAIL', '"INFO', "CAT '", "SKIP_LIVE_CURVE"]) {
      expect(own, `a comment in this file spells the guarded literal ${lit}`).not.toContain(lit);
    }
  });
});
