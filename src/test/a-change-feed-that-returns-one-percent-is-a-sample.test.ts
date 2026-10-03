import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * /v1/changes is the endpoint nobody can copy, and it was returning ~1% of a day.
 *
 * A live feed can say what is open today; only a corpus that has been watching
 * can say what CLOSED. Its own header comment calls it "the endpoint the rest of
 * the API exists to make credible" — and it had no pagination of any kind.
 * `opened` and `closed` were each capped at 100 rows, ordered NEWEST FIRST, and
 * the response said nothing about truncation. Against the board's own boardFlow
 * for 24 hours — 143,418 opened, 111,770 closed — a client got 100 of each and
 * no way to know, or to ask for more.
 *
 * Newest-first is also the wrong order for the one job this endpoint has: the
 * page you can reach is the page you already had. A change feed is walked
 * FORWARD from a watermark.
 */
const API = readFileSync(
  resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8");

describe("a change feed that returns one percent is a sample", () => {
  it("walks forward, not backward", () => {
    expect(API).toMatch(/openedQ\.order\("first_seen", \{ ascending: true \}\)\.order\("id", \{ ascending: true \}\)/);
    expect(API).toMatch(/closedQ\.order\("closed_at", \{ ascending: true \}\)\.order\("event_id", \{ ascending: true \}\)/);
  });

  it("says when it truncated — the difference between a feed and a sample", () => {
    expect(API).toMatch(/const openedMore = openedRows\.length === limit;/);
    expect(API).toMatch(/const closedMore = closedRows\.length === limit;/);
    expect(API).toMatch(/hasMore: openedMore,/);
    expect(API).toMatch(/hasMore: closedMore,/);
  });

  it("pages each list independently, on a key that cannot tie", () => {
    // One cursor over both would stall the faster list behind the slower one.
    // event_id is `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, so
    // (closed_at, event_id) is a total order; (first_seen, id) likewise.
    expect(API).toMatch(/opened_cursor/);
    expect(API).toMatch(/closed_cursor/);
    expect(API).toMatch(/first_seen\.gt\.\$\{openedAfter\.ep\},and\(first_seen\.eq\.\$\{openedAfter\.ep\},id\.gt\.\$\{openedAfter\.id\}\)/);
    expect(API).toMatch(/closed_at\.gt\.\$\{closedAfter\.ep\},and\(closed_at\.eq\.\$\{closedAfter\.ep\},event_id\.gt\.\$\{closedAfter\.id\}\)/);
    // A cursor we did not issue is a 400, not a silently ignored parameter.
    expect(API).toMatch(/opened_cursor is not a cursor this API issued/);
    expect(API).toMatch(/closed_cursor is not a cursor this API issued/);
  });

  it("sells depth, not just throughput", () => {
    // key_tier reached the function and was never read, so the only difference
    // between a free key and a paid one was requests per minute — the weakest
    // pitch available for a dataset whose value is its history.
    expect(API).toMatch(/const CHANGES_MAX_DAYS_PAID = \d+;/);
    expect(API).toMatch(/const paid = isPaidKeyTier\(tier\);/);
    expect(API).toMatch(/changes\(client, url, rateHeaders, d\.key_tier\)/);
    // And the depth is published, so a customer can see what they have —
    // BOTH bounds, because they are no longer the same number.
    expect(API).toMatch(/closureHistoryDays: closureMaxDays,/);
    expect(API).toMatch(/openedHistoryDays: maxDays,/);

    // THE FREE CLOSURE WINDOW IS THE PRODUCT'S ONLY REAL FENCE, so it is pinned
    // as a PROPERTY and not as a spelling. `maxDays` gated opened[] and
    // closed[] together, so a free key could walk thirty days of full closure
    // rows — 100 a page against a 1,000-call daily quota, on a signup that
    // verifies no email — which is enough to bootstrap and then maintain a
    // rival ledger for nothing. A closed posting is on no public page, so that
    // is the one population here that cannot be re-fetched from source.
    expect(API).toMatch(/const CLOSURES_MAX_DAYS_FREE = \d+;/);
    const freeDays = Number(API.match(/const CLOSURES_MAX_DAYS_FREE = (\d+);/)![1]);
    const paidDays = Number(API.match(/const CHANGES_MAX_DAYS_PAID = (\d+);/)![1]);
    expect(freeDays, "a free key must not reach as far back as a paid one").toBeLessThan(paidDays);
    expect(freeDays, "72 hours answers 'what came down since my last sync' and bootstraps nothing").toBeLessThanOrEqual(3);

    // The binding itself, which is where a regression would actually land: the
    // closure query must read the CLOSURE floor, never the caller's raw since.
    expect(API).toMatch(/\.gte\("closed_at", closureSinceIso\)/);
    expect(API, "re-binding closed_at to sinceIso reopens the leak").not.toMatch(/\.gte\("closed_at", sinceIso\)/);
    // A narrowing this API applies must be one the caller can see.
    expect(API).toMatch(/closureSince: closureSinceIso,/);
    expect(API).toMatch(/closureWindowNarrowed: closureNarrowed,/);
  });

  it("refuses a parameter it does not understand", () => {
    // `?county=US` used to return the whole corpus as a normal 200 that reads
    // like a filtered answer — a month of confidently wrong downstream numbers
    // before anyone notices.
    expect(API).toMatch(/function rejectUnknownParams\(/);
    expect(API).toMatch(/"unknown_parameter"/);
    for (const list of ["JOBS_PARAMS", "CHANGES_PARAMS", "COMPANIES_PARAMS"]) {
      expect(API, `${list} must exist and be enforced`).toContain(list);
    }
    expect((API.match(/rejectUnknownParams\(url, /g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("lets a browser read the headers it documents", () => {
    // A non-simple response header is invisible to JS unless exposed, so every
    // rate/quota/version header was unreadable by exactly the callers most
    // likely to need them — and the documented If-None-Match flow died at
    // preflight because the request header was not allowed.
    expect(API).toMatch(/"Access-Control-Expose-Headers":/);
    for (const h of ["ETag", "Retry-After", "X-RateLimit-Remaining", "X-Quota-Remaining", "X-Api-Version"]) {
      expect(API, `${h} must be exposed`).toMatch(new RegExp(`Expose-Headers"[\\s\\S]{0,200}${h}`));
    }
    expect(API).toMatch(/Allow-Headers": "[^"]*if-none-match/);
  });
});
