import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A CHAIN WHOSE LIVENESS IS NOT IN STATUS IS A CHAIN WHOSE DEATH IS A RESEARCH
 * PROJECT — this file's own words, written about its OTHER chains.
 *
 * Every maintenance track here got a liveness stamp and stall detection after
 * two of them stalled invisibly overnight and could only be diagnosed by
 * inference from posting counts. The refresh chain — the one carrying the
 * freshness SLA — got neither. On 2026-08-26 that cost an hour of cursor
 * sampling to answer "are cold slices chaining at all", and the first answer
 * was wrong: a single 422-second sample said one slice per 7 minutes, while the
 * truth was 8 slices in 10 minutes.
 *
 * The gap mattered because `cursor` and `lastSliceAgeMin` look IDENTICAL
 * whether slices arrive from a self-sustaining chain or from one cron kick
 * every ten minutes — a 5-8x throughput difference reported as the same
 * numbers.
 *
 * Three ways a hop died with no signal, each pinned below.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const CHAIN = CODE.slice(CODE.indexOf("function chainNextSlice("), CODE.indexOf("async function runRefresh("));

describe("a chain whose death is invisible", () => {
  it("the outer rejection handler no longer swallows", () => {
    // `.catch(() => {})` was applied BEFORE waitUntil received the promise, so
    // waitUntil's own console.warn could never fire either. A DNS failure, a
    // TLS error or an abort from isolate teardown produced zero log lines in
    // either isolate.
    expect(CHAIN, "the chain kick still swallows its rejections").not.toMatch(/\}\)\(\)\.catch\(\(\) => \{\}\)\);/);
    expect(CHAIN).toMatch(/console\.error\("\[JOB-BOARD\] chain kick failed outside its own handler:"/);
  });

  it("a non-2xx response is treated as a failure, not a continuation", () => {
    // A 500 or a chainKey rejection is not a rejected fetch promise — it is a
    // perfectly ordinary Response, and nothing was reading its status.
    expect(CHAIN).toMatch(/!r\.ok \? "http_error"/);
    expect(CHAIN).toMatch(/status: r\.status/);
  });

  it("a 200 that DECLINED is not reported as a continuation", () => {
    // The worst case, because it looks healthiest: the child answers 200 with
    // "skipped — a slice ran moments ago" or "ingest paused", the chain stops,
    // and nothing anywhere is an error.
    expect(CHAIN).toMatch(/const declined = \/skipped\|paused\|unknown action\|chainkey\|not authori\/i\.test\(body\)/);
    expect(CHAIN).toMatch(/declined \? "declined" : "continued"/);
  });

  it("every non-continuation is logged with enough to act on", () => {
    expect(CHAIN).toMatch(/chain did NOT continue past hop \$\{hop\}: \$\{outcome\} status=\$\{r\.status\} body=\$\{body\}/);
    expect(CHAIN).toMatch(/chain kick threw at hop/);
  });

  it("ONE writer, one key — the divergence trap this schema already paid for", () => {
    // A meta row written from two sites diverges: an upsert replaces the whole
    // `v`, and that silently zeroed a counter and killed a lane for good.
    expect((CODE.match(/k: "chain_kick"/g) ?? []).length,
      "chain_kick is written from more than one place").toBe(1);
    expect(CHAIN).toMatch(/onConflict: "k"/);
  });

  it("instrumentation can never be the thing that breaks the chain", () => {
    // A stamp that throws must not stop the hop it is describing.
    // Structure, not the comment: CODE has block comments stripped, so an
    // assertion written against the comment tests the stripper, not the code.
    const stampFn = CHAIN.slice(CHAIN.indexOf("const stamp = async"), CHAIN.indexOf("waitUntil(("));
    expect(stampFn, "the stamp helper is not wrapped at all").toMatch(/try \{/);
    expect(stampFn, "a failing stamp can propagate into the chain").toMatch(/\} catch \{/);
    expect(stampFn).toMatch(/if \(!client\) return;/);
  });

  it("status can answer 'is the chain alive' in one read", () => {
    expect(CODE).toMatch(/chainKick: \(\(\) => \{/);
    for (const f of ["outcome", "fromHop", "ageMin"]) {
      expect(CODE, `status.chainKick is missing ${f}`).toMatch(new RegExp(`${f}:`));
    }
    // Freshness of the stamp matters as much as its value: a chain that stopped
    // leaves a LAST outcome that may read "continued" forever.
    expect(CODE).toMatch(/ageMin: at \? Math\.round\(\(Date\.now\(\) - new Date\(at\)\.getTime\(\)\) \/ 60_000\) : null/);
  });

  it("the status read is APPENDED, never inserted mid-array", () => {
    // This array is positionally destructured; a read added in the middle
    // silently shifts every variable after it onto the wrong result, which has
    // happened here before.
    // The anchor names the array TAIL, so it moves whenever a read is
    // appended — which is the rule working, not the guard breaking (.45
    // appended sliceStatsRow and this anchor moved with it).
    const arr = CODE.slice(CODE.indexOf("hwMeta, deepCur, chainKick, sliceStatsRow] = await Promise.all(["));
    const deep = arr.indexOf('eq("k", "deep_cursor")');
    const chain = arr.indexOf('eq("k", "chain_kick")');
    const sliceRead = arr.indexOf('eq("k", "slice_stats")');
    expect(deep).toBeGreaterThan(-1);
    expect(chain, "chain_kick was inserted before an existing read").toBeGreaterThan(deep);
    expect(sliceRead, "slice_stats was inserted before an existing read — every later variable shifts").toBeGreaterThan(chain);
  });
});
