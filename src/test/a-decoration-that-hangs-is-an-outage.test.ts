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
  it("the budget is ABOVE the median this read was already measured at", () => {
    // The first version used 800ms against a median the file itself publishes
    // as ~958ms, so it expired on a healthy board and took the headline,
    // employer count, categories and refreshedAt down with it on most requests.
    // A timeout set below the measured median is not a bound, it is an outage.
    const m = /const META_DEADLINE_MS = ([0-9_]+);/.exec(BOARD);
    expect(m, "the meta deadline constant is missing").not.toBeNull();
    expect(Number(m![1].replace(/_/g, "")), "must clear the ~958ms measured median with room")
      .toBeGreaterThanOrEqual(2_000);
  });

  it("both reads share ONE budget — the fat row never gets a second full one", () => {
    expect(BOARD).toMatch(/Math\.max\(150, META_DEADLINE_MS - \(Date\.now\(\) - t_meta\)\)/);
  });

  it("a timeout and an absent row are told apart", () => {
    // withDeadline resolves {data:null} on expiry, which is byte-identical to
    // "no such row" — and the branch below treats the latter as first boot.
    expect(BOARD).toMatch(/const META_TIMEOUT = Symbol\("meta-timeout"\);/);
    expect(BOARD).toMatch(/if \(headRes === META_TIMEOUT\) metaTimedOut = true;/);
    expect(BOARD, "a slow head read must not be followed by an equally slow fat read")
      .toMatch(/if \(!meta && !metaTimedOut\) \{/);
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
    // And it must be gated on a GENUINE empty answer. runRefresh(force=true)
    // bypasses the slice lock, so firing it whenever meta is null meant one
    // forced pass PER REQUEST on a slow database — traffic became load, and the
    // board organised its own stampede (measured: page_query back to 27.5s).
    expect(BOARD).toMatch(/if \(!metaTimedOut\) waitUntil\(runRefresh\(client, true\)\);/);
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

describe("every decoration on the serving path is bounded", () => {
  it("the thin-page fuzzy augment has both a budget gate and a deadline, like its siblings", () => {
    expect(BOARD).toMatch(/qText\.length >= 3 && budgetLeft\(\) > 2_000\) \{/);
    const augment = BOARD.slice(BOARD.indexOf("const t_fuzzy_title_search_0"), BOARD.indexOf("const t_fuzzy_title_search_0") + 700);
    expect(augment, "the augment RPC must race the budget").toMatch(/Math\.min\(2_000, budgetLeft\(\)\)/);
  });

  it("the empty-page fuzzy rescue joins the ladder's budget", () => {
    const rescue = BOARD.slice(BOARD.indexOf("const t_fuzzy_title_search_2"), BOARD.indexOf("const t_fuzzy_title_search_2") + 900);
    expect(rescue, "unbounded deadlines SUM — the failure REQUEST_BUDGET_MS exists to cap")
      .toMatch(/Math\.min\(4_000, budgetLeft\(\)\)/);
  });

  it("the browse top-up is bounded AND marked — it was serveList's only unmarked query", () => {
    expect(BOARD).toMatch(/markFrom\("page_topup", t_topup\)/);
    const topup = BOARD.slice(BOARD.indexOf("const t_topup"), BOARD.indexOf("const t_topup") + 900);
    expect(topup).toMatch(/Math\.min\(1_500, budgetLeft\(\)\)/);
  });

  it("no bare await of fuzzy_title_search remains", () => {
    const stripped = BOARD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped, "every fuzzy call must go through withDeadline now")
      .not.toMatch(/= await client\.rpc\("fuzzy_title_search"/);
  });
});

describe("edge exits answer the question they were asked", () => {
  it("the past-the-end exit is honest for FILTERED requests", () => {
    // {"q":"welder","country":"USA","offset":900000} used to answer an empty
    // page under total: 601,760 — the bare board's number over a ~417-row set.
    expect(BOARD).toMatch(/total: unfiltered \? safeMetaTotal : null, hasMore: false, nextOffset: offset,/);
    expect(BOARD).toMatch(/\.\.\.\(!unfiltered \|\| safeMetaTotal === null \? \{ countUnavailable: true \} : \{\}\),/);
  });

  it("sort=newest never issues a cursor its own reader refuses", () => {
    expect(BOARD).toMatch(/if \(twoSubset \|\| sortSalary \|\| newestFirst\) return null;/);
  });
});

describe("an errored meta read is an unknown, never an absent row", () => {
  it("raceMeta maps rejection AND resolved-with-error to the timeout marker", () => {
    const BOARD2 = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    // The .4 fix mapped rejections to {data:null} — byte-identical to "no such
    // row" — so an errored read still reached the first-boot seed. Both error
    // shapes now land on META_TIMEOUT, and only a genuine empty answer seeds.
    expect(BOARD2).toMatch(/\(r as \{ error\?: unknown \}\)\.error \? META_TIMEOUT : \(r as \{ data: unknown \}\)/);
    expect(BOARD2).toMatch(/\(\): typeof META_TIMEOUT => META_TIMEOUT,/);
  });
});
