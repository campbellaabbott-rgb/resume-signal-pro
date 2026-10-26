/**
 * AN ADDRESS FOR A BOARD WE DO NOT READ OFFERS THE BOARD IT PROBABLY MEANT (S12-129).
 *
 * /jobs/company/intel reads "We don't read a board called “intel” yet" with a
 * search box (noindex, nofollow) — but the board does carry Intel, as
 * intel~wd1~External (a baked page, 492 roles), and the page never said so.
 * It now asks the board's own name suggester with the address's words and
 * offers the boards whose names begin with them, each linked the way every
 * employer link is (its written page, or the live board filtered to it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stub(),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stub() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "@/pages/Jobs";
import { didYouMeanRows } from "@/components/jobs/company/CompanyEmptyState";

vi.setConfig(MOUNT_TEST_BUDGET);
const EMPTY = { jobs: [], total: 0, hasMore: false, nextOffset: 0, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null };
const SUGGEST = [
  { token: "intel~wd1~External", name: "Intel", open: 492 },
  { token: "ail", name: "Artificial Intelligence Lab", open: 12 },
];

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "company-suggest") return { data: { companies: SUGGEST }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 0 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const companies = (b.companies as string[] | undefined) ?? [];
      return { data: companies.length ? { ...EMPTY, unknownCompanies: companies } : EMPTY, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
});
afterEach(() => { cleanup(); setLanderManifestForTests(null); });

describe("didYouMeanRows", () => {
  it("keeps names that begin with the address's words, never the address itself, at most three", () => {
    expect(didYouMeanRows("intel", SUGGEST)).toEqual([{ token: "intel~wd1~External", name: "Intel" }]);
    expect(didYouMeanRows("dominos", [{ token: "dominos", name: "Domino's" }, { token: "dominos-uk", name: "Domino's UK" }])).toEqual([{ token: "dominos-uk", name: "Domino's UK" }]);
    expect(didYouMeanRows("x", SUGGEST)).toEqual([]);
  });
});

describe("the uncarried company page", () => {
  it("offers the carried Intel board, linked to its written page", async () => {
    setLanderManifestForTests({ "intel~wd1~External": "intel~wd1~External" });
    window.history.replaceState({}, "", "/jobs/company/intel");
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/jobs/company/intel"]}>
          <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    const link = await screen.findByRole("link", { name: "Intel" }, SLOW);
    expect(link.getAttribute("href")).toBe("/jobs/company/intel~wd1~External");
    expect(screen.getByText("Did you mean one of these boards?")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Artificial Intelligence Lab" })).toBeNull();
    const asked = invoke.mock.calls.find(([, o]) => (o as { body?: { action?: string } })?.body?.action === "company-suggest");
    expect((asked?.[1] as { body: { q: string } }).body.q).toBe("intel");
  });

  it("tells a screen reader what the page says, never that filters the visitor never set match nothing", async () => {
    // The polite region said "No openings match these filters." on an address
    // we do not read, with no filter set (the SEO round's merge review,
    // 2026-10-25); a11yEmpty knew only the zero page.
    window.history.replaceState({}, "", "/jobs/company/anduril");
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/jobs/company/anduril"]}>
          <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    const status = await screen.findByText("We don't read a board called “anduril” yet", { selector: '[role="status"]' }, SLOW);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByText("No openings match these filters.")).toBeNull();
  });
});
