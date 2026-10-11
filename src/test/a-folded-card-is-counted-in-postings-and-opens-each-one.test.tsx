/**
 * S11-005, the page half. The board folds one employer's same-title postings
 * into one card, and since S11-005 the card carries the folded postings
 * (`siblings`). The page counted CARDS against a total of POSTINGS, so
 * q='theatre team member' printed "Showing 21 of 234" over a page that held
 * all 234, and the folded postings could not be opened at all.
 *
 * Mounted with a list answer shaped as the server now sends it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

const card = (id: string, company: string, title: string, location: string, extra: Record<string, unknown> = {}) => ({
  id, source: "workday", token: company.toLowerCase(), company, title, location, country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: null, employmentType: null, experienceBand: null, minYears: null,
  category: "hospitality_retail", department: null, remote: false,
  postedAt: "2026-10-10T00:00:00+00:00", lastSeen: "2026-10-10T00:00:00+00:00", recheckedAt: null, applyUrl: `https://x/${id}`,
  ...extra,
});

const BODY = {
  jobs: [
    card("workday:pilot:1", "Pilot", "Cashier", "Bellemont, AZ", {
      postingCount: 3, locationCount: 2, otherLocations: ["Flagstaff, AZ"],
      siblings: [
        { id: "workday:pilot:2", location: "Flagstaff, AZ", applyUrl: "https://x/workday:pilot:2", postedAt: "2026-10-10T00:00:00+00:00" },
        { id: "workday:pilot:3", location: "Bellemont, AZ", applyUrl: "https://x/workday:pilot:3", postedAt: "2026-10-10T00:00:00+00:00" },
      ],
    }),
    card("workday:circlek:9", "Circle K", "Customer Service Representative", "Phoenix, AZ"),
  ],
  total: 4, hasMore: false, nextOffset: 4,
  totalAllCompanies: 4, companies: [], companiesCount: 2, categories: {},
  failedSources: [], failedCount: 0, refreshedAt: null,
};

function mount(path: string) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [] }));
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 4 } };
      return { data: BODY };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}
const text = () => document.body.textContent ?? "";

describe("a folded card is counted in postings, and opens each one (S11-005)", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("the summary counts the four postings on the page, not the two cards", async () => {
    mount("/jobs?q=cashier");
    await waitFor(() => expect(text()).toContain("Customer Service Representative"), SLOW);
    expect(text(), "the page counted cards against a total of postings").toMatch(/Showing 4 of 4/);
    expect(text()).not.toMatch(/Showing 2 of 4/);
  });

  it("every folded posting is listed under its card with its own apply link", async () => {
    mount("/jobs?q=cashier");
    await waitFor(() => expect(text()).toContain("Customer Service Representative"), SLOW);
    const toggle = await screen.findByRole("button", { name: /2 more openings of this role/ }, SLOW);
    fireEvent.click(toggle);
    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links, "the folded postings could not be opened").toContain("https://x/workday:pilot:2");
    expect(links).toContain("https://x/workday:pilot:3");
  });
});
