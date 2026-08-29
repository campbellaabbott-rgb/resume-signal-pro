import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SWEEP #2 (2026-08-29), the round that re-attacked sweep #1's own fixes.
 *
 * The head-term ring is a per-request query with a deadline, so it is
 * NONDETERMINISTIC across a searcher's page loads — and the .51 seam surgery
 * assumed it was stable. When the ring flickers (present on one page, missed on
 * the next, e.g. under the DB load of an incident) two defects appeared: a deep
 * page with a missed ring re-served below-seam rows as duplicates, and a
 * sub-seam page with a shrunk pool jumped to the deep regime and skipped rows.
 * Both are pinned here as fixed: a MISS is now distinguished from an EMPTY ring
 * and handled as an unknown exclusion set, and the sub-seam handoff anchors to
 * the stable SQL-rank boundary rather than the per-request pool length.
 */
const BOARD = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const FILTERS = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/filters.ts"), "utf8");
const MCP = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");

describe("a flickering ring must not duplicate or hole", () => {
  it("distinguishes a ring MISS from an empty ring", () => {
    expect(BOARD).toMatch(/let ringResolved = headRingP === null;/);
    expect(BOARD, "an array result is the only thing that marks the ring resolved")
      .toMatch(/headRows = \(hr as unknown\[\]\)\.map\(rowToJob\)[\s\S]*?ringResolved = true;/);
  });

  it("deep-page exclusion fails safe to the ring's own predicate when the set is unknown", () => {
    // Unknown exclusion set + empty ringIds = duplicates. On a miss, fall back
    // to the title-prefix predicate (the exact ILIKE the ring runs) so every
    // possible collision is dropped rather than re-served.
    expect(BOARD).toMatch(/const ringIds = ringResolved/);
    expect(BOARD).toMatch(/String\(r\.title \?\? ""\)\.toLowerCase\(\)\.startsWith\(ringPrefix\)/);
  });

  it("sub-seam pool exhaustion anchors to the SQL-rank boundary when the ring missed", () => {
    // rankedScored.length is the POOL length and moves with the ring; keying
    // exhaustion off it on a miss jumps early and holes. On a miss, use the
    // stable RANKED_WINDOW boundary instead.
    expect(BOARD).toMatch(/ringResolved\s*\n?\s*\?\s*offset \+ rankedGrouped\.rawConsumed >= rankedScored\.length\s*\n?\s*:\s*offset \+ rankedGrouped\.rawConsumed >= RANKED_WINDOW/);
  });
});

describe("counts and disclosures stay self-consistent", () => {
  it("the related segment stands down whenever the exact total was withdrawn", () => {
    // relatedTotal beside a totalUnderstated-nulled total made the client
    // render "0 exact" over a page of exact matches.
    expect(BOARD).toMatch(/augmented \|\| totalUnderstated \|\| related === null \|\| related === 0/);
  });

  it("the carried-facets marker rides the SERVED row, not only the fat one", () => {
    // serving reads refresh_head; the marker was only on the fat `refresh` row,
    // so a carried (stale) total served as current left no trace.
    expect(BOARD).toMatch(/\.\.\.\(facetsCarried \? \{ facetsCarried: true, facetsCarriedAt: v\.refreshedAt \} : \{\}\)/);
  });

  it("the facet rail uses the list's matcher for multi-word queries", () => {
    expect(BOARD).toMatch(/const facetUseRpc = qText && facetQ\.length <= 1;/);
  });

  it("the router's stand-down gate is mechanical, so future filters count", () => {
    expect(BOARD).toMatch(/const onlyQuery = isUnfiltered\(\{ \.\.\.applied, q: "" \}\);/);
  });
});

describe("filter honesty, post-sweep-2", () => {
  it("does not report a filter ignored for a duplicate or mixed-case value", () => {
    expect(FILTERS).toMatch(/wmValid\.length !== new Set\(wmAsked\)\.size/);
    expect(FILTERS).toMatch(/etValid\.length !== new Set\(etAsked\)\.size/);
  });

  it("names a non-boolean includeUnstatedPay instead of silently dropping it", () => {
    expect(FILTERS).toMatch(/typeof body\.includeUnstatedPay !== "boolean"[\s\S]*?ignored\.push\("includeUnstatedPay"\)/);
  });
});

describe("the MCP layer surfaces every honesty signal the board emits", () => {
  it("passes salaryStatedOnly through — a pay-sorted agent must be told the board was narrowed", () => {
    expect(MCP).toMatch(/"salaryStatedOnly"/);
  });
});
