import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ADDING A FILTER MADE A SEARCH RETURN MORE.
 *
 *   {"country":"PT","q":"manager"}                     -> 234
 *   {"country":"PT","q":"manager","workMode":"hybrid"} -> 266
 *
 * A strict subset, thirty-two rows LARGER, and 51 of the first 100 titles were
 * not manager jobs at all — Data Engineer, Data Steward, Security Officer,
 * Purchasing Intern. search_jobs counted title matches AFTER the caller's
 * filters bound, then escalated to the title-or-description vector when that
 * count fell under a threshold. So a NARROWING filter changed which rows could
 * match, and the count followed the widened predicate.
 *
 * FOUR DISCRIMINATORS WERE TRIED AND ALL FOUR FAILED, over 80 measured terms:
 * unfiltered title count (collapses filtered skill searches — aws+PT 93 -> 2),
 * title/description self-ratio (no gap: hvac 20.8% vs manager 28.1%), corpus
 * fraction of descriptions (4-6x overlap — compliance boilerplate like `ada`,
 * `eeo` and `drug screen` is RARER than genuinely useful terms like tableau and
 * forklift), and collocation lift (inverts — boilerplate phrases are strong
 * collocations by definition).
 *
 * The threshold was never the answer, because the question was never
 * monotonicity. Filters are conjuncts, so ANY fixed tier is monotone. The
 * defect was that ONE number was being asked to mean two different things.
 *
 * SO THE RESULT HAS TWO SEGMENTS AND SAYS SO. The published total is the EXACT
 * count — titles that match — and it shrinks under every filter. A second
 * figure carries the description-only matches, and it shrinks too. Rows are
 * labelled with which segment they came from. PT+manager+hybrid now reads
 * "72 exact and 194 where the term appears in the description" instead of
 * claiming 266 matches, and aws+PT keeps its 91 related rows instead of losing
 * them to a threshold.
 *
 * WHICH MOVES THE HAZARD TO THE CLIENT, and that is what this file guards.
 * `total` means something narrower than it used to, so every reader of it that
 * meant "how many results" is now wrong on any query matching only in
 * descriptions — and that is not a rare shape: 26 of 40 measured country x
 * skill combinations have zero exact matches and a full page of related ones.
 * The worst of them was measured: /jobs/company/bayada with q="benefits" is 0
 * title matches and 1,314 description matches, and the lander would have
 * printed "BAYADA has no open roles on their job board at the moment" directly
 * above 1,314 BAYADA roles, on an indexed page.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");

describe("a zero exact count is not an empty page", () => {
  it("the rescue gate counts ROWS, not the headline", () => {
    // This gate guards the typo and semantic tiers, and every one of them
    // RETURNS EARLY with its own result set. A query with no title matches and
    // 39 description matches has a total of 0 and a full page — the old test
    // would have thrown those rows away and served a spelling correction for a
    // query that needed none.
    expect(FN).toMatch(/if \(ranked\.length === 0 && offset === 0 && !countOnly\) \{/);
    expect(FN).not.toMatch(/if \(total === 0 && offset === 0 && !countOnly\) \{/);
  });

  it("paging and augmentation both reason about the whole page", () => {
    // Anything still keyed on the exact segment alone stops paging the moment
    // the exact rows run out, stranding the related ones behind it.
    expect(FN).toMatch(/pageTotal !== null && offset \+ rankedGrouped\.rawConsumed < pageTotal/);
    expect(FN).toMatch(/pageTotal < FUZZY_AUGMENT_BELOW/);
  });

  it("the second segment is omitted, never zeroed", () => {
    // undefined means "this build did not compute a second segment"; 0 means
    // "it did, and found none". Collapsing them makes a real zero
    // indistinguishable from an old build, and the client renders "37 exact and
    // 0 in the description" — noise presented as disclosure.
    // Emitted through a conditional spread, so the key is ABSENT when there is
    // no second segment rather than present as zero. Both call sites — the
    // count exit and the ranked list exit — must do it the same way.
    const spreads = FN.match(/: \{ relatedTotal: \w+, \.\.\.\(/g) ?? [];
    expect(spreads.length, "both exits must spread the second segment conditionally").toBe(2);
    expect(FN).not.toMatch(/relatedTotal: 0,/);
  });

  it("the company lander decides emptiness from BOTH segments", () => {
    // The ship-blocker. Both branches, or the page contradicts itself.
    expect(JOBS).toMatch(/landerCompany && \(\(data\?\.total \?\? 0\) \+ \(data\?\.relatedTotal \?\? 0\)\) > 0 &&/);
    expect(JOBS).toMatch(/landerCompany && \(\(data\?\.total \?\? 0\) \+ \(data\?\.relatedTotal \?\? 0\)\) === 0 &&/);
    // And no branch may go back to reading the exact segment as "any results".
    expect(JOBS).not.toMatch(/landerCompany && data\?\.total === 0 &&/);
    expect(JOBS).not.toMatch(/landerCompany && typeof data\?\.total === "number" && data\.total > 0/);
  });

  it("every headline branch shares one definition of how many", () => {
    // Four branches, one meaning. Patching one and leaving three is how the
    // lander ends up reading "Showing 60 of 0".
    expect(JOBS).toMatch(/const pageTotalCount = \(data\?\.total \?\? 0\) \+ \(data\?\.relatedTotal \?\? 0\)/);
    const summary = JOBS.slice(JOBS.indexOf("jobsPage.resultsSummaryNoTotal"), JOBS.indexOf("jobsPage.resultsSummary\","));
    expect(summary, "the results summary block moved").not.toBe("");
    expect((summary.match(/pageTotalCount/g) ?? []).length,
      "each branch that prints a total must use the shared figure").toBeGreaterThanOrEqual(2);
    // The old per-branch expression must be gone, in every branch.
    expect(JOBS).not.toMatch(/: \(data\?\.total \?\? jobs\.length\)\.toLocaleString\(\),/);
  });

  it("load more can reach the related segment", () => {
    expect(JOBS).toMatch(/jobs\.length < pageTotalCount/);
    expect(JOBS).not.toMatch(/jobs\.length < data\.total\b/);
  });

  it("the zero-result rescue does not fire under a screen full of results", () => {
    // Without the rows term, every description-only search burned a four-probe
    // countOnly burst to offer "remove a filter" help beneath results the
    // visitor was already reading.
    expect(JOBS).toMatch(/data\.total !== 0 \|\| jobs\.length > 0\) \{ setZeroHelp\(null\); return; \}/);
  });

  it("the relaxation buttons count both segments before they are filtered out", () => {
    // Counting the exact segment only would advertise "1 opening" for a
    // relaxation that surfaces 94 rows — or drop the button entirely when the
    // relaxation surfaces only description matches, which is exactly the case a
    // stuck visitor most needs offered.
    expect(JOBS).toMatch(/count: \(r\?\.total \?\? 0\) \+ \(r\?\.relatedTotal \?\? 0\)/);
    expect(JOBS).toMatch(/relatedTotal\?: number; countCapped\?: boolean; relatedCapped\?: boolean/);
  });

  it("a description-only row says so, once", () => {
    expect(JOBS).toMatch(/matchScope\?: "title" \| "description";/);
    expect(JOBS).toMatch(/jobsPage\.descriptionMatchChip/);
    // Not on a row that already carries the close-match hedge — two hedges on
    // one card say less than one.
    expect(JOBS).toMatch(/matchScope === "description" && !\(job as \{ closeMatch\?: boolean \}\)\.closeMatch/);
  });

  it("the split is disclosed only when there IS a second segment", () => {
    expect(JOBS).toMatch(/typeof data\?\.relatedTotal === "number" && data\.relatedTotal > 0 &&/);
    expect(JOBS).toMatch(/jobsPage\.resultsSummarySegmented/);
  });
});
