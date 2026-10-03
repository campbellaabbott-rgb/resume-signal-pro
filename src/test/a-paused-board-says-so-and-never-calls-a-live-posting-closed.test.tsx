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
 *   - a 429 that does NOT say board_budget is an ordinary failure: the
 *     generic error, its one quiet retry, and no notice -- only the board's
 *     own word pauses the board;
 *   - THE POSTING PAGE (/jobs/posting/...), the prerendered SEO surface: a
 *     refusal shows the notice, never "no longer live", never noindex, and
 *     asks for the detail ONCE. Its positive controls: the server's own "no
 *     such row" still reaches gone + noindex, and an ordinary failure IS
 *     retried (two detail calls) and offers Try again -- so "once" is the
 *     refusal's doing. A standing refusal makes no request at all;
 *   - THE EVIDENCE BEHIND THE CAP: a desktop deep-link load -- the scraper's
 *     exact URL shape -- makes exactly five counted calls (actions read from
 *     anon-budget.ts's own set), and the address cap is at least 1,500 such
 *     loads a day, so a person never meets it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { ADDRESS_DAILY_CAP, BUDGETED_ACTIONS } from "../../supabase/functions/job-board/anon-budget";
import { clearBoardBudgetRefusal, markBoardBudgetRefused } from "@/lib/board-budget";

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
import JobPosting from "@/pages/JobPosting";

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

  it("a 429 that does not name the board budget is an ordinary failure: the generic error, one retry, no notice", async () => {
    refuse = (c) => (isPageList(c) ? httpError(429, { error: "rate_limited", message: "slow down" }) : null);
    mount("/jobs");
    await waitFor(() => expect(screen.getByText(/The board couldn't load right now/)).toBeInTheDocument(), SLOW);
    expect(screen.queryByText(PAUSED)).toBeNull();
    expect(document.querySelector("[data-board-budget-notice]")).toBeNull();
    expect(calls.filter(isPageList), "an ordinary failure keeps its one quiet retry").toHaveLength(2);
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

// ── the posting page: the prerendered SEO surface ───────────────────────────

const POSTING_PATH = "/jobs/posting/greenhouse/acme/5555";
const mountPosting = () => render(
  <MemoryRouter initialEntries={[POSTING_PATH]}>
    <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
  </MemoryRouter>,
);
/** The crawl directive every prerendered posting file ships, so the page has one to rewrite. */
function seedRobots(): HTMLMetaElement {
  const m = document.createElement("meta");
  m.name = "robots";
  m.content = "index, follow";
  document.head.appendChild(m);
  return m;
}
const details = () => calls.filter((c) => c.action === "detail");

describe("the posting page never calls a refused posting gone, and never retries a refusal", () => {
  beforeEach(() => { invoke.mockReset(); calls = []; refuse = () => null; mock(); clearBoardBudgetRefusal(); });
  afterEach(() => { clearBoardBudgetRefusal(); document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove()); });

  it("a 429 board_budget shows the notice, adds no noindex, and asks for the detail once", async () => {
    const robots = seedRobots();
    refuse = (c) => (c.action === "detail" ? refusal() : null);
    mountPosting();
    await waitFor(() => expect(screen.getByText(PAUSED)).toBeInTheDocument(), SLOW);
    await settle(1800); // past the 1.2s quiet retry, had there been one
    expect(details(), "a refusal is never retried").toHaveLength(1);
    expect(robots.getAttribute("content"), "a live posting page must not be told to crawlers as gone").toBe("index, follow");
    expect(noindex()).toBeNull();
    expect(screen.queryByText(/no longer live/i)).toBeNull();
    expect(screen.queryByText(/couldn't load this posting/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Try again$/ })).toBeNull();
    expect(document.querySelector("[data-board-budget-notice]")?.textContent ?? "").toMatch(/resumeboostersupp@gmail\.com/);
  });

  it("positive controls: the server's own 'no such row' still reaches gone and noindex; an ordinary failure is retried once", async () => {
    const robots = seedRobots();
    refuse = (c) => (c.action === "detail" ? { data: { job: null, description: null }, error: null } : null);
    const gone = mountPosting();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /no longer live/i })).toBeInTheDocument(), SLOW);
    await waitFor(() => expect(robots.getAttribute("content")).toBe("noindex"));
    expect(screen.queryByText(PAUSED)).toBeNull();
    gone.unmount();

    calls = [];
    refuse = (c) => (c.action === "detail" ? httpError(503, { error: "busy" }) : null);
    mountPosting();
    await waitFor(() => expect(screen.getByText(/couldn't load this posting just now/)).toBeInTheDocument(), SLOW);
    expect(details(), "a failure that is not a refusal IS retried, so 'once' above is the refusal's doing").toHaveLength(2);
    expect(screen.getByRole("button", { name: /^Try again$/ })).toBeInTheDocument();
    expect(screen.queryByText(PAUSED)).toBeNull();
  });

  it("a 429 without the board's word is an ordinary failure here too, and a standing refusal asks nothing", async () => {
    refuse = (c) => (c.action === "detail" ? httpError(429, { error: "rate_limited" }) : null);
    const v = mountPosting();
    await waitFor(() => expect(screen.getByText(/couldn't load this posting just now/)).toBeInTheDocument(), SLOW);
    expect(details()).toHaveLength(2);
    expect(screen.queryByText(PAUSED)).toBeNull();
    v.unmount();

    calls = [];
    refuse = () => null;
    markBoardBudgetRefused({ code: "address", limit: 10000, resetAt: RESET_AT });
    mountPosting();
    await waitFor(() => expect(screen.getByText(PAUSED)).toBeInTheDocument(), SLOW);
    await settle(300);
    expect(details(), "the page already knows; it does not ask again").toHaveLength(0);
  });
});
