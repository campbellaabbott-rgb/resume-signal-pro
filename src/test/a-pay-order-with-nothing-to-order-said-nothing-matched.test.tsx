// A PAY ORDER WITH NOTHING TO ORDER SAID NOTHING MATCHED.
//
// The board's salary branch serves only postings with a comparable pay figure.
// When none of a search's matches states pay, its first page is empty and the
// server says why: `sortUnavailable: "no-stated-pay"` ("unavailable" when the
// pay read itself failed). The page read neither and printed its zero state,
// "No verified openings match all of that", over a search that matches
// postings, offering to remove filters when the remedy is the order.
//
// Positive control first: an ordinary empty search keeps the zero state.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Nurse ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const page = (jobs: unknown[], extra: Body = {}) => ({
  data: { jobs, total: jobs.length, totalAllCompanies: 100, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false, ...extra },
  error: null,
});
const lists: Body[] = [];
function mock(salaryReply: Body) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 0 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      lists.push(b);
      if (b.sort === "salary") return page([], salaryReply);
      return page([row(0), row(1)]);
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const text = () => document.body.textContent ?? "";
async function open(url: string) {
  window.history.replaceState({}, "", url);
  render(<MemoryRouter initialEntries={[url]}><Jobs /></MemoryRouter>);
  await waitFor(() => expect(lists.length).toBeGreaterThan(0), SLOW);
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  lists.length = 0;
  clearBoardBudgetRefusal();
});

describe("a pay order with nothing to order said nothing matched", () => {
  it("positive control: an empty pay page the server did not explain keeps the zero state", async () => {
    mock({ total: 0 });
    await open("/jobs?q=nurse&sort=salary");
    await waitFor(() => expect(text()).toContain("No openings match all of that"), SLOW);
  });

  it("no match states pay: the page says so, and the order is the remedy it offers", async () => {
    mock({ total: null, countUnavailable: true, sortUnavailable: "no-stated-pay", salaryStatedOnly: true });
    await open("/jobs?q=nurse&sort=salary");
    await waitFor(() => expect(text()).toContain("None of these matches states its pay"), SLOW);
    expect(text(), "the zero state claimed nothing matched a search that matches").not.toContain("No openings match all of that");
    expect(text(), "the screen-reader status still announced no matches").not.toContain("No openings match these filters.");
    fireEvent.click(screen.getByRole("button", { name: "Show them newest first" }));
    await waitFor(() => expect(lists.some((b) => b.sort === "newest" && b.q === "nurse")).toBe(true), SLOW);
    await waitFor(() => expect(text()).toContain("Nurse 1"), SLOW);
  });

  it("the pay read failed: the page says that, not that nothing matched", async () => {
    mock({ total: null, countUnavailable: true, sortUnavailable: "unavailable", salaryStatedOnly: true });
    await open("/jobs?q=nurse&sort=salary");
    await waitFor(() => expect(text()).toContain("We couldn't read pay for this search just now"), SLOW);
    expect(text()).not.toContain("No openings match all of that");
  });
});
