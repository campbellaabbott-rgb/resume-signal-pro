import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planRankedPage, RANKED_WINDOW, RING_WINDOW } from "../../supabase/functions/job-board/paging";
import { filterViolations, normalizeFilters, type AppliedFilters } from "../../supabase/functions/job-board/filters";

/**
 * THE 2026-08-29 SIX-LENS SWEEP, PINNED. 31 confirmed findings, five distinct
 * HIGH defects, every one of them a number or a page the board published that
 * its own serving path then contradicted. Each fix here has the property the
 * sweep existed to check: the below-seam window and the deep regime partition
 * the advertised result set — no rank served twice, none skipped — and every
 * published count survives the page that renders under it.
 */

const BOARD = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const MIG = readFileSync(resolve(__dirname, "../../supabase/migrations/20260829120000_a_pipe_is_not_a_place.sql"), "utf8");

describe("the ring-merged seam partitions the result set", () => {
  it("ring seam sits at RING_WINDOW and deep pages map back onto SQL rank", () => {
    expect(RING_WINDOW).toBe(400);
    // Sub-seam: fixed window at rank 0, sliced at the caller's offset, clamped
    // at the seam. Deep: SQL offset = offset - (RING_WINDOW - RANKED_WINDOW),
    // so the first deep page resumes at exactly the rank the pool's SQL
    // content ended on.
    const sub = planRankedPage({ offset: 360, fetchLimit: 180, scoreRanked: true, newestFirst: false, deepPageable: true, ringMerged: true });
    expect(sub.deepPage).toBe(false);
    expect(sub.pOffset).toBe(0);
    expect(sub.sliceStart).toBe(360);
    expect(sub.sliceEnd).toBe(RING_WINDOW);
    const deep = planRankedPage({ offset: 400, fetchLimit: 180, scoreRanked: true, newestFirst: false, deepPageable: true, ringMerged: true });
    expect(deep.deepPage).toBe(true);
    expect(deep.pOffset).toBe(RANKED_WINDOW);
    const deeper = planRankedPage({ offset: 460, fetchLimit: 180, scoreRanked: true, newestFirst: false, deepPageable: true, ringMerged: true });
    expect(deeper.pOffset).toBe(260);
  });

  it("walking every offset across the ring seam leaves no overlap and no hole in SQL rank", () => {
    // The pool below the seam holds SQL ranks 0..199 (plus ring rows the deep
    // regime drops by id). So the SQL ranks the deep regime consumes must be
    // exactly 200, 201, ... with no rank repeated and none skipped, for every
    // limit — including ones that do not divide the seam.
    for (const limit of [20, 60, 67, 100]) {
      let offset = 400; // the seam jump lands here from the sub-seam regime
      let nextRank = RANKED_WINDOW;
      for (let step = 0; step < 30; step++) {
        const plan = planRankedPage({ offset, fetchLimit: limit, scoreRanked: true, newestFirst: false, deepPageable: true, ringMerged: true });
        expect(plan.deepPage).toBe(true);
        expect(plan.pOffset, `limit ${limit} offset ${offset}: deep page must resume at the next unserved SQL rank`).toBe(nextRank);
        nextRank += limit; // a page with no dropped ring rows consumes `limit` raw rows
        offset += limit;
      }
    }
  });

  it("a non-ring query keeps the 200 seam untouched", () => {
    const plan = planRankedPage({ offset: 200, fetchLimit: 180, scoreRanked: true, newestFirst: false, deepPageable: true });
    expect(plan.deepPage).toBe(true);
    expect(plan.pOffset).toBe(200);
    const below = planRankedPage({ offset: 180, fetchLimit: 180, scoreRanked: true, newestFirst: false, deepPageable: true });
    expect(below.sliceEnd).toBe(RANKED_WINDOW);
  });

  it("index.ts wires the ring as merge below the seam and exclusion set above it", () => {
    expect(BOARD).toMatch(/const ringMerged = scoreRanked && headTermRing && deepPageable;/);
    expect(BOARD, "the plan must receive ringMerged or the seam silently returns to 200")
      .toMatch(/planRankedPage\(\{ offset, fetchLimit, scoreRanked, newestFirst, deepPageable, ringMerged \}\)/);
    expect(BOARD, "deep pages must drop ring ids — they were served below the seam")
      .toMatch(/if \(deepPage && ringMerged\) \{/);
    expect(BOARD, "dropped rows still occupied SQL ranks; nextOffset advances by RAW rows")
      .toMatch(/deepRingRawUsed/);
    expect(BOARD, "the pool-exhausting page must hand the walk to the FIXED seam")
      .toMatch(/nextOffset: poolExhausted \? RING_WINDOW : offset \+ rankedGrouped\.rawConsumed,/);
    expect(BOARD, "the ring promise must also fire on deep ring-merged pages")
      .toMatch(/\(scoreRanked && headTermRing && \(!deepPage \|\| ringMerged\)\)/);
  });
});

describe("intent lifts anchor on word boundaries — as escapes, not as bytes", () => {
  it("no raw backspace byte anywhere in the function source", () => {
    // The six employment-type lifts shipped with LITERAL 0x08 characters where
    // \b belonged — invisible in every editor, matching only queries containing
    // actual backspaces, i.e. never. Fifth member of the invisible-spelling
    // class the guard-literals tests exist for.
    expect(BOARD.includes("\b"), "a raw 0x08 in a regex is a backspace, not a word boundary").toBe(false);
  });

  it("each employment-type lift carries two-character \\b anchors on both sides", () => {
    for (const re of [
      "/\\bpart[- ]?time\\b/i",
      "/\\bfull[- ]?time\\b/i",
      "/\\binternships?\\b/i",
      "/\\binterns?\\b/i",
      "/\\btemporary\\b/i",
      "/\\bcontract(?:or|ing)? (?:role|position|work|job)s?\\b/i",
    ]) {
      expect(BOARD.includes(re), `${re} must appear verbatim — unanchored, /intern/ hijacks "international"`).toBe(true);
    }
    // And the unanchored spellings must not return.
    expect(BOARD.includes("{ re: /intern/i")).toBe(false);
    expect(BOARD.includes("{ re: /temporary/i")).toBe(false);
  });

  it("the anchored lifts do what the sweep said the unanchored ones would not", () => {
    // Execute the exact anchored regex list against the sweep's hijack corpus.
    const lifts: Array<[RegExp, string]> = [
      [/\bpart[- ]?time\b/i, "part_time"],
      [/\bfull[- ]?time\b/i, "full_time"],
      [/\binternships?\b/i, "internship"],
      [/\binterns?\b/i, "internship"],
      [/\btemporary\b/i, "temporary"],
      [/\bcontract(?:or|ing)? (?:role|position|work|job)s?\b/i, "contract"],
    ];
    const hits = (q: string) => lifts.filter(([re]) => re.test(q)).map(([, t]) => t);
    expect(hits("international sales manager")).toEqual([]);
    expect(hits("internal audit")).toEqual([]);
    expect(hits("internist")).toEqual([]);
    expect(hits("contemporary art teacher")).toEqual([]);
    expect(hits("marketing intern")).toEqual(["internship"]);
    expect(hits("part time nurse")).toEqual(["part_time"]);
    expect(hits("temporary warehouse work")).toEqual(["temporary"]);
    expect(hits("contractor roles")).toEqual(["contract"]);
  });
});

describe("filterViolations understands multi-select and covers the newest filters", () => {
  const applied = (over: Partial<AppliedFilters>): AppliedFilters =>
    ({ ...normalizeFilters({}, 40).applied, ...over }) as AppliedFilters;
  const row = {
    country: "DE", workMode: "remote", category: "design", employmentType: "full_time",
    postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    source: "greenhouse", remote: true, token: "acme",
  };

  it("a matching row under multi-value filters produces ZERO violations", () => {
    // The old equality-against-the-joined-string flagged every correct row of
    // every multi-select page, wrote an UNSAMPLED incident per request, and
    // drowned the sensor built to catch the real five-filters incident class.
    const v = filterViolations([{ ...row }], applied({
      country: "DE,GB", workMode: "remote,hybrid", category: "design,legal", employmentType: "full_time,contract",
    }));
    expect(v).toEqual([]);
  });

  it("a genuinely violating row is still flagged, per member", () => {
    const v = filterViolations([{ ...row, country: "FR", workMode: "onsite" }], applied({
      country: "DE,GB", workMode: "remote,hybrid",
    }));
    expect(v.map((x) => x.field).sort()).toEqual(["country", "workMode"]);
  });

  it("employmentType is checked — the sensor the shipped filter lacked", () => {
    const v = filterViolations([{ ...row, employmentType: "full_time" }], applied({ employmentType: "internship" }));
    expect(v.map((x) => x.field)).toEqual(["employmentType"]);
    // NULL under the filter is itself the defect — the predicate excludes NULL.
    const vNull = filterViolations([{ ...row, employmentType: null }], applied({ employmentType: "internship" }));
    expect(vNull.map((x) => x.field)).toEqual(["employmentType"]);
  });

  it("postedAfter is checked exactly like its analogue maxAgeDays", () => {
    // The base row is 3 days old, so the watermark sits at 5 days: the 10-day
    // row violates it, the base row satisfies it.
    const watermark = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const stale = { ...row, postedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() };
    expect(filterViolations([stale], applied({ postedAfter: watermark })).map((x) => x.field)).toEqual(["postedAfter"]);
    expect(filterViolations([{ ...row }], applied({ postedAfter: watermark }))).toEqual([]);
  });

  it("country and category truncation is REPORTED, the vendor rule", () => {
    const c = normalizeFilters({ country: "US,GB,DE,FR,ES,IT" }, 40);
    expect(c.applied.country).toBe("US,GB,DE,FR,ES");
    expect(c.ignored, "silent narrowing reads as 'the board carries none'").toContain("country");
    const k = normalizeFilters({ category: "design,legal,science,education" }, 40);
    expect(k.applied.category).toBe("design,legal,science");
    expect(k.ignored).toContain("category");
    // An in-cap list stays unreported.
    expect(normalizeFilters({ country: "US,GB" }, 40).ignored).not.toContain("country");
  });
});

describe("no count survives an exclusion, and no tier counts rows it then hides", () => {
  it("every list exit that discloses exclusions also withdraws its counts", () => {
    const disclosures = BOARD.match(/\.\.\.exclusionDisclosure\(excludedTerms\)/g) ?? [];
    const caveats = BOARD.match(/\.\.\.exclusionCountsCaveat\(excludedTerms\)/g) ?? [];
    // One caveat per list exit plus the countOnly pairing inside countHonesty
    // (which spreads its own exclusionDisclosure too).
    expect(disclosures.length, "an exit gained exclusion disclosure without the caveat — its total lies under '-term'")
      .toBe(caveats.length);
    expect(caveats.length).toBeGreaterThanOrEqual(9);
  });

  it("the caveat spells the withdrawal, not a smaller claim", () => {
    expect(BOARD).toMatch(/total: null, countUnavailable: true, totalAtLeast: undefined, relatedTotal: undefined/);
  });

  it("the augment tiers prune excluded titles BEFORE counting them", () => {
    expect(BOARD, "fuzzyExtra must count survivors — '10 close matches below' over 6 cards")
      .toMatch(/!\(excludedTerms\.length && titleExcluded\(String\(r\.title \?\? ""\), excludedTerms\)\)/);
    expect(BOARD, "the split tier gate must see post-exclusion rows")
      .toMatch(/const splitJobs = excludedTerms\.length\s*\?\s*won\.rows\.filter/);
  });
});

describe("the remaining sweep pins", () => {
  it("fuzzy total is tested against the RPC's own cap, not the caller's limit", () => {
    expect(BOARD).toMatch(/const FUZZY_RPC_CAP = 60;/);
    expect(BOARD).toMatch(/const fzCap = Math\.min\(limit, FUZZY_RPC_CAP\);/);
    expect(BOARD).toMatch(/fzTotal > 0 && fzTotal < fzCap/);
    // The SQL side of the mirror: if the RPC's clamp moves, this pin moves.
    expect(MIG).toMatch(/LIMIT GREATEST\(LEAST\(p_limit, 60\), 1\)/);
  });

  it("the routed count expands aliases exactly as the routed list does", () => {
    expect(BOARD).toMatch(/const rcExpand = routedRetriever === "company" \? \{ q: qText, expansions: \[\] as string\[\] \} : expandQuery\(qText\);/);
    expect(BOARD).toMatch(/rcExpand\.expansions\.length \? ftsSafe\(rcExpand\.q\) : ftsQuery\(qText\),/);
  });

  it("the facet-count probe binds the filters the list binds", () => {
    const facetBlock = BOARD.slice(BOARD.indexOf("const t_count_jobs_capped_5"), BOARD.indexOf("p_cap: COUNT_CAP,", BOARD.indexOf("const t_count_jobs_capped_5")));
    for (const frag of ["...sendableSourcesParam(applied)", "p_posted_after: applied.postedAfter", "p_max_age_days: applied.maxAgeDays", "...payParams(applied)", "...extraFilterParams(applied)"]) {
      expect(facetBlock, `facet counts must bind ${frag} — the rail promised ~18x more than clicking delivered`).toContain(frag);
    }
  });

  it("neither augmentation reshuffles a newest-sorted page", () => {
    const fuzzyGate = BOARD.match(/pageTotal < FUZZY_AUGMENT_BELOW && offset === 0 && !countOnly && !newestFirst && qText\.length >= 3/);
    expect(fuzzyGate, "the fuzzy augment gate must exclude sort=newest").not.toBeNull();
    const semGate = BOARD.match(/offset === 0 && !countOnly && !newestFirst && qText\.length >= 3 &&\s*\n\s*rankedGrouped\.jobs\.length < limit/);
    expect(semGate, "the semantic extras gate must exclude sort=newest").not.toBeNull();
  });

  it("the dead top-up stayed deleted", () => {
    const stripped = BOARD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped, "the unsatisfiable gate must not return with its unsafe offset arithmetic")
      .not.toMatch(/!newestFirst && !scoreRanked && groupSimilar/);
  });

  it("the migration splits the alias list and closes the semantic grant", () => {
    expect(MIG).toMatch(/unnest\(string_to_array\(p_location, '\|'\)\)/);
    expect(MIG, "CREATE OR REPLACE only — a DROP list here is the PGRST203 shape").not.toMatch(/DROP FUNCTION/);
    expect(MIG).toMatch(/p\.proname = 'search_jobs_semantic'/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
  });
});
