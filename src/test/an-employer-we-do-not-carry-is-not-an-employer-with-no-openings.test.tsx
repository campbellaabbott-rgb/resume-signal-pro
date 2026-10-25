/**
 * AN EMPLOYER WE DO NOT CARRY IS NOT AN EMPLOYER WITH NO OPENINGS (sweep
 * S11-020), the page half. The server half is the .ts file of the same name.
 *
 * WHAT WAS WRONG. /jobs/company/<any string> rendered "Is <X> hiring? --
 * Real, verified open roles" under robots index,follow, said "<X> has no open
 * roles on their job board at the moment", and offered "Claim this profile",
 * for tokens the board has never read: amazon, google, typos. An unbounded set
 * of indexable pages, each stating a falsehood about a real company.
 *
 * WHAT HOLDS NOW, with the list answering as the server now does
 * (unknownCompanies): the page says we do not read a board by that name, is
 * noindex, prints no not-hiring sentence and no claim offer. A carried
 * employer with an empty board keeps its honest zero answer and stays
 * indexable.
 *
 * Since the design upgrade's pass B the company page is the design lander,
 * whose model has an "uncarried" variant (src/lib/company/lander-model.ts):
 * its H1 names the token the address asked for, because a board we never
 * read has no stored name to print, and a carried board's zero answer names
 * the 30-day window it counts ("this board" until its name has loaded). The
 * assertions below read that wording; what they hold is unchanged, and the
 * uncarried page now refuses every watch control, not only one named for the
 * employer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const EMPTY = { jobs: [], total: 0, hasMore: false, nextOffset: 0, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null };

/** The list as job-board answers it: uncarried tokens named, a carried empty board not. */
function answer(carried: boolean) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 0 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const companies = (b.companies as string[] | undefined) ?? [];
      return { data: carried || !companies.length ? EMPTY : { ...EMPTY, unknownCompanies: companies }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
function mount(url: string) {
  window.history.replaceState({}, "", url);
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}
const robots = () => [...document.head.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content") ?? "");
const h1 = () => document.querySelector("h1")?.textContent ?? "";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("a company page for an employer the board does not carry", () => {
  it("says we don't carry it, is noindex, and claims nothing about the employer", async () => {
    answer(false);
    mount("/jobs/company/amazon");
    await waitFor(() => expect(h1(), "the page never said it does not carry the employer").toMatch(/We don.t read a board called .amazon. yet/), SLOW);
    expect(document.body.textContent, "an employer we never read was said to be not hiring").not.toMatch(/has no open roles|No roles (?:at|on) /);
    expect(screen.queryByText(/Claim this profile/), "a claim offer on a page for an employer we do not carry").toBeNull();
    expect(screen.queryByRole("button", { name: /Alert me when this exists/ }), "an alert for postings that can never arrive").toBeNull();
    expect(screen.queryByRole("button", { name: /^Watch / }), "a watch on an employer we do not read").toBeNull();
    await waitFor(() => expect(robots().some((r) => /noindex/.test(r)), `robots: ${robots().join(" | ") || "none"}`).toBe(true), SLOW);
    expect(document.title).not.toMatch(/Is Amazon hiring|open roles from their own hiring system/i);
  });

  it("a carried employer with an empty board keeps its honest answer and stays indexable", async () => {
    answer(true);
    mount("/jobs/company/acme");
    await waitFor(() => expect(document.body.textContent).toMatch(/No roles (?:at Acme|on this board) dated in the last 30 days/), SLOW);
    expect(h1()).not.toMatch(/We don.t read a board/);
    expect(screen.queryByRole("button", { name: /^Watch (?:Acme|this board)/ }), "the positive control: a carried employer keeps its watch").not.toBeNull();
    expect(robots().some((r) => /noindex/.test(r))).toBe(false);
  });
});
