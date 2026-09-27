// A COVERAGE PERCENTAGE MUST DESCRIBE THE PAGE IT PRINTS UNDER.
//
// The results header carried one sentence — "Employers state … on 23% of
// postings. A filter can only search what was published — roles that don't say
// are hidden here, not absent." — and every percentage in it was the WHOLE
// BOARD's, printed beside a narrowed count. get_filter_coverage() takes no
// parameters (one scan over `missing_since IS NULL AND effective_posted >=
// now() - 30 days`, no country, category, vendor or employmentType term), and
// coverageDisclosure() in supabase/functions/job-board/index.ts uses the applied
// filters ONLY to decide which keys to emit — never to scope a value.
//
// MEASURED LIVE 2026-09-26, anon key, POST /functions/v1/job-board, countOnly
// probes with both halves uncapped:
//
//   filterCoverage.hasStatedPay = 0.235 on every probe INCLUDING the unfiltered
//   board, printed as "24%", while the slice on screen really states an annual
//   figure on
//       country=SE ............  6 / 3,119 =  0.2%   (123x overstated)
//       country=CA + healthcare  1,300 / 2,243 = 58.0%   (34 points understated)
//   filterCoverage.workMode = 0.232, printed as "23%", while
//       vendor=pinpoint ....... 3,557 / 3,557 = 100%
//   — and on that page the work-mode filter hides not one row of 3,557 while the
//   sentence says 77% of them are "hidden here".
//
// Wrong in both directions, so a reader cannot even treat it as a floor, and
// wrong at the exact moment it matters: the sentence exists to explain why a
// narrowed result is thin.
//
// WHY THE FIX WITHHOLDS THE FIGURE INSTEAD OF SCOPING IT. Scoped shares were
// priced before being refused. Each countOnly probe on this board took
// 438-1,242ms live (ten probes, median ~800ms); a scoped share needs a counted
// numerator AND a counted denominator per field, nine coverage fields is up to
// eighteen counted queries for one sentence, four of the fields ("states a
// country", "a department", "a pay basis", "a year count") cannot be expressed
// through the list API at all, and any slice over COUNT_CAP returns capped
// totals on both halves — a share of two capped counts is not a measurement. So
// a clause keeps its percentage only while its own filter family is the only
// thing narrowing the board, the sentence NAMES that population, and a narrowed
// page gets the caveat with no number plus the page's own exact, in-scope counts.
//
// WHAT THIS FILE ASSERTS, OFF A REAL RENDER OF /jobs:
//
//   1. The positive first: with only its own filter on, the clause prints its
//      percentage and the sentence names the whole board.
//   2. One variable changed — a second filter — and the percentage is GONE, in
//      both of the live shapes above, with no board-wide number relabelled as
//      local and no percentage anywhere on the page.
//   3. The gate is derived from the request body, so a filter added later counts
//      the day it exists, and an unknown key fails CLOSED (silence, not a false
//      claim).
//   4. The withheld sentence states no figure — in all nine locales.
//   5. Cross-runtime (project_claim_drift): coverageDisclosure is transpiled out
//      of the edge function and CALLED, proving the value does not move when the
//      scope does. The day it starts scoping, this test says so and the label
//      has to change with it.
//   6. The page's exact in-scope sentence is no longer suppressed on the slices
//      where it is the only honest figure left, and still says nothing when the
//      filter hides nothing.
//   7. No new request pays for any of this.
//
// TEETH — six breaks, run 2026-09-26, each restored and re-verified green:
//   1. `cov()` reverted to an unconditional push (the pre-fix renderer) → 5 red:
//      1.2 ("Across the whole board …" rendered on the SE page, where it was
//      asserted null), 1.3, 2.3, 5.1 and 6.1.
//   2. coverageStillBoardWide's `every` → `some` → 5 red, including the
//      fail-closed walk ("pay: expected true to be false") and the SE render.
//   3. narrowingBodyKeys reading the `sort` KEY instead of its value → 3 red,
//      and the two that went red are the POSITIVE cases (1.1, 1.4): over-
//      suppression is a failure here too, not a safe default.
//   4. the exact sentence's bar put back to `hidden > data.total` → 5.1 red,
//      943 hidden openings unmentioned beside a withheld percentage.
//   5. `{{scope}}` dropped from de.json's sentence → 3.2 red, naming de.
//   6. "23%" prepended to tl.json's withheld sentence → 3.1 red, naming tl.
// NOT COVERED, and argued in the source instead: coverageScopeRef reading the
// live filter state rather than the body the reply answered. The difference only
// shows during the window where a filter change keeps the old list on screen,
// which this harness cannot stage — so that one is a comment, not a claim.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";
import Jobs, {
  boardFilterBody, narrowingBodyKeys, coverageStillBoardWide, COVERAGE_FAMILIES,
  type BoardFilterState, type CoverageFamily,
} from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
/**
 * THE SHARED STRIPPER, NOT A LOCAL ONE — and this file is why the shared one
 * exists.
 *
 * Comments are part of a file, and a docblock quoting a literal is how four
 * guards in this repo passed while the code was wrong. The obvious two-regex
 * stripper (block comments first, then line comments) is the one
 * src/test/helpers/strip-comments.ts documents as having swallowed 16,390
 * characters of THIS VERY FILE: index.ts:106 is a LINE comment containing
 * `../_shared/*`, whose `/*` the block pass reads as a comment opener and runs to
 * the next `*​/` far below. MEASURED in this tree TODAY (2026-09-26, the file
 * having grown since that note was written): index.ts is 1,175,849 chars raw,
 * 481,174 through codeOf and 487,009 through the naive pass — the naive output is
 * LONGER because it keeps prose, and yet `const BUILD_VERSION` and
 * `const SITEMAP_DAYS` are present in the raw file and in codeOf and ABSENT from
 * it, which is the hole rather than a size difference. A guard reading a file with a hole in it passes
 * against anything, and this file transpiles a FUNCTION BODY out of that reading,
 * so the hole would not fail loudly — it would return a different function.
 *
 * House rule: a guard that pins a literal reads comment-stripped code, through
 * this helper. sqlCodeOf is the SQL half — it cuts trailing `--` comments as well
 * as line-leading ones, which the local `^\s*--` pass did not.
 */
const FN = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
const LOCALES = resolve(ROOT, "src/i18n/locales");
const LOCALE_FILES = readdirSync(LOCALES).filter((f) => f.endsWith(".json")).sort();
const jp = (f: string) => JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, string>;
const SLOW = { timeout: 5000 } as const;

// ── THE FIXTURE IS THE LIVE MEASUREMENT ─────────────────────────────────────
// The cached block as the board served it on 2026-09-26 (pay 0.235, work mode
// 0.232, experience 0.452, country 0.928 — byte-identical on five probes
// including the unfiltered board). `vendor` is not in the block: the edge
// function pins it at 1 because a source is never null.
//
// THE FIGURES ARE A SNAPSHOT AND THE DATE IS PART OF THEM: two hours later the
// same probes read 0.239 / 0.233 / 0.457 / 0.933, still identical across a
// one-filter and a five-filter body. So the values below are pinned as a dated
// fixture — what matters to every case here is that the server's number does not
// move when the SCOPE moves, which is what case 4 calls the function to prove.
const META = {
  v: {
    coverage: {
      // THE STAMP IS PART OF THE FIXTURE BECAUSE IT IS PART OF THE FIGURES.
      // `at` is the date of the pass that counted them, written beside them by
      // the refresh; coverageDisclosure now returns {} without it and the page
      // prints nothing, which is the whole point — a percentage whose basis date
      // the page cannot state is a claim and not a measurement. The value here is
      // the day this fixture's numbers were read off the live board.
      at: "2026-09-26",
      // THE STATES-PAY CLAUSE READS salaryText, NOT hasStatedPay, SINCE 2026-09-27.
      // The filter moved onto the employer's verbatim pay field, so the sentence
      // under a stated-pay page has to count that column or it describes a
      // narrower population than the count printed above it. Both keys are in the
      // fixture and they DIFFER on purpose: an expectation of 0.283 fails the
      // moment the disclosure reads the annualised key again. Live on one scan at
      // 2026-09-27T02:07:00Z, 207,108 of 733,190 servable rows carry pay text
      // (28.25%) against 173,868 carrying an annual figure (23.72%).
      hasStatedPay: 0.235, salaryText: 0.283, workMode: 0.232, experience: 0.452, country: 0.928,
      salaryFloor: 0.129, payBasis: 0.106, maxYears: 0.289, department: 0.405, employmentType: 0.273,
    },
  },
};
/** Every board-wide percentage the fixture above can print, as it would reach
 *  the screen. Not one of them may appear on a narrowed page. */
// 28% is the states-pay clause's figure since it started counting the pay field;
// 24% stays listed because the fixture still carries the annualised figure and a
// clause that started printing it again would be exactly the regression.
const BOARD_PERCENTS = ["28%", "24%", "23%", "45%", "93%", "13%", "11%", "29%", "41%", "27%", "100%"];

/** coverageDisclosure and the constant it reads, transpiled out of the Deno
 *  source and CALLED — so the numbers this page renders in the tests below came
 *  from the real server function, not from a hand-written fixture that could
 *  quietly stop resembling it. */
function loadCoverageDisclosure(): (applied: Record<string, unknown>, meta: unknown) => Record<string, unknown> {
  const i = FN.indexOf("function coverageDisclosure(");
  expect(i, "coverageDisclosure is gone from the edge function").toBeGreaterThan(0);
  const body = FN.slice(i, FN.indexOf("\n}", i) + 2);
  const c = FN.indexOf("const MEASURED_COVERAGE = {");
  expect(c, "MEASURED_COVERAGE is gone").toBeGreaterThan(0);
  const consts = FN.slice(c, FN.indexOf("} as const;", c) + "} as const;".length);
  const js = ts.transpileModule(`${consts}\n${body}\nreturn coverageDisclosure;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(js)() as (a: Record<string, unknown>, m: unknown) => Record<string, unknown>;
}
const coverageDisclosure = loadCoverageDisclosure();

/** The server's own `applied` shape, from a client body. normalizeFilters turns
 *  the comma strings into arrays; this is the only translation the fixture does. */
function appliedFrom(b: Record<string, unknown>): Record<string, unknown> {
  const list = (v: unknown) => (typeof v === "string" && v ? v.split(",") : undefined);
  return {
    ...b,
    vendors: list(b.vendor),
    experience: list(b.experience),
    salaryFloor: typeof b.salaryFloor === "number" ? b.salaryFloor : null,
    salaryCeiling: typeof b.salaryCeiling === "number" ? b.salaryCeiling : null,
    maxYears: typeof b.maxYears === "number" ? b.maxYears : null,
  };
}

const ROWS = [{
  id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
  title: "Staff Engineer", location: "Cambridge", country: "SE",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "remote", employmentType: null, experienceBand: null, minYears: null,
  category: "engineering", department: null, remote: true,
  postedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
  recheckedAt: null, applyUrl: "https://x/1",
}];

type Counts = {
  /** The page's own total — what the filtered list returns. */
  page: number;
  /** The same query with the disclosure family dropped: the honest denominator. */
  dropped?: number;
  /** Mode pages only: the same query with every stated mode at once. */
  anyStated?: number;
  capDropped?: boolean;
};
const PAY_KEYS = ["hasStatedPay", "salaryFloor", "salaryCeiling", "payBasis", "includeUnstatedPay"];
/** The list replies the mock served, so a negative assertion can prove the wrong
 *  figure really arrived rather than that the mock went quiet. */
let served: Array<Record<string, unknown>> = [];

/** Mount /jobs at `path`. `kind` says which family the page's own probe drops,
 *  so the mock can answer the denominator probe with `dropped` — exactly the
 *  discrimination the page itself makes. */
function mount(
  path: string,
  counts: Counts = { page: 1 },
  kind: "salary" | "workMode" | null = null,
  noCoverage = false,
  /** `stripStamp` serves the figures with NO `filterCoverageAt` — the shape the
   *  server ships when it leaned on a pinned constant, and the shape an older
   *  deployed bundle produces. */
  opts: { stripStamp?: boolean } = {},
) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [] }));
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board") return { data: {} };
    if (b.action === "facets") return { data: { categories: {}, refreshedAt: null, sources: null }, error: null };
    if (b.action !== "list") return { data: {} };
    if (b.facetCounts) return { data: { categories: {} } };
    if (b.countOnly) {
      if (b.workMode === "remote,hybrid,onsite") {
        return { data: { total: counts.anyStated ?? counts.page } };
      }
      const droppedProbe = kind === "salary"
        ? PAY_KEYS.every((k) => b[k] === undefined)
        : b.workMode === undefined && b.remote === undefined;
      if (droppedProbe) {
        return { data: { total: counts.dropped ?? counts.page, ...(counts.capDropped ? { countCapped: true } : {}) } };
      }
      return { data: { total: counts.page } };
    }
    // THE COVERAGE BLOCK COMES FROM THE EDGE FUNCTION ITSELF.
    const reply = {
      jobs: ROWS, total: counts.page, totalAllCompanies: 1, companies: [], companiesCount: 0,
      categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
      ...(noCoverage ? {} : (() => {
        const c = coverageDisclosure(appliedFrom(b), META);
        if (opts.stripStamp) delete (c as Record<string, unknown>).filterCoverageAt;
        return c;
      })()),
    };
    served.push(reply);
    return { data: reply, error: null };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
const scoped = (which: "board" | "withheld") =>
  document.querySelector<HTMLElement>(`[data-coverage-scope="${which}"]`)?.textContent ?? null;
/** The bodies of the counted probes the page sent, so cost is judged by request
 *  and not by eye. */
const countBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board"
    && (o as { body?: Record<string, unknown> })?.body?.action === "list"
    && (o as { body: Record<string, unknown> }).body.countOnly === true)
  .map(([, o]) => (o as { body: Record<string, unknown> }).body);
/** The filterCoverage block the server sent for this page — proof the negative
 *  cases below are about a figure that really arrived. */
const servedCoverage = (): Record<string, number> | null =>
  (served.find((r) => r.filterCoverage)?.filterCoverage as Record<string, number> | undefined) ?? null;

const BASE: BoardFilterState = {
  q: "", location: "", remoteOnly: false, workMode: "", category: "", inclUncat: false,
  agentOnly: false, country: "", experience: "", companyTokens: [], salaryFloor: 0,
  salaryCeiling: 0, payBasis: "", statedPayOnly: false, includeUnstatedPay: false,
  maxYears: 0, department: "", vendor: "", employmentType: "", hideAgencies: false,
  freshness: "",
};

beforeEach(() => {
  window.history.replaceState({}, "", "/jobs");
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
  served = [];
});

describe("1. a board-wide percentage prints only while the whole board is what the page shows", () => {
  it("behaviour: States pay alone keeps its percentage, and the sentence names the population it counted", async () => {
    // THE POSITIVE FIRST. Without it every negative below would pass just as
    // happily if the sentence had simply disappeared, or the mock had never
    // returned a coverage block at all.
    mount("/jobs?statedPay=1", { page: 1_300, dropped: 2_243 }, "salary");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(scoped("board")).toBeTruthy(), SLOW);
    expect(servedCoverage(), "the server did send the block").toMatchObject({ hasStatedPay: 0.283 });
    const s = scoped("board")!;
    expect(s, "0.283 must reach the screen as a percentage").toContain("28%");
    expect(s, "and it must say whose population that is").toContain("the whole board, not just this filtered page");
    expect(scoped("withheld"), "nothing was withheld on this page").toBeNull();
  });

  it("behaviour: country=SE beside it, and the same served figure prints nowhere (live: 0.2%, printed 24%)", async () => {
    // ONE VARIABLE CHANGED from the case above. Same server block, same
    // sentence slot, one extra filter — the live SE shape: 6 of 3,119.
    mount("/jobs?statedPay=1&country=SE", { page: 6, dropped: 3_119 }, "salary");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(scoped("withheld")).toBeTruthy(), SLOW);
    expect(servedCoverage(), "the wrong figure really did arrive — this is not a mock that went quiet")
      .toMatchObject({ hasStatedPay: 0.283, country: 0.928 });
    expect(scoped("board"), "a board-wide percentage under a narrowed page").toBeNull();
    for (const p of BOARD_PERCENTS) {
      expect(text(), `${p} is a board-wide figure and this page is narrower than the board`).not.toContain(p);
    }
    // The figure it DOES print is the page's own, exact and in scope.
    await waitFor(() => expect(text()).toContain("Another 3,113 openings"), SLOW);
    expect(text()).toContain("6 of these employers publish pay");
    // THE CONTRAST THAT KEEPS THE CLAUSE HONEST IN BOTH DIRECTIONS. 3,113 rows
    // really are hidden here, so the "hidden by it, not absent" clause is true
    // and must stay — the gate is on a MEASURED zero, not on narrowing in
    // general. Without this half, deleting the clause outright would pass.
    await waitFor(() => expect(scoped("withheld")).toBeTruthy(), SLOW);
    expect(scoped("withheld")!, "the clause is true on this page and was dropped")
      .toContain("hidden by it, not absent");
    expect(scoped("withheld")!).not.toContain("the filter is hiding nothing");
  });

  it("behaviour: vendor + every work mode — the clause that claimed 77% were hidden while none were", async () => {
    // Live: vendor=pinpoint is 3,557 rows and all 3,557 state a mode, so the
    // filter hides nothing and the old sentence still said "work mode on 23% …
    // roles that don't say are hidden here".
    mount("/jobs?vendor=pinpoint&mode=remote,hybrid,onsite", { page: 3_557, dropped: 3_557, anyStated: 3_557 }, "workMode");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(scoped("withheld")).toBeTruthy(), SLOW);
    expect(servedCoverage()).toMatchObject({ workMode: 0.232, vendor: 1 });
    expect(scoped("board")).toBeNull();
    for (const p of BOARD_PERCENTS) expect(text(), `${p} reached a narrowed page`).not.toContain(p);
    // …and nothing claims rows were hidden, because none were.
    expect(text()).not.toMatch(/Another [\d,]+ openings/);
    /* AND THE WITHHELD SENTENCE DROPS ITS "HIDDEN BY IT" CLAUSE HERE.
     *
     * The sentence that replaces the percentage asserted "roles that don't say
     * are hidden by it, not absent" on EVERY narrowed page, this one included —
     * where the page's own probe measured the filter hiding exactly zero rows
     * (3,557 match, 3,557 state a mode). Vacuously true is still copy describing
     * behaviour the page does not have, which is the defect class of this build,
     * and it was the specific clause the verifier asked to gate. */
    const w = scoped("withheld")!;
    expect(w, "the withheld sentence must still say WHY no percentage is shown")
      .toContain("this page is narrower than that");
    expect(w, "the filter hides nothing on this page and the sentence still says it hides roles")
      .not.toContain("hidden by it, not absent");
    expect(w, "and it says so positively, so the reader is not left guessing")
      .toContain("the filter is hiding nothing");
  });

  it("behaviour: a mode filter alone still prints the mode percentage", async () => {
    // The other side of case 1.3: the work-mode figure is not banned, it is
    // scoped. With nothing else narrowing the board it is exactly right.
    mount("/jobs?mode=remote", { page: 100, dropped: 1_000, anyStated: 700 }, "workMode");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(scoped("board")).toBeTruthy(), SLOW);
    expect(scoped("board")!).toContain("23%");
    expect(scoped("board")!).toContain("the whole board");
  });
});

describe("2. the gate is derived from the request body, so a filter added later counts the day it exists", () => {
  it("walk: every family keeps its own keys and loses the board to any other narrowing", () => {
    // Its own filter, on its own: still the board.
    expect(coverageStillBoardWide(narrowingBodyKeys(boardFilterBody({ ...BASE, statedPayOnly: true })), "pay")).toBe(true);
    expect(coverageStillBoardWide(narrowingBodyKeys(boardFilterBody({ ...BASE, workMode: "remote" })), "workMode")).toBe(true);
    expect(coverageStillBoardWide(narrowingBodyKeys(boardFilterBody({ ...BASE, remoteOnly: true })), "workMode")).toBe(true);
    expect(coverageStillBoardWide(narrowingBodyKeys(boardFilterBody({ ...BASE, country: "SE" })), "country")).toBe(true);
    // The whole pay BAND is one family: dropping one of its controls still
    // leaves the others hiding the postings the figure is about.
    expect(coverageStillBoardWide(
      narrowingBodyKeys(boardFilterBody({ ...BASE, statedPayOnly: true, salaryFloor: 100_000, payBasis: "salaried" })), "pay",
    )).toBe(true);
    // Anything else on the board and the figure describes something else.
    const NARROWING: Array<[Partial<BoardFilterState>, CoverageFamily]> = [
      [{ q: "nurse" }, "pay"], [{ location: "Berlin" }, "pay"], [{ category: "healthcare" }, "pay"],
      [{ country: "SE" }, "pay"], [{ vendor: "greenhouse" }, "workMode"], [{ experience: "senior" }, "country"],
      [{ agentOnly: true }, "experience"], [{ hideAgencies: true }, "department"], [{ freshness: "7" }, "maxYears"],
      [{ companyTokens: ["acme"] }, "employmentType"], [{ maxYears: 3 }, "vendor"], [{ workMode: "remote" }, "pay"],
      [{ statedPayOnly: true }, "workMode"], [{ department: "Nursing" }, "employmentType"],
    ];
    for (const [patch, family] of NARROWING) {
      const keys = narrowingBodyKeys(boardFilterBody({ ...BASE, ...patch }));
      expect(keys.length, `${JSON.stringify(patch)} sends nothing`).toBeGreaterThan(0);
      expect(coverageStillBoardWide(keys, family), `${JSON.stringify(patch)} vs ${family}`).toBe(false);
    }
  });

  it("walk: a filter this map has never heard of FAILS CLOSED — silence, not a board-wide number", () => {
    // The twelfth filter. A hand-written list of narrowing filters would leave
    // the percentage printing under it; deriving the gate from the body means an
    // unknown key can only cost the sentence its figure.
    for (const family of Object.keys(COVERAGE_FAMILIES) as CoverageFamily[]) {
      expect(coverageStillBoardWide(["somethingShippedNextMonth"], family), family).toBe(false);
      expect(coverageStillBoardWide([...COVERAGE_FAMILIES[family], "somethingShippedNextMonth"], family), family).toBe(false);
    }
    // And the page shape keys are NOT narrowings — paging must not silence a
    // true figure.
    expect(narrowingBodyKeys({ action: "list", limit: 60, offset: 120, cursor: { ep: "x", id: "y" }, includeFacets: true, hasStatedPay: true }))
      .toEqual(["hasStatedPay"]);
    // An undefined value is not a filter: boardFilterBody deletes them, and a
    // body built elsewhere must not be read as narrowed by an absent key.
    expect(narrowingBodyKeys({ action: "list", hasStatedPay: true, workMode: undefined })).toEqual(["hasStatedPay"]);
    // Everything that genuinely changes the population counts, including the
    // two keys that are not filters the reader set.
    expect(narrowingBodyKeys({ action: "list", hasStatedPay: true, hasDescription: true }).sort())
      .toEqual(["hasDescription", "hasStatedPay"]);
    // AN ORDER IS NOT A NARROWING, except the one that excludes rows. `sort`
    // rides every list body since the default browse started naming its order,
    // so reading the key rather than its value would silence the sentence on
    // every page on the board.
    expect(narrowingBodyKeys({ action: "list", hasStatedPay: true, sort: "newest" })).toEqual(["hasStatedPay"]);
    expect(narrowingBodyKeys({ action: "list", hasStatedPay: true, sort: "salary" }).sort())
      .toEqual(["hasStatedPay", "sort"]);
  });

  it("source: no clause can reach the sentence without passing the gate", () => {
    const JOBS = codeOf(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
    const start = JOBS.indexOf("const fc = data?.filterCoverage;");
    expect(start, "the coverage renderer moved").toBeGreaterThan(0);
    const block = JOBS.slice(start, JOBS.indexOf('t("jobsPage.filterCoverageDated"', start));
    // ONE WRITER. The sentence is assembled from `parts`, and the only thing that
    // may append to it is the gate — a clause that pushes directly is a
    // board-wide figure with no scope test in front of it.
    expect((block.match(/parts\.push\(/g) ?? []).length,
      "something other than the scope gate appends to the coverage sentence").toBe(1);
    expect(block, "the one push is not the gate's").toMatch(
      /const cov = \([\s\S]{0,200}coverageStillBoardWide\(narrowing, family\)\) parts\.push\(clause\);/,
    );
    // Every emitted key goes through cov(), and cov() is the only writer.
    const emitted = [...new Set([...FN.slice(FN.indexOf("function coverageDisclosure("))
      .matchAll(/\bout\.(\w+)\s*=/g)].map((m) => m[1]))];
    expect(emitted.length, "the emitted set shrank — re-point this guard").toBeGreaterThanOrEqual(11);
    for (const k of emitted) {
      expect(block, `filterCoverage.${k} is rendered without a family`).toMatch(
        new RegExp(`typeof fc\\.${k} === "number"\\) cov\\("\\w+",`),
      );
    }
  });
});

describe("3. a scope too thin for a percentage refuses to print one, in every language", () => {
  it("the withheld sentence carries no figure at all — no digit, no percent sign, nine locales", () => {
    expect(LOCALE_FILES.length).toBe(9);
    for (const f of LOCALE_FILES) {
      const s = jp(f).coverageNarrowed;
      expect(typeof s, `${f} lacks jobsPage.coverageNarrowed`).toBe("string");
      expect(s.length, `${f} jobsPage.coverageNarrowed is a stub`).toBeGreaterThan(40);
      expect(s, `${f} coverageNarrowed prints a figure — the board-wide number wearing a local label is exactly what this replaces`)
        .not.toMatch(/[0-9%]/);
      expect(s, `${f} coverageNarrowed interpolates a value`).not.toMatch(/\{\{/);
    }
  });

  it("the board-wide sentence cannot lose its qualifier in a translation, because the qualifier is a placeholder", () => {
    // project_claim_drift, rule 3: interpolate the volatile part rather than
    // letting a writer type it. A locale VALUE beats the inline English default,
    // so nine sentences that each forgot "board-wide" is how this defect would
    // come back in eight languages while English reads correctly.
    const en = jp("en.json");
    for (const f of LOCALE_FILES) {
      // THE DATED KEY. `jobsPage.filterCoverage` was RETIRED rather than edited
      // when the sentence gained its basis date: a locale value overrides the
      // inline English default, so editing the English string alone would have
      // left eight translated copies of the UNDATED claim rendering — the exact
      // failure project_claim_drift records. The retired spelling is asserted
      // absent from every locale by the case below.
      const s = jp(f).filterCoverageDated;
      expect(typeof s, `${f} lacks jobsPage.filterCoverageDated`).toBe("string");
      expect(s, `${f} jobsPage.filterCoverageDated lost {{scope}}`).toContain("{{scope}}");
      expect(s, `${f} jobsPage.filterCoverageDated lost {{fields}}`).toContain("{{fields}}");
      expect(s, `${f} jobsPage.filterCoverageDated lost {{asOf}} — a percentage with no basis date is a claim`).toContain("{{asOf}}");
      expect(jp(f).coverageScopeBoard?.length, `${f} jobsPage.coverageScopeBoard is missing or a stub`).toBeGreaterThan(20);
      // Nothing in this sentence may state a number of its own: every figure in
      // it arrives through {{fields}}, which the gate above controls.
      expect(s, `${f} jobsPage.filterCoverageDated pins a figure in its own text`).not.toMatch(/[0-9]/);
      if (f !== "en.json" && f !== "en-GB.json") {
        expect(s, `${f} jobsPage.filterCoverageDated is still the English string`).not.toBe(en.filterCoverageDated);
        expect(jp(f).coverageScopeBoard, `${f} jobsPage.coverageScopeBoard is still English`).not.toBe(en.coverageScopeBoard);
        expect(jp(f).coverageNarrowed, `${f} jobsPage.coverageNarrowed is still English`).not.toBe(en.coverageNarrowed);
      }
    }
  });

  it("no locale still holds the sentence that made the unscoped claim", () => {
    // Per-language, because a claim in Hindi is invisible to an English regex.
    // These nine are the pre-fix values, byte for byte.
    const RETIRED: Record<string, string> = {
      "en.json": "Employers state {{fields}} of postings. A filter can only search what was published — roles that don't say are hidden here, not absent.",
      "en-GB.json": "Employers state {{fields}} of postings. A filter can only search what was published — roles that don't say are hidden here, not absent.",
      "de.json": "Arbeitgeber geben {{fields}} der Anzeigen an. Ein Filter kann nur durchsuchen, was veröffentlicht wurde — Stellen ohne Angabe sind hier ausgeblendet, nicht abwesend.",
      "es.json": "Los empleadores indican {{fields}} de las ofertas. Un filtro solo puede buscar lo publicado — las ofertas que no lo indican quedan ocultas aquí, no ausentes.",
      "fr.json": "Les employeurs indiquent {{fields}} des offres. Un filtre ne peut chercher que ce qui a été publié — les offres qui ne le précisent pas sont masquées ici, pas absentes.",
      "hi.json": "नियोक्ता {{fields}} पोस्टिंग में बताते हैं। फ़िल्टर वही खोज सकता है जो प्रकाशित हुआ है — जो भूमिकाएँ नहीं बतातीं, वे यहाँ छिपी हैं, अनुपस्थित नहीं।",
      "nl.json": "Werkgevers vermelden {{fields}} van de vacatures. Een filter kan alleen zoeken in wat is gepubliceerd — vacatures zonder vermelding zijn hier verborgen, niet afwezig.",
      "pt.json": "Os empregadores indicam {{fields}} das vagas. Um filtro só pode pesquisar o que foi publicado — as vagas que não indicam ficam ocultas aqui, não ausentes.",
      "tl.json": "Isinasaad ng mga employer ang {{fields}} ng mga anunsyo. Ang isang filter ay makakahanap lamang ng inilathala — ang mga trabahong hindi nagsasaad ay nakatago rito, hindi wala.",
    };
    for (const [f, old] of Object.entries(RETIRED)) {
      expect(Object.values(jp(f)), `${f} still renders the unscoped sentence somewhere in jobsPage`).not.toContain(old);
      // And the KEY itself is gone, not merely re-worded. A locale value beats the
      // inline default, so an `en.json` edit with the key left in place in the
      // other eight is how eight languages keep rendering the old claim while the
      // English page reads correctly.
      expect(
        jp(f).filterCoverage,
        `${f} still carries jobsPage.filterCoverage — the undated key must be deleted, not edited`,
      ).toBeUndefined();
    }
  });

  it("behaviour: figures that arrive with no basis date print as silence, not as an undated percentage", async () => {
    /* WHAT THIS GUARDS, AND WHY IT IS A SEPARATE CASE FROM THE SCOPE GATE.
     * Every fraction in this block is a snapshot — this file's own docblock
     * records the same probes reading 0.235/0.232/0.452/0.928 and, two hours
     * later, 0.239/0.233/0.457/0.933 — and four of them can be served from a
     * PINNED 2026-08-25 constant when the cached pass predates the live counts.
     * So the server ships the figures without `filterCoverageAt` whenever it
     * leaned on a pinned value, and a reply that cannot say WHEN it counted must
     * not print a percentage at all: project_stat_provenance's rule is that every
     * public stat names its date basis, and the alternative here is dating a
     * 2026-08-25 snapshot to today's pass (the "right number under the wrong
     * noun" shape).
     *
     * This is also the >4.5MB-deploy path: an older bundle that knows nothing of
     * the stamp degrades to silence rather than to an undated claim.
     *
     * The scope gate cannot cover this — the page below is narrowed by NOTHING
     * but its own family, so the gate lets the figure through and only the
     * missing stamp stops it. */
    const { filterCoverage } = coverageDisclosure({ hasStatedPay: true }, META) as { filterCoverage: Record<string, number> };
    expect(filterCoverage.hasStatedPay, "the fixture must really carry the figure this case suppresses").toBe(0.283);
    mount("/jobs?statedPay=1", { page: 1_300, dropped: 2_243 }, "salary", false, { stripStamp: true });
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(servedCoverage(), "the figure really did arrive — this is not a mock that went quiet")
      .toMatchObject({ hasStatedPay: 0.283 });
    expect(
      served.some((r) => r.filterCoverageAt !== undefined),
      "the stamp was not actually removed, so this case proves nothing",
    ).toBe(false);
    // Nothing on screen may state any board-wide percentage.
    for (const pc of BOARD_PERCENTS) {
      expect(text(), `${pc} printed under a reply that never said when it was counted`).not.toContain(pc);
    }
    expect(scoped("board"), "the dated sentence rendered without a date").toBeNull();
    // The page's OWN exact, in-scope count is unaffected: it is measured by this
    // page's own probes, not by the cached block, so silence is only about shares.
    await waitFor(() => expect(text()).toContain("Another 943 openings"), SLOW);
  });
});

describe("4. the server's figure does not move when the scope does — so the client may not say it did", () => {
  it("walk: coverageDisclosure returns the same value for a narrowed scope as for the whole board", () => {
    // THE CROSS-RUNTIME HALF (project_claim_drift). The copy lives in
    // src/i18n/locales/*.json, the figure lives in a Deno module, and neither
    // tsc nor the deno gate can see across that boundary. So this calls the
    // real function: if its numbers are scope-invariant, a sentence that
    // attributes them to a narrowed page is false, whatever the page looks like.
    const whole = coverageDisclosure({ hasStatedPay: true, workMode: "remote", experience: ["entry"], country: "SE" }, META);
    const narrow = coverageDisclosure({ hasStatedPay: true, workMode: "remote", experience: ["entry"], country: "SE" }, META);
    expect(whole).toEqual(narrow);
    // …and every scope the bar can add leaves the figures untouched.
    const base = coverageDisclosure({ hasStatedPay: true }, META) as { filterCoverage: Record<string, number> };
    // 0.283 is salaryText's value in the fixture and 0.235 is the annualised
    // key's, so this also pins WHICH key the disclosure reads.
    expect(base.filterCoverage.hasStatedPay).toBe(0.283);
    for (const scope of [
      { country: "SE" }, { category: "healthcare" }, { vendors: ["pinpoint"] },
      { employmentType: "internship" }, { department: "Nursing" }, { q: "nurse" },
    ] as Array<Record<string, unknown>>) {
      const out = coverageDisclosure({ hasStatedPay: true, ...scope }, META) as { filterCoverage: Record<string, number> };
      expect(
        out.filterCoverage.hasStatedPay,
        `coverageDisclosure now answers ${JSON.stringify(scope)} with its own figure. If that is deliberate, the ` +
        "client must stop labelling it board-wide: jobsPage.coverageScopeBoard and the gate in Jobs.tsx are what to change.",
      ).toBe(0.283);
    }
  });

  it("the SQL behind it counts the whole serving population and takes no scope", () => {
    // The root of the invariance: one scan, no parameters. Read from the newest
    // migration that defines the function, comment-stripped so the prose
    // explaining the population cannot satisfy the assertion.
    const migs = resolve(ROOT, "supabase/migrations");
    const newest = readdirSync(migs).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => readFileSync(resolve(migs, f), "utf8").includes("FUNCTION public.get_filter_coverage")).pop();
    expect(newest, "no migration defines get_filter_coverage").toBeTruthy();
    const sql = sqlCodeOf(readFileSync(resolve(migs, newest!), "utf8"));
    const fn = sql.slice(sql.indexOf("FUNCTION public.get_filter_coverage"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    expect(body).toContain("get_filter_coverage()");
    expect(body, "the serving pair is the denominator").toMatch(/missing_since IS NULL/);
    for (const col of ["country =", "category =", "source =", "employment_type ="]) {
      expect(body, `get_filter_coverage now narrows on ${col} — the client's board-wide label has to change with it`)
        .not.toContain(col);
    }
  });
});

describe("5. the exact in-scope sentence is no longer silenced where it is the only figure left", () => {
  it("behaviour: a slice that states pay on 58% now says what it hides (live: CA + healthcare, 943 openings)", async () => {
    // 1,300 of 2,243. `hidden` (943) is SMALLER than `shown` (1,300), so the old
    // majority bar suppressed this sentence — on exactly the slice where the
    // board-wide 24% was most wrong, leaving the reader with nothing at all.
    mount("/jobs?statedPay=1&country=CA", { page: 1_300, dropped: 2_243 }, "salary");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(text()).toContain("Another 943 openings"), SLOW);
    expect(text()).toContain("1,300 of these employers publish pay");
    expect(scoped("board"), "and still no board-wide percentage beside it").toBeNull();
  });

  it("behaviour: a filter that hides nothing still says nothing", async () => {
    mount("/jobs?mode=remote,hybrid,onsite", { page: 3_557, dropped: 3_557, anyStated: 3_557 }, "workMode");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(text()).not.toMatch(/Another [\d,]+ openings/);
  });

  it("behaviour: a pay BAND keeps the majority bar, because its hidden count is not the unstated rows", async () => {
    // Same arithmetic as the 58% case (dropped 2,243, page 1,300 → 943), one
    // control different: with a FLOOR set, `dropped − total` also contains rows
    // that DID state pay and fell below the floor, so the sentence's wording
    // ("don't state a salary") does not describe the number and it keeps the
    // bar it had. Silence over a sentence that would be wrong.
    mount("/jobs?salaryFloor=100000", { page: 1_300, dropped: 2_243 }, "salary");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(text()).not.toMatch(/Another [\d,]+ openings/);
  });

  it("behaviour: a capped denominator still publishes no difference", async () => {
    mount("/jobs?statedPay=1&country=CA", { page: 1_300, dropped: 10_000, capDropped: true }, "salary");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(text()).not.toMatch(/Another [\d,]+ openings/);
  });
});

describe("6. none of this costs a request", () => {
  it("behaviour: the page asks for exactly the same counts whether the coverage block arrives or not", async () => {
    // THE DISCRIMINATION. Scoping the sentence per field would need a counted
    // numerator and denominator for each one (measured live: 438-1,242ms per
    // count). If any of that were happening, a page served WITH the coverage
    // block would send counts a page served WITHOUT it does not.
    mount("/jobs?statedPay=1&country=SE", { page: 6, dropped: 3_119 }, "salary");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(scoped("withheld")).toBeTruthy(), SLOW);
    await new Promise((r) => setTimeout(r, 400));
    const withBlock = countBodies().map((b) => JSON.stringify(b)).sort();
    expect(servedCoverage(), "the block did arrive on this page").toBeTruthy();

    invoke.mockReset(); rpc.mockReset(); served = [];
    document.body.innerHTML = "";
    mount("/jobs?statedPay=1&country=SE", { page: 6, dropped: 3_119 }, "salary", true);
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await new Promise((r) => setTimeout(r, 400));
    const withoutBlock = countBodies().map((b) => JSON.stringify(b)).sort();
    expect(servedCoverage(), "the control case must really lack the block").toBeNull();
    expect(withBlock, "the coverage sentence bought a counted query").toEqual(withoutBlock);
    // And the ONE probe the exact sentence rests on is scoped: the pay band
    // dropped, the reader's country kept. (Other features on this page send
    // counts of their own — the freshness chip's, for one — which is why this
    // asserts the presence of the right body rather than a property of all of
    // them.)
    expect(
      countBodies().some((b) => b.country === "SE" && PAY_KEYS.every((k) => b[k] === undefined)),
      `no scoped denominator probe: ${JSON.stringify(countBodies())}`,
    ).toBe(true);
    // Nothing new was invented on the wire for the sentence either: the page
    // speaks the three actions it spoke before (list, its facets read, and the
    // status read behind the freshness line).
    const actions = [...new Set(invoke.mock.calls.map(([, o]) => (o as { body?: Record<string, unknown> })?.body?.action))];
    expect(actions.filter((a) => !["facets", "list", "status"].includes(String(a))),
      "a new board action is being called for the coverage sentence").toEqual([]);
  });
});
