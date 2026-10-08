// AN ORDER CLAIM SPEAKS ONLY FOR THE REPLY ON SCREEN, AND NAMES THE ORDER IT IS.
//
// Two defects in the one line beside the sort control:
//   1. On /jobs?q=engineer `data` is null before the first reply, so the query
//      arm fell through `exactWordMatch` / `sortScope` / `ranked` to the date
//      arm and printed a crawl-date order over results about to be ranked by
//      relevance; typing a query over a browse kept the browse reply (no
//      `ranked`) and printed the same claim until the new reply landed. That
//      window is the root of the newest-first flake (register L12-04/L12-05).
//   2. The "Recently found by us" order -- and every sentence describing it --
//      said "ordered by when we first saw each posting — our date, not the
//      employer's". The server orders that view by effective_posted =
//      coalesce(posted_at, last_seen), with last_seen written at insert only:
//      the EMPLOYER'S date wherever they state one, our first-seen stamp only
//      where they do not. "Our date, not the employer's" was false for every
//      dated posting on the page.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Software Engineer ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
let release: (() => void) | null = null;
function mock(opts: { holdSearch: boolean }) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const base = { jobs: [row(0), row(1), row(2)], total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false };
      if (b.q) {
        if (opts.holdSearch) await new Promise<void>((r) => { release = r; });
        return { data: { ...base, ranked: true }, error: null };
      }
      return { data: base, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const text = () => document.body.textContent ?? "";
const DATE_CLAIM = /ordered by (when we first saw|each employer's stated date)/;
const searchBodies = () => invoke.mock.calls.filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list" && !!(o as { body?: Body }).body?.q && !(o as { body?: Body }).body?.countOnly && !(o as { body?: Body }).body?.facetCounts);

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  release = null;
});

describe("an order claim speaks only for the reply on screen", () => {
  it("a search arriving by URL claims no date order before its reply, and relevance after", async () => {
    mock({ holdSearch: true });
    window.history.replaceState({}, "", "/jobs?q=engineer");
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(release, "the search never went out").not.toBeNull(), SLOW);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(text(), "a date order was claimed over a search still loading").not.toMatch(DATE_CLAIM);
    await act(async () => { release!(); });
    await waitFor(() => expect(text()).toContain("ordered by relevance to your search"), SLOW);
  });

  it("typing a query over a browse claims no date order while the search loads", async () => {
    mock({ holdSearch: true });
    window.history.replaceState({}, "", "/jobs");
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(text()).toContain("Software Engineer 2"), SLOW);
    fireEvent.change(document.getElementById("board-search") as HTMLInputElement, { target: { value: "engineer" } });
    await waitFor(() => expect(searchBodies().length).toBeGreaterThan(0), SLOW);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(text(), "the browse reply's date claim stood over the search").not.toMatch(DATE_CLAIM);
    await act(async () => { release!(); });
    await waitFor(() => expect(text()).toContain("ordered by relevance to your search"), SLOW);
  });
});

describe("the discovery order names both halves of what it is", () => {
  it("the sort option and its claim name the employer's date, and ours only for the undated", async () => {
    mock({ holdSearch: false });
    window.history.replaceState({}, "", "/jobs?sort=discovered");
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(text()).toContain("Software Engineer 2"), SLOW);
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options, "the option still says the list is in our found-it order").not.toContain("Recently found by us");
    expect(options).toContain("Newest, undated by our date");
    await waitFor(() => expect(text()).toMatch(/ordered by each employer's stated date — or, for a posting with no date, by when we first saw it/), SLOW);
    expect(text(), "the half-truth is back: dated rows are in the employer's order").not.toMatch(/our date, not the employer's/);
  });
});
