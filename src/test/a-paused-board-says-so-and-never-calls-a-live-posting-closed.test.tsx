/**
 * A PAUSED BOARD SAYS SO, AND NEVER CALLS A LIVE POSTING CLOSED.
 *
 * job-board now counts anonymous reads per connection and answers past the cap
 * with a 429 whose body says `error: "board_budget"` (anon-budget.ts). Before
 * the page knew that word, a refusal would have landed as:
 *   - "The board couldn't load right now" with a Try again button -- and the
 *     list call quietly retried after 1.2s, a second refused request;
 *   - on a deep link, "Posting no longer available" plus a noindex tag on a
 *     LIVE posting, because any failed detail call was read as a dead link;
 *   - on hover, "" cached as "this employer wrote no description" for every
 *     card under the pointer.
 *
 * Held here, by mounting the real page with the board mocked:
 *   - a refused first page renders the notice, not the generic error and not
 *     a retry, and the list is asked ONCE;
 *   - a refused deep link shows no dead link and adds no noindex, while a 404
 *     (the positive control: the server's own "no such posting") still does;
 *   - after a refusal, hovering cards sends ZERO detail calls, and opening a
 *     posting never claims its employer wrote nothing;
 *   - the country variant carries no number;
 *   - THE EVIDENCE BEHIND THE CAP: a desktop deep-link load -- the scraper's
 *     exact URL shape -- makes exactly five counted calls (actions read from
 *     anon-budget.ts's own set), and the address cap is at least 1,500 such
 *     loads a day, so a person never meets it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { ADDRESS_DAILY_CAP, BUDGETED_ACTIONS } from "../../supabase/functions/job-board/anon-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [] }),
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

const RESET_AT = new Date(Date.now() + 6 * 3600_000).toISOString();
const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: `Acme ${i}`, title: `Registered Nurse ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
/** What supabase-js hands back for a non-2xx: data null, the Response on error.context, body unread. */
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});
const refusal = (code: "address" | "country" = "address") =>
  httpError(429, { error: "board_budget", code, message: "x", limit: 10000, used: 10000, resetAt: RESET_AT });

type Call = { action: string; body: Record<string, unknown> };
let calls: Call[] = [];
/** Per-action override; anything not named answers healthily. */
let refuse: (c: Call) => unknown = () => null;

function mock() {
  invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const body = opts?.body ?? {};
    const c: Call = { action: String(body.action ?? "list"), body };
    calls.push(c);
    const override = refuse(c);
    if (override) return override;
    if (c.action === "status") return { data: { version: "x" }, error: null };
    if (c.action === "facets") return { data: { categories: { healthcare: 10 }, refreshedAt: new Date().toISOString(), sources: { greenhouse: 10 } }, error: null };
    if (c.action === "detail") return { data: { job: row(999), description: "x".repeat(400) }, error: null };
    if (c.action === "verify") return { data: { live: {} }, error: null };
    if (c.action === "click") return { data: { ok: true }, error: null };
    if (c.action === "list") {
      if (body.countOnly) return { data: { total: 5 }, error: null };
      if (body.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: Array.from({ length: 6 }, (_, i) => row(i)), total: 500, totalAllCompanies: 500, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: true, nextOffset: 6 }, error: null };
    }
    return { data: null, error: null };
  });
}
const isPageList = (c: Call) => c.action === "list" && !c.body.countOnly && !c.body.facetCounts && !c.body.q;
function setDesktop(desk: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desk && /min-width:\s*1024px/.test(query), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const mount = (url: string) => {
  window.history.replaceState({}, "", url);
  return render(<MemoryRouter initialEntries={[url]}><Jobs /></MemoryRouter>);
};
const noindex = () => document.head.querySelector('meta[name="robots"][content="noindex"]');
const PAUSED = /The job board is paused for this connection/;

describe("a paused board says so, and never calls a live posting closed", () => {
  beforeEach(() => {
    invoke.mockReset(); calls = []; refuse = () => null; mock();
    clearBoardBudgetRefusal(); setDesktop(false);
  });
  afterEach(() => { clearBoardBudgetRefusal(); document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove()); });

  it("a refused first page renders the notice, offers no retry, and asks for the list once", async () => {
    refuse = (c) => (isPageList(c) ? refusal() : null);
    mount("/jobs");
    await waitFor(() => expect(screen.getByText(PAUSED)).toBeInTheDocument(), SLOW);
    expect(screen.getByText(/used today's allowance of 10,000 job board reads/)).toBeInTheDocument();
    expect(document.querySelector("[data-board-budget-notice]")?.textContent ?? "", "a person to write to").toMatch(/resumeboostersupp@gmail\.com/);
    await settle(1800); // past the 1.2s quiet retry, had there been one
    expect(calls.filter(isPageList), "a refusal is never retried").toHaveLength(1);
    expect(screen.queryByText(/The board couldn't load right now/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Try again$/ })).toBeNull();
  });

  it("a refused deep link shows no dead link and adds no noindex; a 404 still does", async () => {
    refuse = (c) => (c.action === "detail" ? refusal() : null);
    const first = mount("/jobs?job=greenhouse:acme:5555");
    await waitFor(() => expect(calls.some((c) => c.action === "detail")).toBe(true), SLOW);
    await waitFor(() => expect(screen.getByText(PAUSED)).toBeInTheDocument(), SLOW);
    await settle(400);
    expect(screen.queryByText(/no longer live/)).toBeNull();
    expect(noindex(), "a live posting must not be told to crawlers as gone").toBeNull();
    expect(calls.filter((c) => c.action === "detail"), "and the refused detail is not retried").toHaveLength(1);
    first.unmount();

    // The positive control: the server's own answer "no such posting".
    clearBoardBudgetRefusal(); calls = [];
    refuse = (c) => (c.action === "detail" ? httpError(404, { error: "Posting not found (it may have closed)" }) : null);
    mount("/jobs?job=greenhouse:acme:6666");
    await waitFor(() => expect(screen.getByText(/no longer live/)).toBeInTheDocument(), SLOW);
    expect(noindex(), "a real dead link is still marked for crawlers").not.toBeNull();
    expect(screen.queryByText(PAUSED)).toBeNull();
  });

  it("after a refusal, hovering cards sends no detail call and no panel claims the employer wrote nothing", async () => {
    refuse = (c) => (c.action === "detail" ? refusal() : null);
    mount("/jobs");
    await waitFor(() => expect(document.querySelectorAll("li[data-job-id]").length).toBeGreaterThan(3), SLOW);
    const cards = () => [...document.querySelectorAll<HTMLLIElement>("li[data-job-id]")];
    fireEvent.mouseEnter(cards()[0]);
    await waitFor(() => expect(screen.getByText(PAUSED)).toBeInTheDocument(), SLOW);
    expect(calls.filter((c) => c.action === "detail")).toHaveLength(1);
    for (const li of cards().slice(1)) fireEvent.mouseEnter(li);
    fireEvent.mouseEnter(cards()[0]);
    await settle(300);
    expect(calls.filter((c) => c.action === "detail"), "every later prefetch short-circuits").toHaveLength(1);
    fireEvent.click(screen.getAllByText(/Registered Nurse 0/)[0]);
    // The panel opened (positive), and says its description could not load.
    await waitFor(() => expect(screen.getAllByText(/couldn't load this description just now/).length).toBeGreaterThan(0), SLOW);
    expect(calls.filter((c) => c.action === "detail"), "opening a posting asks nothing either").toHaveLength(1);
    expect(screen.queryByText(/doesn't publish the full description/), "a refusal is not the employer's silence").toBeNull();
  });

  it("the country variant carries no number", async () => {
    refuse = (c) => (isPageList(c) ? refusal("country") : null);
    mount("/jobs");
    await waitFor(() => expect(screen.getByText(/paused right now/)).toBeInTheDocument(), SLOW);
    const notice = document.querySelector("[data-board-budget-notice]");
    expect(notice?.getAttribute("data-board-budget-notice")).toBe("country");
    expect(notice?.textContent ?? "").not.toMatch(/\d/);
  });

  it("the evidence behind the cap: a desktop deep-link load makes exactly five counted calls", async () => {
    setDesktop(true);
    mount("/jobs?job=greenhouse:acme:5555");
    await waitFor(() => expect(calls.some((c) => c.action === "detail")).toBe(true), SLOW);
    await settle(2500);
    const counted = calls.filter((c) => BUDGETED_ACTIONS.has(c.action));
    expect(counted.map((c) => c.action).sort(), JSON.stringify(calls.map((c) => c.action))).toHaveLength(5);
    expect(calls.some((c) => c.action === "status"), "status is made, and is not counted").toBe(true);
    expect(ADDRESS_DAILY_CAP, "a person loading 1,500 postings in a day never meets the cap").toBeGreaterThanOrEqual(1500 * counted.length);
  });
});
