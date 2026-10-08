// /EXPLORE STATES WHAT ITS LINKS OPEN, NEVER STICKS ON "READING", AND SAYS
// WHEN THE BOARD -- NOT THE PAGE -- PAUSED IT.
//
// Three defects, each read off a real render:
//   1. "Check an employer" printed open_roles summed across ALL the employer's
//      boards (Deloitte: DeloitteAT 95 + Deloitte6 19 = 114) above a link to
//      the lander for tokens[0] alone, which serves 95. The number did not
//      survive the click.
//   2. Open a field, switch to "Check an employer" before the closure read
//      answers, come back: the cleanup had set live=false, so the answer was
//      dropped, the dedupe kept the slice's signature and the panel read
//      "Reading the closure record for this slice…" forever.
//   3. Under a board-budget refusal (429 board_budget) the page called it "our
//      measurement failing", fired every remaining counted probe anyway and
//      told the reader to "reopen it to try again" -- which fires them all
//      again. A refusal cannot clear before its reset; the board's own notice
//      says what happened and nothing is re-asked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
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

import Explore from "@/pages/Explore";
import Companies from "@/pages/Companies";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 8000 };

type Body = Record<string, unknown>;
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});
const refusal = () => httpError(429, { error: "board_budget", code: "address", limit: 10000, used: 10000, resetAt: new Date(Date.now() + 3600_000).toISOString() });
const cache = () => ({
  data: { fields: { healthcare: 52000 }, field_grid: { tiled_n: 52000, board: { n: 60000 } }, totals: { postings_n: 60000, employers_n: 900 }, repost_index: {}, stale_parts: [], computed_at: new Date().toISOString() },
});
const boardCalls = () => invoke.mock.calls.filter(([fn]) => fn === "job-board");
const text = () => document.body.textContent ?? "";
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const mount = (url: string) => {
  window.history.replaceState({}, "", url);
  return render(<MemoryRouter initialEntries={[url]}><Explore /></MemoryRouter>);
};

beforeEach(() => {
  invoke.mockReset(); rpc.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(() => { clearBoardBudgetRefusal(); document.body.innerHTML = ""; });

describe("1. the employer check's number survives its click", () => {
  function suggest(hits: unknown[]) {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return cache();
      if (fn === "get_company_suggest") return { data: hits, error: null };
      return { data: [], error: null };
    });
    invoke.mockImplementation(async () => ({ data: { categories: { healthcare: 52000 }, refreshedAt: new Date().toISOString() }, error: null }));
  }
  const cardFor = (name: string) => screen.getAllByRole("link").find((a) => (a.textContent ?? "").includes(name));

  it("an employer on two boards links the board scoped to BOTH, under the summed count", async () => {
    suggest([{ name: "Deloitte", tokens: ["DeloitteAT", "Deloitte6"], open_roles: 114, feed_total: null, feed_total_at: null }]);
    mount("/explore?i=check");
    fireEvent.change(screen.getByPlaceholderText("Type a company name…"), { target: { value: "deloitte" } });
    await waitFor(() => expect(cardFor("Deloitte")).toBeTruthy(), SLOW);
    const href = cardFor("Deloitte")!.getAttribute("href") ?? "";
    const u = new URL(href, "https://resumebooster.work");
    expect(u.pathname, `the card linked one board's lander: ${href}`).toBe("/jobs");
    expect(u.searchParams.get("company")).toBe("DeloitteAT,Deloitte6");
    expect(u.searchParams.get("from")).toBe("explore");
    // ...and the way back to the check the reader was on.
    expect(new URLSearchParams(u.searchParams.get("back")?.split("?")[1] ?? "").get("i")).toBe("check");
    expect(cardFor("Deloitte")!.textContent).toContain("114");
  });

  it("positive control: a single-board employer still links its lander, with the way back", async () => {
    suggest([{ name: "Acme", tokens: ["acme"], open_roles: 40, feed_total: null, feed_total_at: null }]);
    mount("/explore?i=check");
    fireEvent.change(screen.getByPlaceholderText("Type a company name…"), { target: { value: "acme" } });
    await waitFor(() => expect(cardFor("Acme")).toBeTruthy(), SLOW);
    const u = new URL(cardFor("Acme")!.getAttribute("href") ?? "", "https://resumebooster.work");
    expect(u.pathname).toBe("/jobs/company/acme");
    expect(u.searchParams.get("from")).toBe("explore");
    expect(new URLSearchParams(u.searchParams.get("back")?.split("?")[1] ?? "").get("i")).toBe("check");
    expect(cardFor("Acme")!.textContent).toContain("40");
  });
});

describe("2. a tab round-trip does not leave the closure panel reading forever", () => {
  it("leaving before the closure read answers, then returning, reads again and settles", async () => {
    let holdFirst = true;
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return cache();
      return { data: [], error: null };
    });
    invoke.mockImplementation(async (_fn: string, o: { body?: Body } | undefined) => {
      const b = o?.body ?? {};
      if (b.action === "facets") return { data: { categories: { healthcare: 52000 }, refreshedAt: new Date().toISOString() }, error: null };
      if (b.action === "list" && b.limit === 60) {
        if (holdFirst) { holdFirst = false; await new Promise((r) => setTimeout(r, 1500)); }
        return { data: { jobs: [], total: 0 }, error: null };
      }
      return { data: { jobs: [], total: 10, ranked: true }, error: null };
    });
    mount("/explore?i=fields&f=healthcare");
    await waitFor(() => expect(text()).toContain("Reading the closure record for this slice"), SLOW);
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]); // Check an employer, before the read answers
    await settle(50);
    fireEvent.click(tabs[0]); // and back
    await settle(2000);       // the first read has answered by now, to a dead run
    await waitFor(() => expect(text(), "the closure panel stuck on its loading line").not.toContain("Reading the closure record for this slice"), SLOW);
  });
});

describe("3. a budget refusal is the board's, said once, and never re-asked", () => {
  it("explore: the notice, none of 'our instrument failing', and no stream of refused probes", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return cache();
      return { data: [], error: null };
    });
    invoke.mockImplementation(async () => refusal());
    mount("/explore");
    // The page view's one counted read (the field facet) is refused...
    await waitFor(() => expect(document.querySelector("[data-board-budget-notice]"), "no budget notice on /explore").toBeTruthy(), SLOW);
    expect(text()).not.toMatch(/our measurement failing/);
    const before = boardCalls().length;
    // ...and opening a field, then closing and reopening it, asks nothing more.
    const row = () => screen.getAllByRole("button", { name: /Healthcare/ })[0];
    fireEvent.click(row());
    await settle(1200);
    fireEvent.click(row());
    await settle(100);
    fireEvent.click(row());
    await settle(1200);
    expect(boardCalls().length - before, "refused probes kept firing on every open").toBe(0);
    expect(text()).not.toMatch(/our instrument failing|reopen it to try again|our measurement failing/);
  });

  it("companies: the notice instead of an empty list", async () => {
    invoke.mockImplementation(async () => refusal());
    render(<MemoryRouter><Companies /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-board-budget-notice]"), "no budget notice on /companies").toBeTruthy(), SLOW);
  });
});
