// AN EMPLOYER PAGE PRINTED CLOSURE EVENTS AS ROLES THAT STAYED DOWN.
//
// get_company_fill_curve.fills_90d is a sum over closure EVENTS: a posting
// that closed twice counted twice, and one that closed and is serving again
// today counted once. The board printed it as "Filled N roles ... taken down
// for good, not re-listed" on the employer page and as "we watched N of its
// roles come off the board and stay off" beside a posting, and judged its
// "Actively hiring" verdict on it. Live on 2026-10-04 Johnson & Johnson read
// 2,499 there, against at most 1,799 roles that stayed down and 403 that came
// back (register L11-02). 20261008110000 adds filled_roles_90d and
// relisted_roles_90d; these surfaces now print and judge those.
//
// Judged by the rendered text, against a fixture whose event and role counts
// disagree in J&J's proportions, with a positive control on each surface.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const JOB = {
  id: "workday:jnj:1", source: "workday", token: "jnj", company: "Johnson & Johnson",
  title: "Clinical Data Manager", location: "Raritan, NJ, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3,
  category: "healthcare", department: null, agency: false,
  postedAt: ago(2), lastSeen: ago(2), recheckedAt: ago(0), applyUrl: "https://x/1", remote: false,
};

/** Events and roles disagreeing the way J&J's did. */
const CURVE = {
  company_token: "jnj", open_roles: 1200, fills_90d: 2499, relists_90d: 5,
  filled_roles_90d: 1799, relisted_roles_90d: 403, ageouts_90d: 40,
  n_at_risk_14: 60, fills_le_14: 14, fill_rate_14: 0.22, fill_rate_14_lo: 0.18, fill_rate_14_hi: 0.27,
  relist_rate_14: 0.05, still_open_14: 0.73, fill_rate_7: 0.10, fill_rate_30: 0.40,
  median_days_to_fill: null, median_censored: true, dated_coverage: 0.9, dated_n: 900, undated_n: 100,
  fill_through: 0.5, churn: 0.002, absorption: 0.1, tracking_days: 33, sufficient: true,
};
/** The same row as a deploy that predates the role columns returns it. */
const { filled_roles_90d: _f, relisted_roles_90d: _r, ...OLD_ROW } = CURVE;

function mount(path: string, curve: Record<string, unknown>) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_company_fill_curve") return { data: [curve], error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "detail") return { data: { job: JOB, description: "A role." } };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 1 } };
      return { data: { jobs: [JOB], total: 1, totalAllCompanies: 1, companies: [{ token: "jnj", name: "Johnson & Johnson", open: 1200 }], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
    }
    return { data: {} };
  });
  if (path.startsWith("/jobs/company/")) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
      </MemoryRouter>,
    );
  }
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}
const text = () => document.body.textContent ?? "";

describe("an employer page printed closure events as roles that stayed down", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("the Hiring Health card prints the roles that stayed down, never the event count", async () => {
    mount("/jobs/company/jnj", CURVE);
    await waitFor(() => expect(text()).toContain("Hiring Health"), SLOW);
    await waitFor(() => expect(text()).toMatch(/Filled\s*1799\s*roles in 33d of tracking/), SLOW);
    expect(text(), "the closure-event count is printed as roles").not.toMatch(/\b2499\b/);
  });

  it("a row from a deploy without the role columns is our gap: no count, and the record reads as unknown", async () => {
    mount("/jobs/company/jnj", OLD_ROW);
    await waitFor(() => expect(text()).toContain("Hiring Health"), SLOW);
    await waitFor(() => expect(text()).toContain("No closure record"), SLOW);
    expect(text()).not.toMatch(/\b2499\b/);
    expect(text()).not.toMatch(/Filled\s*\d/);
  });

  it("the verdict beside a posting quotes the roles that stayed down", async () => {
    mount("/jobs", CURVE);
    await waitFor(() => expect(text()).toContain("Clinical Data Manager"), SLOW);
    await waitFor(() => expect(rpc.mock.calls.some(([fn]) => fn === "get_company_fill_curve")).toBe(true), SLOW);
    const card = Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]")).find((c) => (c.textContent ?? "").includes("Clinical Data Manager"))!;
    fireEvent.click(card);
    await waitFor(() => expect(text()).toContain("we watched 1799 of its roles come off the board and stay off"), SLOW);
    expect(text()).not.toContain("we watched 2499 of its roles");
  });
});
