// @vitest-environment node
//
// TWO READERS OF ONE CACHE PART SERVE THE SAME FIGURE.
//
// The hourly stats cache carries the field fill curve as one part, and two
// runtimes read it: the pages through src/lib/fill-curve-cache.ts and the
// public API through supabase/functions/public-api/fill-curve-cache.ts. They
// were written in the same hour by different hands and disagreed on one rule
// before this file existed -- the API served rows dated by nothing when the
// cache carried no stamp, while the page refused the same input as absent.
// A public figure names its date basis or is not published, and a rule that
// holds in one runtime and not the other is the shape of claim drift this
// repository has already paid for (the "no subscriptions" incident): copy
// goes false when the thing it describes moves runtimes.
//
// So the same fixtures go through both readers, and for every one of them
// the two must agree on whether a figure is served, on the stamp it wears,
// and on whether it was carried forward. The one deliberate difference in
// their vocabularies is named as a case of its own rather than left to be
// discovered: a stamped EMPTY array is "ready with no rows" to the page
// (which then renders nothing, the section being gated on having a row) and
// null to the API (which never serves an empty data array). The served
// outcome is the same -- no figure -- and the writer never produces that
// input anyway, because an empty answer is carried forward, not published.
import { describe, expect, it } from "vitest";
import { readCachedFillCurve } from "../lib/fill-curve-cache";
import { fillCurveFromCache } from "../../supabase/functions/public-api/fill-curve-cache";

type Row = Record<string, unknown>;
const ROWS: Row[] = [{ category: "engineering", n_at_risk_14: 300, window_days: 90, still_open_30: 0.5, sufficient: true }];
const RUN = "2026-09-28T00:27:15.000Z";
const ROOT = "2026-09-28T00:27:00.000Z";
const LATER_ROOT = "2026-09-28T01:27:00.000Z";
const SIBLING = "2026-09-27T23:27:14.000Z";
const PART = { computed_at: RUN, variant: { p_days: 90, p_min_n: 300 }, rows: ROWS };

interface Case { name: string; cache: unknown; served: false } 
interface Served { name: string; cache: unknown; served: true; stamp: string; carried: boolean }
const CASES: Array<Case | Served> = [
  { name: "a healthy part with its own stamp", cache: { fill_curve: PART, computed_at: ROOT, stale_parts: [] }, served: true, stamp: RUN, carried: false },
  {
    name: "a carried part: the previous object under a later root, named stale, with the run's error beside it",
    cache: { fill_curve: PART, computed_at: LATER_ROOT, stale_parts: ["fill_curve"], fill_curve_error: { at: LATER_ROOT, reason: "query_canceled", sqlstate: "57014", message: "canceling statement due to statement timeout" } },
    served: true, stamp: RUN, carried: true,
  },
  { name: "another part named stale, not this one", cache: { fill_curve: PART, computed_at: ROOT, stale_parts: ["actively_hiring"] }, served: true, stamp: RUN, carried: false },
  { name: "a bare array dated by a sibling stamp", cache: { fill_curve: ROWS, fill_curve_computed_at: SIBLING, computed_at: ROOT }, served: true, stamp: SIBLING, carried: false },
  { name: "a bare array dated by the root when no sibling stamp exists", cache: { fill_curve: ROWS, computed_at: ROOT }, served: true, stamp: ROOT, carried: false },
  { name: "the first run ever failed: a JSON null under the key", cache: { fill_curve: null, computed_at: ROOT, stale_parts: ["fill_curve"], fill_curve_error: { at: ROOT, reason: "query_canceled" } }, served: false },
  { name: "the key is absent: the arm has not run since the reader was added", cache: { computed_at: ROOT, stale_parts: [], ghost_stats: { total_open: 1 } }, served: false },
  { name: "a part with rows and no stamp anywhere", cache: { fill_curve: { rows: ROWS }, stale_parts: [] }, served: false },
  { name: "a part whose stamp is not a date", cache: { fill_curve: { computed_at: "soon", rows: ROWS }, computed_at: ROOT }, served: false },
  { name: "a bare array with no stamp anywhere", cache: { fill_curve: ROWS }, served: false },
  { name: "rows that are not an array", cache: { fill_curve: { computed_at: RUN, rows: "18 rows" }, computed_at: ROOT }, served: false },
  { name: "a scalar under the key", cache: { fill_curve: "18 rows", computed_at: ROOT }, served: false },
];

describe("served iff served, with the same stamp and the same carried flag", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const api = fillCurveFromCache(c.cache);
      const web = readCachedFillCurve<Row>(c.cache);
      const webServes = web.state === "ready" && web.rows.length > 0;
      expect(api !== null, `the API ${api ? "serves" : "refuses"} what the page ${webServes ? "serves" : "refuses"}`).toBe(webServes);
      expect(webServes).toBe(c.served);
      if (c.served) {
        expect(web.state).toBe("ready");
        if (web.state !== "ready" || api === null) throw new Error("unreachable");
        expect(api.asOf).toBe(c.stamp);
        expect(web.computedAt).toBe(c.stamp);
        expect(api.carriedForward).toBe(c.carried);
        expect(web.carried).toBe(c.carried);
        expect(api.rows).toEqual(web.rows);
      }
    });
  }

  it("neither runtime ever serves a figure without a date basis", () => {
    for (const c of CASES) {
      const api = fillCurveFromCache(c.cache);
      if (api) expect(Number.isNaN(Date.parse(api.asOf)), `${c.name}: the API served an unparseable stamp`).toBe(false);
      const web = readCachedFillCurve<Row>(c.cache);
      if (web.state === "ready") expect(Number.isNaN(Date.parse(web.computedAt)), `${c.name}: the page reader accepted an unparseable stamp`).toBe(false);
    }
  });

  it("a cache that could not be read is refused by both; only the page reader has a word for it", () => {
    for (const cache of [null, undefined, [], "x", 7]) {
      expect(fillCurveFromCache(cache)).toBeNull();
      expect(readCachedFillCurve<Row>(cache).state).toBe("unreadable");
    }
  });

  it("the one named vocabulary difference: a stamped empty array is ready-with-nothing to the page and null to the API, and neither serves a figure", () => {
    const cache = { fill_curve: { computed_at: RUN, rows: [] }, computed_at: ROOT, stale_parts: [] };
    const web = readCachedFillCurve<Row>(cache);
    expect(web.state).toBe("ready");
    if (web.state === "ready") expect(web.rows).toEqual([]);
    expect(fillCurveFromCache(cache)).toBeNull();
    const bare = { fill_curve: [], computed_at: ROOT };
    expect(readCachedFillCurve<Row>(bare).state).toBe("ready");
    expect(fillCurveFromCache(bare)).toBeNull();
  });

  it("junk rows: the API drops them and serves the rest, the page passes the array through, and the stamp still agrees", () => {
    const cache = { fill_curve: { computed_at: RUN, rows: [null, ROWS[0], 3] }, computed_at: ROOT };
    const api = fillCurveFromCache(cache);
    const web = readCachedFillCurve<Row>(cache);
    expect(api?.rows).toEqual(ROWS);
    expect(api?.asOf).toBe(RUN);
    expect(web.state === "ready" && web.computedAt).toBe(RUN);
  });
});
