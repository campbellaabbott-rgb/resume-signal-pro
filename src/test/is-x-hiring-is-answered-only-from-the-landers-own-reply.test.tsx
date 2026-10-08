// "IS X HIRING?" IS ANSWERED ONLY FROM THE LANDER'S OWN REPLY.
//
// /jobs/company/<token> is the indexed page for "is <employer> hiring?", and
// the sentence under its H1 is the answer. It used to read whatever list was
// on screen:
//   - a list read that failed twice (503) or was refused (429 board_budget)
//     left `data` null, `?? 0` made that a zero, and the page printed
//     "Not right now — Acme has no open roles" next to the error panel;
//   - typing "astronaut" on a lander with 412 roles printed the same
//     sentence over the empty SEARCH, and a partial match printed
//     "Yes — 3 verified open roles right now".
//
// The guard this replaces regex-matched the render expression, so it passed
// while every one of those happened and would have failed a correct fix.
// These cases mount the real page with the board mocked and read the screen.
// The positive controls come first: an unnarrowed successful reply still
// answers "Yes — 412", and a successful zero still answers "Not right now".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Registered Nurse ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const page = (n: number, total: number, extra: Body = {}) => ({
  data: {
    jobs: Array.from({ length: n }, (_, i) => row(i)), total, totalAllCompanies: 9000,
    companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0,
    refreshedAt: null, hasMore: false, ...extra,
  },
  error: null,
});
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});

/** `list` answers the lander's page reads; everything else answers healthily. */
function mock(list: (b: Body) => unknown) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 0 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return list(b);
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const mount = (url = "/jobs/company/acme") => {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
    </MemoryRouter>,
  );
};
const text = () => document.body.textContent ?? "";
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const listReads = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list"
    && !(o as { body?: Body }).body?.countOnly && !(o as { body?: Body }).body?.facetCounts);

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(() => clearBoardBudgetRefusal());

describe("is X hiring? is answered only from the lander's own reply", () => {
  it("positive control: an unnarrowed successful reply answers yes, with its number", async () => {
    mock(() => page(6, 412));
    mount();
    await waitFor(() => expect(text()).toMatch(/Yes — 412 verified open roles right now/), SLOW);
    expect(text()).not.toMatch(/Not right now/);
  });

  it("positive control: a successful zero still answers no", async () => {
    mock(() => page(0, 0));
    mount();
    await waitFor(() => expect(text()).toMatch(/Not right now — Acme has no open roles/i), SLOW);
  });

  it("a list read that failed twice answers nothing, beside the error", async () => {
    mock(() => httpError(503, { error: "unavailable" }));
    mount();
    // Both attempts (the read and its one quiet retry) have failed.
    await waitFor(() => expect(listReads().length).toBeGreaterThanOrEqual(2), SLOW);
    await waitFor(() => expect(text()).toMatch(/couldn.t load|Try again/i), SLOW);
    await settle(50);
    expect(text(), "a failed read was published as 'not hiring'").not.toMatch(/Not right now/);
    expect(text()).not.toMatch(/Yes — /);
  });

  it("a refused read answers nothing, beside the notice", async () => {
    mock(() => httpError(429, { error: "board_budget", code: "address", limit: 10000, used: 10000, resetAt: new Date(Date.now() + 3600_000).toISOString() }));
    mount();
    await waitFor(() => expect(document.querySelector("[data-board-budget-notice]")).toBeTruthy(), SLOW);
    await settle(50);
    expect(text(), "a refusal was published as 'not hiring'").not.toMatch(/Not right now/);
    expect(text()).not.toMatch(/Yes — /);
  });

  it("a search inside the lander is not the employer's answer, empty or partial", async () => {
    mock((b) => (b.q === "astronaut" ? page(0, 0) : b.q === "nurse" ? page(3, 3) : page(6, 412)));
    mount();
    await waitFor(() => expect(text()).toMatch(/Yes — 412 verified/), SLOW);
    const box = document.getElementById("board-search") as HTMLInputElement;
    expect(box, "the search box lost its id — re-anchor").toBeTruthy();

    fireEvent.change(box, { target: { value: "astronaut" } });
    await waitFor(() => expect(listReads().some(([, o]) => (o as { body: Body }).body.q === "astronaut")).toBe(true), SLOW);
    await waitFor(() => expect(text()).not.toMatch(/Registered Nurse 5/), SLOW);
    await settle(50);
    expect(text(), "an empty in-company search printed 'not hiring'").not.toMatch(/Not right now/);
    expect(text()).not.toMatch(/Yes — /);

    fireEvent.change(box, { target: { value: "nurse" } });
    await waitFor(() => expect(text()).toMatch(/Registered Nurse 2/), SLOW);
    await settle(50);
    expect(text(), "a partial in-company match printed as the employer's total").not.toMatch(/Yes — 3 verified/);
  });

  it("a page whose rows match only in descriptions is not an empty employer", async () => {
    mock(() => page(6, 0, { relatedTotal: 1314 }));
    mount();
    await waitFor(() => expect(text()).toMatch(/Registered Nurse 5/), SLOW);
    await settle(50);
    expect(text()).not.toMatch(/Not right now/);
  });

  it("a withdrawn count answers nothing", async () => {
    mock(() => page(6, null as unknown as number, { countUnavailable: true }));
    mount();
    await waitFor(() => expect(text()).toMatch(/Registered Nurse 5/), SLOW);
    await settle(50);
    expect(text()).not.toMatch(/Not right now/);
    expect(text()).not.toMatch(/Yes — /);
  });
});
