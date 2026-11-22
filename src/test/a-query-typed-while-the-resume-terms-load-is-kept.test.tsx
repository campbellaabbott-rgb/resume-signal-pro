// A QUERY TYPED WHILE THE RÉSUMÉ'S TERMS LOAD IS KEPT (S10-067).
//
// WHAT WAS WRONG. A visitor who arrives with a résumé has the board read role
// titles out of it and search for the first one, unless they have already
// stated what they want. "Already stated" was tested on the search box as it
// was when the lookup BEGAN: the lookup is a network call, and a query typed
// while it was out was typed over by the résumé's title when it came back.
//
// WHAT HOLDS NOW, on the mounted board with the lookup held open:
//   - a query typed during the lookup is still in the box afterwards, and the
//     résumé's title is never searched;
//   - control: with nothing typed, the résumé's title is searched as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
const RESUME = "Product manager with eight years of experience shipping consumer software to millions of people. ".repeat(3);
const row = (n: number, title: string) => ({
  id: `greenhouse:acme:${n}`, token: "acme", company: `Employer ${n}`, title, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${n}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});

let searchedFor: string[] = [];
let termsAsked = 0;
let releaseTerms: () => void = () => {};

function mount() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") {
      termsAsked++;
      await new Promise<void>((release) => { releaseTerms = release; });
      return { data: { terms: ["Product Manager"] }, error: null };
    }
    if (fn === "job-fit" && b.action === "fit-batch") {
      const ids = (b.ids as string[]) ?? [];
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, 50])), unscored: {}, missing: {}, matched: {} }, error: null };
    }
    if (fn !== "job-board") return { data: null, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 2 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const q = typeof b.q === "string" ? b.q : "";
      if (q) searchedFor.push(q);
      const jobs = [row(1, `${q || "Any"} one`), row(2, `${q || "Any"} two`)];
      return { data: { jobs, total: 2, totalAllCompanies: 2, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

/** The board's search box: the filter bar's keyword field. */
const searchBox = () => screen.getByLabelText("Search jobs by title or keyword") as HTMLInputElement;

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  // A résumé this tab already holds: the board looks its role up as it opens.
  sessionStorage.setItem("rb_board_resume", RESUME);
  searchedFor = [];
  termsAsked = 0;
  releaseTerms = () => {};
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(() => { releaseTerms(); cleanup(); });

describe("the résumé's role arrives after the reader has typed", () => {
  it("the typed query stays in the box and the résumé's title is never searched", async () => {
    mount();
    await waitFor(() => expect(document.body.textContent).toContain("Any one"), SLOW);
    await waitFor(() => expect(termsAsked, "the résumé's role was never looked up").toBe(1), SLOW);
    fireEvent.change(searchBox(), { target: { value: "welder" } });
    await waitFor(() => expect(searchedFor).toContain("welder"), SLOW);
    await act(async () => { releaseTerms(); await new Promise((r) => setTimeout(r, 900)); });
    expect(searchBox().value, "the résumé's title was typed over the reader's own query").toBe("welder");
    expect(searchedFor, "the board searched for a role the reader did not ask for").not.toContain("Product Manager");
    expect(document.body.textContent).toContain("welder one");
  });

  it("control: with nothing typed, the résumé's title is searched", async () => {
    mount();
    await waitFor(() => expect(termsAsked).toBe(1), SLOW);
    await act(async () => { releaseTerms(); });
    await waitFor(() => expect(searchedFor).toContain("Product Manager"), SLOW);
    await waitFor(() => expect(searchBox().value).toBe("Product Manager"), SLOW);
  });
});
