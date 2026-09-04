// A BOARD-WIDE COUNT UNDER A NARROWED PAGE.
//
// get_country_facet (20260729183822) takes NO PARAMETERS:
//
//     SELECT country, count(*) FROM job_board_postings
//     WHERE country IS NOT NULL AND missing_since IS NULL
//     GROUP BY country ORDER BY 2 DESC LIMIT 40
//
// So the country picker's numbers are the whole board's, always. Measured
// against production 2026-08-25: US 253,609 / GB 20,625 / CA 19,220. A reader
// who had narrowed to category=design, or Remote, or a salary floor was still
// offered "United States 253,609" beside a page holding a few thousand rows.
// Every one of those numbers is REAL; not one of them answers the question the
// reader asked. That is exactly the defect the industry rail carried until it
// was fixed, and this file exists so it does not come back a third time.
//
// ── WHY THE FIX IS TO DROP THE NUMBER, NOT TO COMPUTE A BETTER ONE ──────────
//
// Filtered country counts were considered and rejected on cost. The
// filtered-facet branch already spends its whole FACET_DEADLINE (1.5s with a
// text query) on per-category count_jobs_capped calls, and the code's own
// comment records those as the single largest cost of a text search. Forty
// more country counts would push the CATEGORY numbers into truncation — and
// those are the ones the rail depends on. So: absent is not zero, board-wide
// is not filtered, and the picker keeps its options while losing its counts.
//
// ── THE FAILURE MODE THIS FILE HAS TO AVOID ─────────────────────────────────
//
// A test that "passes" because a count happened to be missing for an unrelated
// reason — the facet RPC never resolved, the fallback list kicked in, the
// popover never opened — proves nothing. So the behavioural tests below always
// establish the POSITIVE first: the same facet data, the same open popover,
// the number visibly rendered on an unfiltered board. Only then is a filter
// applied and the number's disappearance asserted. One mount, one popover, one
// variable changed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boardFilterBody, countryCountsStillTrue, type BoardFilterState } from "../pages/Jobs";

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
import Jobs from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SLOW = { timeout: 4000 } as const;

// The live shape, with the live numbers, so the assertions are about a figure
// that genuinely appeared on the board rather than a token.
const FACET = [
  { country: "US", n: 253609 },
  { country: "GB", n: 20625 },
  { country: "CA", n: 19220 },
];

const ROWS = [{
  id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
  title: "Staff Engineer", location: "Cambridge", country: "GB",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "remote", employmentType: null, experienceBand: null, minYears: null,
  category: "engineering", department: null, remote: true,
  postedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
  recheckedAt: null, applyUrl: "https://x/1",
}];

function mount(path: string) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_country_facet") return { data: FACET };
    return { data: [] };
  });
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 1 } };
      return {
        data: {
          jobs: ROWS, total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

/** Open the country popover and return the text of its option rows. */
async function openCountryPicker() {
  const triggers = screen.getAllByRole("button", { name: "All countries" });
  fireEvent.click(triggers[0]);
  await waitFor(() => expect(screen.queryAllByRole("checkbox", { name: /United States/ }).length)
    .toBeGreaterThan(0), SLOW);
  return screen.getAllByRole("checkbox", { name: /United States/ })[0].textContent ?? "";
}

// The state the page starts from, so a case is one field away from unfiltered.
const BASE: BoardFilterState = {
  q: "", location: "", remoteOnly: false, workMode: "", category: "", inclUncat: false,
  agentOnly: false, country: "", experience: "", companyTokens: [], salaryFloor: 0,
  salaryCeiling: 0, payBasis: "", statedPayOnly: false, includeUnstatedPay: false,
  maxYears: 0, department: "", vendor: "", employmentType: "", hideAgencies: false,
  freshness: "",
};

describe("a board-wide count under a narrowed page", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("the predicate reads the REQUEST BODY, so a filter added later counts the day it exists", () => {
    // Unfiltered: the facet's board-wide numbers are the board's numbers.
    expect(countryCountsStillTrue(boardFilterBody(BASE))).toBe(true);
    // A country selection alone does NOT invalidate them: the facet carries no
    // country predicate, so each row is still "how many if you picked this one
    // instead" — the question the picker asks.
    expect(countryCountsStillTrue(boardFilterBody({ ...BASE, country: "US" }))).toBe(true);
    expect(countryCountsStillTrue(boardFilterBody({ ...BASE, country: "US,GB" }))).toBe(true);
    // Anything else narrowing the board makes them answer a question nobody
    // asked. Every filter this page can send, one at a time — and the list is
    // not the point: the point is that the predicate is derived from the body,
    // so a twelfth filter is covered without being named here.
    const NARROWING: Array<Partial<BoardFilterState>> = [
      { q: "designer" }, { location: "Berlin" }, { remoteOnly: true }, { workMode: "remote" },
      { category: "design" }, { agentOnly: true }, { experience: "senior" },
      { companyTokens: ["acme"] }, { salaryFloor: 100000 }, { salaryCeiling: 200000 },
      { payBasis: "hourly" }, { statedPayOnly: true }, { includeUnstatedPay: true },
      { maxYears: 3 }, { department: "Nursing" }, { vendor: "greenhouse" },
      { employmentType: "internship" }, { hideAgencies: true }, { freshness: "7" },
    ];
    for (const f of NARROWING) {
      const body = boardFilterBody({ ...BASE, ...f });
      expect(Object.keys(body).length, `${JSON.stringify(f)} sends nothing`).toBeGreaterThan(0);
      expect(countryCountsStillTrue(body), JSON.stringify(f)).toBe(false);
      // And still false when a country is picked alongside it.
      expect(countryCountsStillTrue(boardFilterBody({ ...BASE, ...f, country: "US" })), JSON.stringify(f)).toBe(false);
    }
  });

  it("behaviour: the count is on screen on an unfiltered board", async () => {
    // THE POSITIVE FIRST. Without this, the negative below would pass just as
    // happily if the facet never arrived or the popover never opened.
    mount("/jobs");
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    const row = await openCountryPicker();
    expect(row, "the unfiltered board must keep its real counts").toContain("253,609");
  });

  it("behaviour: the same count is gone the moment the board is narrowed", async () => {
    // ONE VARIABLE CHANGED from the test above: the page arrives with a
    // category filter. Same facet data, same popover, same row.
    mount("/jobs?category=design");
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    const row = await openCountryPicker();
    expect(row, "the option itself must survive — only the number was wrong").toContain("United States");
    expect(row, "a board-wide count under a narrowed page").not.toContain("253,609");
    // Not a rounded or truncated version of it either.
    expect(row).not.toMatch(/\d/);
  });

  it("behaviour: picking a country does not cost the picker its counts", async () => {
    // The facet is computed with no country predicate, so this is the one
    // selection under which the numbers stay true.
    mount("/jobs?country=GB");
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    const row = await openCountryPicker();
    expect(row).toContain("253,609");
  });

  it("behaviour: the country list still populates under a filter", async () => {
    // Membership is not the broken part. A fix that emptied the picker would
    // be worse than the defect.
    mount("/jobs?mode=remote&salaryFloor=100000");
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    fireEvent.click(screen.getAllByRole("button", { name: "All countries" })[0]);
    await waitFor(() => expect(screen.queryAllByRole("checkbox").length).toBeGreaterThan(0), SLOW);
    const labels = screen.getAllByRole("checkbox").map((n) => n.textContent ?? "");
    for (const c of ["United States", "United Kingdom", "Canada"]) {
      expect(labels.join(" | "), `${c} vanished from the picker`).toContain(c);
    }
  });

  it("the render site reads the predicate, and the tooltip says which state it is in", () => {
    // Evaluated ONCE per render — boardFilterBody allocates and walks an
    // object, and asking it per option meant forty of those per render.
    expect(JOBS, "the predicate is memoized off the filter state").toMatch(
      /const countryCountsShown = useMemo\(\s*\(\) => countryCountsStillTrue\(boardFilterBody\(filterState\)\),/,
    );
    expect(JOBS, "the count is gated").toMatch(/count: countryCountsShown \? c\.n : undefined,/);
    // undefined, not 0: MultiSelectFilter prints neither, but a 0 written here
    // would be this page claiming a country has no postings.
    expect(JOBS, "a zero must never stand in for a withheld count")
      .not.toMatch(/countryCountsShown \? c\.n : 0/);
    expect(JOBS).toMatch(/jobsPage\.countryTipCounts/);
    expect(JOBS).toMatch(/jobsPage\.countryTipNoCounts/);
    // The options and the fallback are untouched — membership was never wrong.
    expect(JOBS).toMatch(/countryFacet\.length > 0 \|\| fallbackCountries\.length > 0/);
    expect(JOBS).toMatch(/countryFacet\.length \? countryFacet : fallbackCountries/);
  });

  it("both tooltips exist in all nine locales", () => {
    for (const l of ["en", "en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"]) {
      const jp = (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8")) as {
        jobsPage?: Record<string, unknown>;
      }).jobsPage ?? {};
      for (const k of ["countryTipCounts", "countryTipNoCounts"]) {
        expect(typeof jp[k], `${l}: jobsPage.${k}`).toBe("string");
        expect(String(jp[k]).length, `${l}: jobsPage.${k} is empty`).toBeGreaterThan(20);
      }
      // The two must actually differ, or one of the states is lying.
      expect(jp.countryTipCounts, `${l}: the two tooltips are the same sentence`)
        .not.toBe(jp.countryTipNoCounts);
    }
  });

  it("the reason the number is withheld rather than recomputed stays written down", () => {
    // PROSE, so RAW. Without it the next pass "fixes" the missing counts by
    // adding forty count_jobs_capped calls inside FACET_DEADLINE and truncates
    // the category numbers instead.
    expect(RAW).toMatch(/get_country_facet TAKES NO PARAMETERS/);
    expect(RAW).toMatch(/FILTERED COUNTS ARE NOT AVAILABLE CHEAPLY/);
    expect(RAW).toMatch(/ABSENT IS NOT ZERO, AND\s*\*?\s*BOARD-WIDE IS NOT FILTERED/);
  });
});
