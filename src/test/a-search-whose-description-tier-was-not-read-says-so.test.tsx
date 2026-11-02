/**
 * A SEARCH WHOSE DESCRIPTION TIER WAS NOT READ SAYS SO (sweep S12-034).
 *
 * Under load the board answers a search from the title tier alone when the
 * description tier misses its clock (n482), and says relatedUnavailable: true.
 * Nothing in the app read the key: the page printed "Showing 18 of 18
 * matching openings" where about 411 postings matched, with no word that the
 * postings mentioning the term only in their description were never looked
 * at. The count is now named as title matches and the gap is said beside it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;
const now = new Date().toISOString();
const rows = Array.from({ length: 18 }, (_, i) => ({
  id: `greenhouse:shop${i}:${i}`, source: "greenhouse", token: `shop${i}`, company: `Shop ${i}`, title: `Store Manager ${i}`,
  location: "Leeds, UK", country: "GB", salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: null, employmentType: null, experienceBand: null, minYears: null, category: "retail", department: null,
  postedAt: now, lastSeen: now, recheckedAt: now, applyUrl: `https://apply.example/${i}`, remote: false, matchScope: "title",
}));

let cut = true;
beforeEach(() => {
  window.history.replaceState({}, "", "/jobs?q=store%20manager");
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board" || b.action !== "list") return { data: {} };
    if (b.facetCounts) return { data: { categories: {} } };
    if (b.countOnly) return { data: { total: 18 } };
    return { data: { jobs: rows, total: 18, totalAllCompanies: 18, companies: [], companiesCount: 18, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false, ...(cut ? { relatedUnavailable: true } : {}) } };
  });
});
const text = () => document.body.textContent ?? "";

describe("the description tier missed its clock", () => {
  it("names the count as title matches and says the description matches were not searched", async () => {
    cut = true;
    render(<MemoryRouter initialEntries={["/jobs?q=store%20manager"]}><Jobs /></MemoryRouter>);
    await waitFor(() => expect(text()).toContain("Store Manager 17"), SLOW);
    expect(text(), "the page printed a title-tier count as every match").not.toContain("Showing 18 of 18 matching openings");
    expect(text()).toContain("Showing 18 of 18 openings with your search in the title");
    expect(text()).toContain("Postings that mention your search only in their description could not be searched just now");
  });

  it("control: a search the description tier answered prints the ordinary line and no notice", async () => {
    cut = false;
    render(<MemoryRouter initialEntries={["/jobs?q=store%20manager"]}><Jobs /></MemoryRouter>);
    await waitFor(() => expect(text()).toContain("Store Manager 17"), SLOW);
    expect(text()).toContain("Showing 18 of 18 matching openings");
    expect(text()).not.toContain("could not be searched just now");
  });
});
