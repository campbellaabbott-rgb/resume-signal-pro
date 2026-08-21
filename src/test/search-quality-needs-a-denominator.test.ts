import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SIX list exits since routed retrieval landed (recency, ranked, fuzzy,
 * semantic, exact-word, routed). The count is asserted rather than a minimum
 * precisely so that adding an exit FAILS here and forces every disclosure
 * onto it — which is what happened, again, and is why this number keeps
 * moving.
 *
 * A TELEMETRY TABLE THAT RECORDS NOTHING LOOKS EXACTLY LIKE A QUIET WEEK.
 *
 * This board could not measure its own search. Every relevance judgement made
 * about it — mine, a reviewer's, an agent's — was a person eyeballing a result
 * page, which is not evidence and does not scale. Seven real search defects
 * were found by hand today; each was invisible until somebody happened to type
 * the right query.
 *
 * What existed was HALF a loop: job_board_search_misses records queries that
 * came back empty, on the ranked route only. No denominator, no successes, and
 * — confirmed by enumerating every job_board_* table — no record anywhere of
 * which posting a searcher actually opened.
 *
 * These assertions pin the four ways this specific feature fails silently,
 * each drawn from something that already went wrong in this repo:
 *
 *  1. LOGGING ONE PATH. Five separate fixes in two days shipped to one of the
 *     four query paths and silently skipped the others. A search log missing
 *     the recency path would under-count every browse and bias the denominator
 *     toward searchers, making the zero-result rate look better than it is.
 *  2. SWALLOWED WRITES. The checkout funnel recorded NOTHING for weeks because
 *     bad-visitorId 400s were caught and dropped. An insert whose error is
 *     discarded produces an empty table and a healthy-looking system.
 *  3. RAW BEHAVIOURAL DATA LEFT READABLE. Two ledgers were found anon-readable
 *     this week. This is visitor behaviour and must not become the third.
 *  4. AN AGGREGATE THAT CANNOT SAY "NO DATA". Four RPCs in this schema compute
 *     ELSE 100 on an empty denominator, so a health check can never fire when
 *     telemetry stops. A zero-result rate with that bug would report perfect
 *     health precisely when it had stopped recording.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const UI = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const MIG = (() => {
  const f = readdirSync(MIG_DIR).find((x) => x.includes("search_quality_needs_a_denominator"));
  expect(f, "the search-telemetry migration is missing").toBeTruthy();
  return readFileSync(resolve(MIG_DIR, f!), "utf8");
})();

describe("search quality has a denominator and an outcome", () => {
  it("logs ALL FOUR query paths, not the one that happened to be edited", () => {
    // The exact-word tier logs as route "ranked" with rescued "fuzzy" — it is a
    // rescue on the ranked path, not a fifth route, so the ROUTE set is
    // unchanged while the call count rises. Both are asserted: the set catches
    // a path that stopped logging, the count catches an exit that never started.
    const routes = [...FN.matchAll(/logSearch\("(\w+)"/g)].map((m) => m[1]);
    expect(
      [...new Set(routes)].sort(),
      "every list return must log. A missing path is an invisible hole in the denominator.",
    ).toEqual(["fuzzy", "ranked", "recency", "semantic"]);
    expect(routes.length, "six list exits, six logSearch calls").toBe(6);
  });

  it("issues a search id and returns it on every list response", () => {
    expect(/const searchId = crypto\.randomUUID\(\)/.test(FN), "no server-issued search id").toBe(true);
    // Four list returns, four echoes. Without the id on a response, a click
    // from that path can never be attributed and its results are unmeasurable.
    expect(
      (FN.match(/^\s*searchId,$/gm) ?? []).length,
      "searchId must be returned by all SIX list paths — a click on a page that " +
        "carries no search id can never be attributed to the search that produced it",
    ).toBe(6);
  });

  it("does not swallow a failed write", () => {
    // The specific shape that produced an empty analytics table: .catch(() => {}).
    const events = /job_board_search_events"\)\.insert\(\{[\s\S]*?\}\)\.then\(\(\{ error \}\) => \{[\s\S]*?console\.warn/.test(FN);
    const clicks = /job_board_search_clicks"\)\.insert\(\{[\s\S]*?\}\)\.then\(\(\{ error \}\) => \{[\s\S]*?console\.warn/.test(FN);
    expect(events, "the search-event insert must report its error, not drop it").toBe(true);
    expect(clicks, "the click insert must report its error, not drop it").toBe(true);
  });

  it("never blocks the visitor on telemetry", () => {
    // Both writes go through waitUntil. A logging stall must not cost a search.
    expect(/waitUntil\(Promise\.resolve\(\s*client\.from\("job_board_search_events"\)/.test(FN)).toBe(true);
    expect(/waitUntil\(Promise\.resolve\(\s*client\.from\("job_board_search_clicks"\)/.test(FN)).toBe(true);
  });

  it("keeps the raw behavioural rows private and exposes only aggregates", () => {
    for (const t of ["job_board_search_events", "job_board_search_clicks"]) {
      expect(
        new RegExp(String.raw`ALTER TABLE public\.${t} ENABLE ROW LEVEL SECURITY`).test(MIG),
        `${t} must have RLS enabled`,
      ).toBe(true);
      // No policy, and no SELECT grant to anon — a GRANT is not what restricts,
      // but a lingering one is how a table gets reopened by the next policy.
      expect(
        new RegExp(String.raw`CREATE POLICY[^;]*ON\s+public\.${t}`, "i").test(MIG),
        `${t} must not carry a read policy`,
      ).toBe(false);
      expect(
        new RegExp(String.raw`GRANT[^;]*\bON\s+public\.${t}\s+TO[^;]*\banon\b`, "i").test(MIG),
        `${t} must never be granted to anon`,
      ).toBe(false);
    }
  });

  it("exposes the aggregates as DEFINER, or they report zero instead of failing", () => {
    for (const fn of ["get_search_quality", "get_top_search_misses"]) {
      const m = new RegExp(
        String.raw`CREATE OR REPLACE FUNCTION public\.${fn}\([\s\S]*?\$\$`,
      ).exec(MIG);
      expect(m, `${fn} not found`).not.toBeNull();
      expect(
        /SECURITY DEFINER/.test(m![0]),
        `${fn} reads an RLS-locked table. As INVOKER it returns HTTP 200 with a ` +
          `zeroed aggregate — indistinguishable from "the data says zero", which ` +
          `published "0 closures" on /hiring-trends for two days this week.`,
      ).toBe(true);
    }
  });

  it("reports NULL, never a flattering literal, when the denominator is empty", () => {
    // The ELSE-100 pattern four other RPCs here carry: a rate of 100% computed
    // from zero events, so no alert can fire when logging stops.
    const body = /CREATE OR REPLACE FUNCTION public\.get_search_quality[\s\S]*?\$\$;/.exec(MIG)?.[0] ?? "";
    expect(body, "get_search_quality body not found").not.toBe("");
    expect(
      /ELSE\s+(100|0)\b/i.test(body),
      "a rate must be NULL on an empty denominator, not a literal that reads as health",
    ).toBe(false);
    expect((body.match(/CASE WHEN count\(\*\) > 0/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("measures position ABSOLUTELY, so page two is not full of first-place clicks", () => {
    expect(
      /rank: offset \+ i \+ 1/.test(UI),
      "rank must be offset-based; a page-relative index makes click-through-at-5 meaningless",
    ).toBe(true);
    // Stamped per ROW, not read off the response: jobs accumulate across pages
    // while the response holds only the latest, so a response-level id would
    // credit a page-one click to the search that fetched page three.
    expect(/searchId: br\.searchId,/.test(UI)).toBe(true);
  });

  it("logs an open only when someone actually chose it", () => {
    // openDetail fires per keystroke while arrowing the list and again on
    // deep-link restore. Logging those would bury the signal and inflate CTR.
    expect(
      /if \(urlMode === "push"\) trackClick\(job, "open"\)/.test(UI),
      "opens must be gated to deliberate clicks",
    ).toBe(true);
  });

  it("is verifiable from outside, without exposing what people typed", () => {
    // The tables are RLS-locked and the aggregate is service-role only — both
    // correct. But that made "is it actually recording?" unanswerable with the
    // anon key, and a telemetry table nobody can read is indistinguishable from
    // one that records nothing. Shipping the unverifiable version of a feature
    // built to prevent silent non-recording would have been absurd.
    const blk = /if \(action === "searchQuality"\)[\s\S]*?\n    \}\n/.exec(FN)?.[0] ?? "";
    expect(blk, "no searchQuality action — the telemetry cannot be checked from outside").not.toBe("");
    expect(/get_search_quality/.test(blk)).toBe(true);
    // "nothing recorded" must be reported as such, not as a zeroed summary that
    // reads like health.
    expect(/recording: rows\.length > 0/.test(blk), "an empty result must be reported as not-recording").toBe(true);
    // Counts and rates only. People type their own names, employers and
    // locations into a search box, so the raw-query aggregate stays private.
    expect(
      /get_top_search_misses/.test(blk),
      "raw query strings must not be exposed through the public action",
    ).toBe(false);
  });

  it("records a click even when the search id is missing or malformed", () => {
    // Dropping un-attributed clicks would bias every rate toward searchers, and
    // a bad uuid would fail the whole INSERT and lose the click outright.
    const blk = /if \(action === "click"\)[\s\S]*?\n    \}\n/.exec(FN)?.[0] ?? "";
    expect(blk, "click action not found").not.toBe("");
    expect(/\? rawSid : null/.test(blk), "a non-uuid searchId must degrade to null, not throw").toBe(true);
    expect(/if \(!postingId\)/.test(blk), "postingId is the only hard requirement").toBe(true);
  });
});
