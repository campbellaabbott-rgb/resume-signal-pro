import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PAGINATING PAST THE END COST NINE SECONDS OF DATABASE AND RETURNED A 500.
 *
 * Measured 2026-08-18, minutes after the outage recovery: offset=583921 and
 * offset=999999999 both returned 500 after ~9.1s. Postgres implements OFFSET by
 * walking and discarding every skipped row, so each past-the-end request paid
 * for a scan of the whole corpus — on the same database whose overload was that
 * day's outage — and the caller got an error, which API clients answer by
 * RETRYING. The board UI cannot reach this (60/page); it is scraper and API
 * traffic only, which makes it a pure liability: maximum cost, zero users.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

describe("an offset past the end is an empty page, never a table scan", () => {
  it("returns the empty page BEFORE any query is built", () => {
    const guard = FN.indexOf("const OFFSET_CEILING");
    const query = FN.indexOf("const buildQuery");
    expect(guard, "guard not found").toBeGreaterThan(-1);
    expect(query, "buildQuery not found").toBeGreaterThan(guard);
    // The guard must short-circuit with a response, not just clamp the number —
    // a clamped offset would still run a full page query and misreport the page.
    // 1200, not 600: the exit gained its honesty comment + disclosure spreads
    // (2026-08-30) and the jobs line moved past the old window. The property —
    // a short-circuit RESPONSE before any query — is what matters, not where
    // in the literal it sits.
    const block = FN.slice(guard, guard + 1200);
    expect(block).toMatch(/jobs: \[\], total: unfiltered \? safeMetaTotal : null, hasMore: false/);
  });

  it("bounds by the corpus total AND a hard ceiling, and exempts countOnly", () => {
    const block = FN.slice(FN.indexOf("const OFFSET_CEILING"), FN.indexOf("const OFFSET_CEILING") + 600);
    // The catalog total bounds every query — a filtered set cannot outnumber
    // the corpus. The hard ceiling covers the cache-unreadable case.
    expect(block).toMatch(/offset >= OFFSET_CEILING \|\| \(safeMetaTotal !== null && offset >= safeMetaTotal\)/);
    // countOnly ignores offset and must keep returning totals.
    expect(block).toMatch(/!countOnly &&/);
  });
});
