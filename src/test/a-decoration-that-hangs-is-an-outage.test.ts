import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isUnfiltered, WIDENING_FILTERS, normalizeFilters } from "../../supabase/functions/job-board/filters";

/**
 * THE 13.6 SECONDS THAT BELONGED TO NOBODY.
 *
 * MEASURED 2026-08-30: a {limit:1,includeFacets:false} call took 30,728ms, of
 * which page_query was 2,015 and attachRecheckedAt 15,104 — leaving ~13,600ms
 * attributed to no phase at all. A full trace of that request found exactly one
 * piece of unmarked awaited I/O: the two job_board_meta reads in the `list`
 * handler, which sit OUTSIDE serveList, carry no deadline, and run as
 * service_role — a role with no statement_timeout, so they can hang for
 * thirteen seconds and still return successfully with no error and no log line.
 */
const BOARD = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("the meta read is bounded, measured, and cannot escalate", () => {
  it("both reads race a deadline, and the fat row gets what is LEFT of it", () => {
    expect(BOARD).toMatch(/const META_DEADLINE_MS = 800;/);
    expect(BOARD).toMatch(/withDeadline\(\s*\n\s*client\.from\("job_board_meta"\)\.select\("v, updated_at"\)\.eq\("k", "refresh_head"\)/);
    expect(BOARD, "two sequential full budgets for decoration is the same mistake twice")
      .toMatch(/const leftMs = Math\.max\(150, META_DEADLINE_MS - \(Date\.now\(\) - t_meta\)\);/);
  });

  it("the read is published as a phase, so it can never go unattributed again", () => {
    expect(BOARD).toMatch(/const preMs: Record<string, number> = \{ meta_read: Date\.now\(\) - t_meta \};/);
    expect(BOARD, "serveList must merge phases measured before it was called")
      .toMatch(/const phase: Record<string, number> = \{ \.\.\.\(pre \?\? \{\}\) \};/);
  });

  it("a user request can NEVER await a full refresh pass", () => {
    // runRefresh(force=true) bypasses the slice lock and runs a full
    // board-fetching pass; sliceStats measured lastMs at 184,951ms during this
    // incident. The `!meta` guard became reachable under load once the reads
    // could come back empty, so this branch had to stop blocking.
    expect(BOARD).toMatch(/waitUntil\(runRefresh\(client, true\)\);/);
    const stripped = BOARD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped, "no awaited seeding refresh may remain on the request path")
      .not.toMatch(/const seeded = await runRefresh\(client, true\)/);
  });
});

describe("a widening flag is not a filter", () => {
  const norm = (b: Record<string, unknown>) => normalizeFilters(b, 200).applied;

  it("includeUnstatedPay alone leaves the board unfiltered", () => {
    // It binds no predicate on its own (buildQuery only relaxes an ACTIVE
    // floor), so the rows are the bare board's — but counting it as a filter
    // made the commonest request run a capped count and publish
    // "10,000 (capped)" beside a real total of ~600k.
    expect(isUnfiltered(norm({ includeUnstatedPay: true }))).toBe(true);
    expect(WIDENING_FILTERS.has("includeUnstatedPay")).toBe(true);
    expect(WIDENING_FILTERS.has("includeUncategorised")).toBe(true);
  });

  it("still counts every real narrowing", () => {
    expect(isUnfiltered(norm({}))).toBe(true);
    expect(isUnfiltered(norm({ country: "DE" }))).toBe(false);
    expect(isUnfiltered(norm({ workMode: "remote" }))).toBe(false);
    expect(isUnfiltered(norm({ includeUnstatedPay: true, country: "US" }))).toBe(false);
  });

  it("the rescue gate derives its set from the shared one, so they cannot drift", () => {
    expect(BOARD).toMatch(/const NON_NARROWING = new Set\(\[\.\.\.WIDENING_FILTERS, "sort", "q"\]\);/);
  });
});

describe("a count we do not have is unknown, never zero", () => {
  it("a null count with no error still withdraws the total", () => {
    // Three paths leave count null with error null (the two-subset `other`
    // count timing out, and the two degrade re-runs). The published field is
    // `countUnavailable ? null : (count ?? 0)`, so without this the response
    // served 48 real rows under "Showing 48 of 0 matching openings".
    expect(BOARD).toMatch(/let countUnavailable = countTimedOut \|\| \(wantCount && count === null\);/);
  });
});
