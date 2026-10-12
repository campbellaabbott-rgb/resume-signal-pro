// AN EMPLOYER PAGE PRINTS NO FIGURE ITS BOARD CANNOT MEASURE.
//
// The Hiring Health card on /jobs/company/:token now reads its record through
// the shared gate (src/lib/hiring-record-gate.ts):
//
//   - on a lap_proven board (a board we confirm only by re-reading it in
//     full, 82% of the top 490 employer pages) the fourteen-day share and the
//     median are refused, because a lap certifies a takedown one to three laps
//     late; live 2026-10-11, Domino's printed "up to 1%" from 10 days of
//     tracking;
//   - the ninety-day counts are refused below 21 days of watching (28 on a lap
//     board) and wherever hundreds of roles came down and not one came back,
//     which is our re-list detector failing (Eurofins, 1,293 and 0);
//   - every refusal prints its reason, and a withheld record is never "no
//     closure record" and never a no.
//
// The same page also loses two facts it could not stand behind: the H-1B card
// that called a function no migration defines is replaced by the working LCA
// reader, whose quarter, file and date come from the row; and a headcount
// prints only with the date it was true (owner decision D11).
//
// Judged by rendered text against get_company_fill_curve rows shaped like the
// live ones (read 2026-10-11 UTC), with a positive control on every surface.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

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

vi.setConfig(MOUNT_TEST_BUDGET);
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

/** A whole get_company_fill_curve row; `over` carries the live figures. */
const curve = (token: string, over: Record<string, unknown>) => ({
  company_token: token, open_roles: 1200, fills_90d: 0, relists_90d: 0,
  filled_roles_90d: 0, relisted_roles_90d: 0, ageouts_90d: 10,
  n_at_risk_14: 400, fills_le_14: 60, fill_rate_14: 0.2, fill_rate_14_lo: 0.17, fill_rate_14_hi: 0.23,
  relist_rate_14: 0.02, still_open_14: 0.78, fill_rate_7: 0.1, fill_rate_30: 0.4,
  median_days_to_fill: null, median_censored: true, dated_coverage: 0.9, dated_n: 900, undated_n: 100,
  fill_through: 0.5, churn: 0, absorption: 0.1, tracking_days: 40, sufficient: true,
  observability_bucket: "full_read", sufficient_30: false, insufficient_reason_30: "events",
  watched_from: "2026-08-01", multi_site_title_share: 0,
  ...over,
});

/** The plan's boards, as get_company_fill_curve answered for them on 2026-10-11. */
const LAP = {
  dominos: curve("dominos", { open_roles: 21829, observability_bucket: "lap_proven", tracking_days: 10, fill_rate_14: 0.0053, fill_rate_14_lo: 0.0047, fill_rate_14_hi: 0.0062, insufficient_reason_30: "lap", filled_roles_90d: 13347, relisted_roles_90d: 0, fills_90d: 13347, dated_coverage: 0.9979 }),
  oreilly: curve("oreillyauto~wd1~oreilly", { open_roles: 4224, observability_bucket: "lap_proven", tracking_days: 10, fill_rate_14: 0.0135, insufficient_reason_30: "lap", filled_roles_90d: 509, relisted_roles_90d: 2, dated_coverage: 0.87 }),
  dollartree: curve("dollartree~wd5~dollartreeus", { open_roles: 5403, observability_bucket: "lap_proven", tracking_days: 8, fill_rate_14: 0.0347, insufficient_reason_30: "lap", filled_roles_90d: 1065, relisted_roles_90d: 19, dated_coverage: 0.9496 }),
};
const EUROFINS = curve("Eurofins", { open_roles: 1106, observability_bucket: "lap_proven", tracking_days: 87, fill_rate_14: 0.3047, median_days_to_fill: 25, median_censored: false, insufficient_reason_30: "lap", filled_roles_90d: 1293, relisted_roles_90d: 0, dated_coverage: 0.8631 });
/** A board read in full and watched long enough: the record speaks. */
const FULL = curve("acme", { open_roles: 40, tracking_days: 40, fill_rate_14: 0.22, fill_rate_14_lo: 0.18, fill_rate_14_hi: 0.27, median_days_to_fill: 12, median_censored: false, filled_roles_90d: 60, relisted_roles_90d: 9 });

const LCA_ROW = {
  ow_company_token: "acme", ow_soc_code: "15-1252", ow_soc_title: "Software Developers", ow_worksite_state: "CA",
  ow_wage_low: 120000, ow_wage_high: 145600, ow_wage_median: 124800, ow_filings_n: 12, ow_match_basis: "employer_top",
  ow_employer_filings_n: 21, ow_employer_cells_n: 2, ow_fiscal_quarter: "FY2026 Q3",
  ow_source_file: "LCA_Disclosure_Data_FY2026_Q3.xlsx", ow_source_url: "https://www.dol.gov/media/LCA_Disclosure_Data_FY2026_Q3.xlsx",
  ow_published_on: "2026-08-25", ow_coverage_from: "2025-10-01", ow_coverage_to: "2026-06-30",
};
const NULL_LCA = { ow_company_token: "acme", ow_soc_code: null, ow_soc_title: null, ow_worksite_state: null, ow_wage_low: null, ow_wage_high: null, ow_wage_median: null, ow_filings_n: null, ow_match_basis: null, ow_employer_filings_n: null, ow_employer_cells_n: null, ow_fiscal_quarter: null, ow_source_file: null, ow_source_url: null, ow_published_on: null };

function mount(token: string, answers: { curve: Record<string, unknown>; lca?: unknown; intel?: unknown }) {
  window.history.replaceState({}, "", `/jobs/company/${token}`);
  const job = {
    id: `workday:${token}:1`, source: "workday", token, company: "Acme", title: "Store Manager", location: "Austin, TX, USA", country: "US",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
    workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "operations",
    department: null, agency: false, postedAt: ago(2), lastSeen: ago(2), recheckedAt: ago(0), applyUrl: "https://x/1", remote: false,
  };
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_company_fill_curve") return { data: [answers.curve], error: null };
    if (fn === "get_employer_lca_wages") return { data: answers.lca === undefined ? [] : [answers.lca], error: null };
    if (fn === "get_company_intel") return { data: answers.intel ?? null, error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 1 } };
      return { data: { jobs: [job], total: 1, totalAllCompanies: 1, companies: [{ token, name: "Acme", open: 1 }], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
    }
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={[`/jobs/company/${token}`]}>
      <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
    </MemoryRouter>,
  );
}
const text = () => document.body.textContent ?? "";
/** The Hiring Health card alone: the board's own toolbar also carries the words "Actively hiring". */
const cardText = () => {
  const h = Array.from(document.querySelectorAll("h2")).find((x) => x.textContent === "Hiring Health");
  return h?.closest(".rounded-xl")?.textContent ?? "";
};
const gateLine = (reason: string) => document.querySelector(`[data-hh-gate="${reason}"]`);

/** Every way the card has to state a fourteen-day share, a median or a thirty-day share. */
const SHARE_14 = /come down for good within \d+ days/;
const MEDIAN = /Half of these roles are filled by day|did not see half of them come down inside/;
const SHARE_30 = /still (?:up|advertised|open) at day 30|within 30 days|by day 30/i;
const COUNT_90 = /Filled\s*[\d,]+\s*roles/;

describe("an employer page prints no figure its board cannot measure", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  for (const [name, row] of Object.entries(LAP)) {
    it(`${name}: a lap board prints no fourteen-day share, no median and no thirty-day share, and says why`, async () => {
      mount(String(row.company_token), { curve: row });
      await waitFor(() => expect(text()).toContain("Hiring Health"), SLOW);
      await waitFor(() => expect(gateLine("lap")).not.toBeNull(), SLOW);
      expect(gateLine("lap")!.textContent).toContain("We confirm a takedown on this board only by re-reading the whole board");
      expect(gateLine("lap")!.textContent).toContain("not a fact about the employer");
      expect(text(), `${name} printed a fourteen-day share`).not.toMatch(SHARE_14);
      expect(text(), `${name} printed a median`).not.toMatch(MEDIAN);
      expect(text(), `${name} printed a thirty-day share`).not.toMatch(SHARE_30);
      // No ninety-day count on any of them: Domino's fails the relist control,
      // the other two the lap board's 28-day floor.
      expect(text(), `${name} printed a ninety-day count`).not.toMatch(COUNT_90);
      expect(cardText(), "a withheld record is not 'no closure record'").not.toContain("No closure record");
      expect(cardText()).toContain("Closure record withheld");
      expect(cardText(), "withheld counts cannot carry the pill").not.toContain("Actively hiring");
    });
  }

  it("Domino's names our re-list detector, with its count of takedowns, as the reason", async () => {
    mount("dominos", { curve: LAP.dominos });
    await waitFor(() => expect(gateLine("relist detection unproven")).not.toBeNull(), SLOW);
    expect(gateLine("relist detection unproven")!.textContent).toContain("We logged 13,347 roles taken down on this board over 10 days of watching and not one that came back");
    expect(gateLine("relist detection unproven")!.textContent).toContain("our re-list detection is not working here");
  });

  it("O'Reilly (a lap board) prints no count at any depth and says why (owner decision GD5)", async () => {
    mount("oreillyauto~wd1~oreilly", { curve: LAP.oreilly });
    await waitFor(() => expect(gateLine("relist detection unproven")).not.toBeNull(), SLOW);
    expect(gateLine("relist detection unproven")!.textContent).toContain("our re-post test sees only the part read on one visit");
    expect(gateLine("relist detection unproven")!.textContent).toContain("not a fact about the employer");
  });

  it("Eurofins: 1,293 taken down and none back prints no 'not re-listed' count, and no share or median either", async () => {
    mount("Eurofins", { curve: EUROFINS });
    await waitFor(() => expect(text()).toContain("Hiring Health"), SLOW);
    await waitFor(() => expect(gateLine("relist detection unproven")).not.toBeNull(), SLOW);
    expect(text()).not.toMatch(/taken down for good, not re-listed/);
    expect(text()).not.toMatch(COUNT_90);
    expect(text()).not.toMatch(/\b1293\b/);
    expect(text()).not.toMatch(SHARE_14);
    expect(text(), "Eurofins' median of 25 days is a lap figure").not.toMatch(MEDIAN);
    expect(gateLine("relist detection unproven")!.textContent).toContain("1,293 roles taken down");
  });

  it("positive control: a board read in full and watched 40 days keeps its share, its median and its count", async () => {
    mount("acme", { curve: FULL });
    await waitFor(() => expect(text()).toContain("Hiring Health"), SLOW);
    await waitFor(() => expect(text()).toMatch(/Up to 22% of its roles come down for good within 14 days/), SLOW);
    expect(text()).toContain("Half of these roles are filled by day 12.");
    expect(text()).toMatch(/Filled\s*60\s*roles in 40d of tracking/);
    expect(cardText()).toContain("Actively hiring");
    expect(cardText()).not.toContain("Closure record withheld");
    expect(document.querySelector("[data-hh-gate]"), "nothing was refused on this record").toBeNull();
  });
});

describe("the H-1B line on an employer page is the working reader, read from its row", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("names the quarter, the file, its published date and the cell's occupation, from the row", async () => {
    mount("acme", { curve: FULL, lca: LCA_ROW });
    await waitFor(() => expect(text()).toContain("Filed H-1B wages · FY2026 Q3"), SLOW);
    expect(text()).toContain("Acme filed 12 certified labor condition applications for Software Developers in CA in FY2026 Q3");
    expect(text()).toContain("LCA_Disclosure_Data_FY2026_Q3.xlsx, published 2026-08-25");
    // No posting is in view on the employer page, so the unasked cell is
    // explained without one.
    expect(text()).toContain("It is not matched to any one role on this board.");
    expect(text()).not.toContain("Nothing on this posting states an occupation code");
    expect(document.querySelector('[data-lca-context="employer"]')).not.toBeNull();
    expect(rpc.mock.calls.some(([fn]) => fn === "get_company_h1b"), "the dead reader is never called").toBe(false);
  });

  it("an employer with no filing row prints nothing, and never says it does not sponsor", async () => {
    mount("acme", { curve: FULL, lca: NULL_LCA });
    await waitFor(() => expect(text()).toContain("Hiring Health"), SLOW);
    await waitFor(() => expect(rpc.mock.calls.some(([fn]) => fn === "get_employer_lca_wages")).toBe(true), SLOW);
    expect(text()).not.toContain("Filed H-1B wages");
    expect(text()).not.toMatch(/sponsor/i);
    expect(document.querySelector("[data-lca-context]")).toBeNull();
  });
});

describe("a headcount prints with the day it was true, or not at all", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });
  const INTEL = { employees: 779000, employee_basis: "public_records", yc_batch: null, median_usd_floor: null, usd_n: 0, categories: [{ category: "operations", n: 30 }], countries: [], net_7d: null };

  it("an undated count, which is every count today, is not printed", async () => {
    mount("acme", { curve: FULL, intel: INTEL });
    await waitFor(() => expect(text()).toMatch(/hires mostly in/), SLOW);
    expect(text()).not.toMatch(/779,000|employees \(/);
    expect(text()).not.toMatch(/enterprise/);
  });

  it("positive control: a count with its date prints with the date", async () => {
    mount("acme", { curve: FULL, intel: { ...INTEL, employees_as_of: "2026-07-23" } });
    await waitFor(() => expect(text()).toContain("≈779,000 employees (public records) · enterprise · as of 2026-07-23"), SLOW);
  });
});
