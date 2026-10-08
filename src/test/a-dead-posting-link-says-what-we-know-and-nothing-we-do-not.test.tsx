// A DEAD POSTING LINK SAYS WHAT WE KNOW, AND NOTHING WE DO NOT.
//
// A shared /jobs?job=<id> whose posting is not in the loaded list is resolved
// with the board's `detail` action. Three of its answers were rendered wrong:
//   - a bare 404 (the row is gone at our cap and no closure was recorded)
//     printed "no longer live — it was filled or taken down", a claim about
//     the employer we have no evidence for;
//   - a 200 carrying only a description (the row is hidden while the
//     employer still serves it) fell to the same sentence and threw the
//     description away;
//   - any other failure returned silently: no message, no retry, and the
//     ?job= left in the address held back desktop auto-select.
// And a dead link under filters that matched nothing set noindex and the
// title while its banner lived inside the list branch, so the visitor saw
// only the generic zero-state.
//
// Mounted against the real page; the positive control is a watched closure,
// which still says "filled or taken down" because that one we saw happen.
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
const DEAD = "greenhouse:acme:999";
const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Welder ${i}`,
  location: "Auckland, New Zealand", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});
let detail: () => unknown = () => ({ data: null, error: null });
let listRows = 3;
function mock() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") return detail();
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 0 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const rows = Array.from({ length: listRows }, (_, i) => row(i));
      return { data: { jobs: rows, total: rows.length, totalAllCompanies: 50, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const mount = (url: string) => {
  window.history.replaceState({}, "", url);
  return render(<MemoryRouter initialEntries={[url]}><Jobs /></MemoryRouter>);
};
const text = () => document.body.textContent ?? "";
const noindex = () => Array.from(document.querySelectorAll('meta[name="robots"]')).some((m) => /noindex/.test(m.getAttribute("content") ?? ""));
const detailCalls = () => invoke.mock.calls.filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "detail").length;
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  document.getElementById("spa-dead-state-robots")?.remove();
  listRows = 3;
  mock();
});

describe("a dead posting link says what we know and nothing we do not", () => {
  it("positive control: a closure we watched still says filled or taken down", async () => {
    detail = () => ({ data: { job: null, closed: { title: "Senior Welder", company: "Acme", closedAt: new Date().toISOString() } }, error: null });
    mount(`/jobs?job=${DEAD}`);
    await waitFor(() => expect(text()).toMatch(/“Senior Welder” at Acme is no longer live — it was filled or taken down/), SLOW);
    // The robots tag is a passive effect after the paint above: waited for.
    await waitFor(() => expect(noindex()).toBe(true), SLOW);
  });

  it("a bare 404 is no longer listed HERE, with no claim about the employer", async () => {
    detail = () => httpError(404, { error: "Posting not found (it may have closed)" });
    mount(`/jobs?job=${DEAD}`);
    await waitFor(() => expect(text()).toMatch(/no longer listed on this board/), SLOW);
    expect(text(), "a 404 was published as the employer filling the role").not.toMatch(/filled or taken down/);
    // Still a dead URL for this board, so still noindex.
    await waitFor(() => expect(noindex()).toBe(true), SLOW);
  });

  it("a description-only reply is unlisted and offers the description it carried", async () => {
    detail = () => ({ data: { job: null, description: "Weld structural steel to AS/NZS 1554. Night shift allowance applies." }, error: null });
    mount(`/jobs?job=${DEAD}`);
    await waitFor(() => expect(text()).toMatch(/no longer listed on this board/), SLOW);
    expect(text()).not.toMatch(/filled or taken down/);
    const summary = screen.getByText("Read the last description we held");
    fireEvent.click(summary);
    expect(text()).toContain("Night shift allowance applies.");
  });

  it("a failed read says so, offers a retry, and claims nothing", async () => {
    let n = 0;
    // The read and its one quiet retry both fail; the visitor's Try again succeeds.
    detail = () => (++n <= 2 ? httpError(503, { error: "unavailable" }) : { data: { job: { ...row(9), id: DEAD, title: "Pipe Welder" }, description: "x".repeat(300) }, error: null });
    mount(`/jobs?job=${DEAD}`);
    await waitFor(() => expect(text()).toMatch(/couldn't load the posting in that link/), SLOW);
    await settle(50); // an absence is only meaningful once the effects have run
    expect(noindex(), "a failed read marked a possibly-live posting noindex").toBe(false);
    expect(text()).not.toMatch(/filled or taken down|no longer listed/);
    const before = detailCalls();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(detailCalls()).toBe(before + 1), SLOW);
    await waitFor(() => expect(text()).not.toMatch(/couldn't load the posting in that link/), SLOW);
    await waitFor(() => expect(text()).toContain("Pipe Welder"), SLOW);
  });

  it("a dead link under filters that match nothing shows its answer, not only the zero-state", async () => {
    listRows = 0;
    detail = () => ({ data: { job: null, closed: { title: "Senior Welder", company: "Acme", closedAt: new Date().toISOString() } }, error: null });
    mount(`/jobs?q=welder&country=NZ&job=${DEAD}`);
    await waitFor(() => expect(noindex()).toBe(true), SLOW);
    await settle(50);
    expect(text(), "noindex and the title were set while the visitor saw no answer").toMatch(/“Senior Welder” at Acme is no longer live/);
  });
});
