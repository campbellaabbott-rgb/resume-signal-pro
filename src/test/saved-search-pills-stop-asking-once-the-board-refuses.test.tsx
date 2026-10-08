// SAVED-SEARCH PILLS STOP ASKING ONCE THE BOARD REFUSES.
//
// Each pill's "+N new" badge is a counted board read (countOnly). They were
// fired all at once and regardless of a board-budget refusal, so a refused
// connection spent one refused read per pill on every page that shows them
// (/jobs and /explore) -- and a refusal cannot clear before its reset
// (src/lib/board-budget.ts). Now the first refusal stops the rest, and a
// standing one sends nothing; the pills themselves still render and open.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { clearBoardBudgetRefusal, markBoardBudgetRefused } from "@/lib/board-budget";

const invoke = vi.fn();
const SEARCHES = [
  { id: "s1", name: "Nurse in Leeds", params: { q: "nurse", location: "Leeds" }, last_seen_at: "2026-10-01T00:00:00Z" },
  { id: "s2", name: "Remote designer", params: { q: "designer", workMode: "remote" }, last_seen_at: "2026-10-01T00:00:00Z" },
  { id: "s3", name: "Welder NZ", params: { q: "welder", country: "NZ" }, last_seen_at: "2026-10-01T00:00:00Z" },
];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => {
      const th: Record<string, unknown> = {};
      const self = () => th;
      for (const k of ["select", "order", "eq", "update"]) th[k] = self;
      th.limit = async () => ({ data: SEARCHES });
      return th;
    },
    rpc: async () => ({ data: [], error: null }),
  },
}));
// ONE user object: the pills effect depends on `user`, and a fresh object per
// render would re-run it forever.
const USER = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: USER, session: null }) }));

import { SavedSearchPills } from "@/components/jobs/SavedSearchPills";

const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});
const probes = () => invoke.mock.calls.filter(([fn, o]) => fn === "job-board" && (o as { body?: { countOnly?: boolean } })?.body?.countOnly === true);
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); });

describe("saved-search pills stop asking once the board refuses", () => {
  it("positive control: a healthy board answers one probe per pill", async () => {
    invoke.mockImplementation(async () => ({ data: { total: 4 }, error: null }));
    render(<MemoryRouter><SavedSearchPills /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Welder NZ")).toBeTruthy());
    await waitFor(() => expect(probes().length).toBe(3));
  });

  it("the first refusal stops the rest", async () => {
    invoke.mockImplementation(async () => httpError(429, { error: "board_budget", code: "address", limit: 10000, used: 10000, resetAt: new Date(Date.now() + 3600_000).toISOString() }));
    render(<MemoryRouter><SavedSearchPills /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Welder NZ")).toBeTruthy());
    await settle(200);
    expect(probes().length, "every pill spent a refused read").toBe(1);
  });

  it("a standing refusal sends nothing, and the pills still render", async () => {
    markBoardBudgetRefused({ code: "address", limit: 10000, resetAt: new Date(Date.now() + 3600_000).toISOString() });
    invoke.mockImplementation(async () => ({ data: { total: 4 }, error: null }));
    render(<MemoryRouter><SavedSearchPills /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Nurse in Leeds")).toBeTruthy());
    await settle(200);
    expect(probes().length).toBe(0);
  });
});
