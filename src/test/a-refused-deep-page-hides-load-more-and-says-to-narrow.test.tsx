// A REFUSED DEEP PAGE HIDES LOAD MORE AND SAYS TO NARROW (sweep BOARD-02, the page's half).
//
// WHAT WAS WRONG. The board does not serve a list by offset past its first
// 10,000 results: it answers 400 offset_too_deep. A browse paged by a cursor is
// exempt, but newest first, a search and the pay order are not. The page read
// that refusal as an ordinary failure: it retried once, failed again, printed
// "Couldn't load more just now" over a "Try again" button, and every press of
// it was the same refused request. Load more had become a button that could
// never work, with nothing saying so.
//
// WHAT HOLDS NOW, on the mounted board when the next page is refused that way:
//   - the refusal is asked for once and never retried;
//   - Load more and Try again leave, and one sentence says to narrow the list;
//   - the rows already loaded stay;
//   - a new search brings Load more back;
//   - control: an ordinary failed page still offers Try again.
// The server's half (a newest-first browse paging on by its cursor past
// 10,000) is the jobs build's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async (fn: string) => rpcAnswer(fn),
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
let rpcAnswer: (fn: string) => unknown = () => ({ data: [], error: null });

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const row = (n: number, title = "Nurse") => ({
  id: `greenhouse:acme:${title}:${n}`, token: "acme", company: `Employer ${n}`, title: `${title} ${n}`, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${title}/${n}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});
const TOO_DEEP = () => httpError(400, { error: "offset_too_deep", maxOffset: 10000, message: "Pages past the first 10,000 results are not served by offset." });

/** What the board answers for a page past the first. */
let nextPage: () => unknown = TOO_DEEP;
let deepAsks = 0;

function mount() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 20000 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      if (Number(b.offset) > 0) { deepAsks++; return nextPage(); }
      const title = typeof b.q === "string" && b.q ? "Welder" : "Nurse";
      return { data: { jobs: [row(1, title), row(2, title), row(3, title)], total: 20000, totalAllCompanies: 20000, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: true, nextOffset: 10020 }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
const NARROW = "The board does not page any further down this list.";
const button = (name: string) => screen.queryByRole("button", { name });
async function loadMore() {
  mount();
  await waitFor(() => expect(text()).toContain("Nurse 3"), SLOW);
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }, SLOW));
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  nextPage = TOO_DEEP;
  deepAsks = 0;
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("the next page is refused as too deep", () => {
  it("says to narrow the list, takes Load more away and keeps the rows", async () => {
    await loadMore();
    await waitFor(() => expect(text()).toContain(NARROW), SLOW);
    expect(document.querySelector("[data-load-more-too-deep]")).not.toBeNull();
    expect(button("Load more"), "a button that can never work was left on the page").toBeNull();
    expect(button("Try again"), "a retry of a request that cannot succeed was offered").toBeNull();
    expect(text()).not.toContain("Couldn't load more just now");
    for (const n of [1, 2, 3]) expect(text()).toContain(`Nurse ${n}`);
  });

  it("asks once: the refusal is not retried", async () => {
    await loadMore();
    await waitFor(() => expect(text()).toContain(NARROW), SLOW);
    // The old path retried 1.2 s after the first refusal.
    await new Promise((r) => setTimeout(r, 1700));
    expect(deepAsks, "a page the board had just refused as too deep was asked for again").toBe(1);
  });

  it("a new search brings Load more back", async () => {
    await loadMore();
    await waitFor(() => expect(text()).toContain(NARROW), SLOW);
    fireEvent.change(screen.getByLabelText("Search jobs by title or keyword"), { target: { value: "welder" } });
    await waitFor(() => expect(text()).toContain("Welder 3"), SLOW);
    await waitFor(() => expect(button("Load more"), "Load more stayed hidden over a new list").not.toBeNull(), SLOW);
    expect(text()).not.toContain(NARROW);
  });
});

describe("control: the next page fails for an ordinary reason", () => {
  it("keeps the rows and offers Try again, as before", async () => {
    nextPage = () => httpError(503, { error: "unavailable" });
    await loadMore();
    await waitFor(() => expect(text()).toContain("Couldn't load more just now"), SLOW);
    expect(button("Try again")).not.toBeNull();
    expect(text()).not.toContain(NARROW);
    expect(deepAsks, "an ordinary failure is retried once before it is reported").toBe(2);
  });
});
