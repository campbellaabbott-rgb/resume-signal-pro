import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * MISSING A 1.5s DEADLINE BY 190ms COST FIVE SECONDS.
 *
 * The capped count was raced against COUNT_DEADLINE_MS so a slow count could
 * never hold up the page. But withDeadline resolves { data: null } for a
 * timeout, an error AND a missing RPC alike, and the fallback read that single
 * sentinel as "the migration has not applied yet" — then ran the UNBOUNDED
 * inline exact count, the very query the capped RPC exists to replace, while
 * discarding the page it had already fetched concurrently.
 *
 * Reproduced live on an ordinary two-filter browse, same query, same minute:
 *
 *   healthy   count_jobs_capped 210ms   page_query 139ms    tookMs 359
 *   race lost count_jobs_capped 1503ms  page_query 3755ms   tookMs 5448
 *             count_jobs_capped_settle 1693ms — it was 190ms from landing
 *
 * The deadline escalated instead of bounding. A timeout must mean "no count",
 * not "go and get a slower one".
 */
const CODE = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");

describe("a deadline that escalates is not a deadline", () => {
  it("a timeout is distinguishable from a missing RPC", () => {
    // One sentinel for both is what made the escalation possible.
    expect(CODE).toMatch(/let countTimedOut = false;/);
    expect(CODE).toMatch(/kind: "settled"/);
    expect(CODE).toMatch(/if \(outcome\.kind === "timeout"\) countTimedOut = true;/);
  });

  it("a slow count NEVER escalates to the unbounded inline count", () => {
    expect(CODE).toMatch(/const needInlineCount = wantCount && !cappedRes && !countTimedOut;/);
  });

  it("the timed-out request still publishes an honest total", () => {
    // total is `countUnavailable ? null : (count ?? 0)`, so a null count with
    // the flag unset publishes ZERO on a page full of results. Not escalating
    // is only safe because the flag is seeded from the timeout.
    expect(CODE).toMatch(/let countUnavailable = countTimedOut;/);
  });

  it("the deadline miss is logged, not silent", () => {
    // The old behaviour was indistinguishable from a healthy response except by
    // tookMs — which is why it survived in production unnoticed.
    expect(CODE).toMatch(/capped count exceeded \$\{COUNT_DEADLINE_MS\}ms/);
  });

  it("the page fetched alongside the count is reused, not re-fetched", () => {
    expect(CODE).toMatch(/\{ data: firstPage\.data, error: firstPage\.error, count: cappedRes\?\.n \?\? null \}/);
  });
});
