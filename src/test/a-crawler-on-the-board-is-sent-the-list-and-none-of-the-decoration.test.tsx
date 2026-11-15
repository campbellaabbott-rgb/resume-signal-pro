/**
 * A CRAWLER ON THE BOARD IS SENT THE LIST AND NONE OF THE DECORATION, A SEARCH
 * ENGINE IS SENT WHAT A PERSON IS, AND A VISIT FROM THE HOMEPAGE IS NOT ASKED
 * TWICE HOW FRESH THE BOARD IS (cost audit 2026-11-08, lane ci-edge: "Skip
 * decorative RPCs for crawlers on /jobs" and dedupe-cached-row-reads).
 *
 * WHAT WAS WRONG. Every render of /jobs, a scraper's or a driven browser's
 * included, asked for the country counts, the takedown ticker, the salary
 * benchmarks, and for every employer on the page its fill curve, its growth
 * row and its layoff filing: seven reads a person looks at. And a visitor who
 * clicked from / to /jobs paid get_freshness_stats twice for a rollup the
 * server caches.
 *
 * REVIEW 2026-11-15. The lane skipped those reads for Googlebot too, on the
 * claim that a crawler indexes only the list and the baked HTML. Googlebot,
 * bingbot and Applebot run the page's JavaScript, and main.tsx mounts beside
 * the baked page and removes it once the route commits, so a search engine
 * indexes what React draws: the skip took the field pages' advertised-pay
 * line, the takedown count and the employer badges out of the index.
 *
 * WHAT HOLDS NOW, on the real page with the client mocked:
 *   - a headless scraper gets the list call and none of those six reads;
 *   - a person gets all six, as before (so the first point is not vacuous);
 *   - Googlebot, Google's inspection tool, bingbot and Applebot get all six;
 *   - a scraper with "Actively hiring" on still gets the curves and the growth
 *     rows that filter partitions on;
 *   - the homepage's freshness answer, under a minute old, is printed by the
 *     board without asking again; with none kept, or a failed one, it asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";

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
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "@/pages/Jobs";
import { forgetKeptFreshness, useBoardFreshness } from "@/lib/home/use-board-freshness";

vi.setConfig(MOUNT_TEST_BUDGET);

const DECORATION = [
  "get_country_facet", "get_takedowns_today", "get_salary_benchmarks",
  "get_company_fill_curve", "get_company_growth", "get_employer_layoff_filings",
] as const;
const SCRAPER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36";
const SEARCH_RENDERERS = {
  googlebot: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  inspection: "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
  bingbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  applebot: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
};
const FRESH = [{ boards: 900, p50_min: 37, p95_min: 120, computed_at: new Date().toISOString() }];

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
let tokens: string[] = [];
let run = 0;
const row = (token: string, i: number) => ({
  id: `greenhouse:${token}:1`, source: "greenhouse", token, company: `Employer ${token}`, title: `Data Engineer ${i}`,
  location: "Austin, TX", country: "US", salary: null, category: "engineering",
  postedAt: ago(1 + i / 100), lastSeen: ago(0), recheckedAt: ago(0), applyUrl: `https://x/${token}`, remote: false,
});

const called = () => rpc.mock.calls.map(([fn]) => String(fn));
const lists = () => invoke.mock.calls.filter(([fn, o]) => fn === "job-board" && ((o as { body?: { action?: string } })?.body?.action ?? "list") === "list");
const card = (token: string) => document.querySelector(`[data-job-id="greenhouse:${token}:1"]`);

let realUa: PropertyDescriptor | undefined;
function asCrawler(ua = SCRAPER) {
  realUa = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
  clearBoardBudgetRefusal();
  setLanderManifestForTests("*");
  forgetKeptFreshness();
  // Employers no earlier test asked about: the board keeps curve answers
  // across mounts, and a kept answer would hide a call this file counts.
  run += 1;
  tokens = Array.from({ length: 4 }, (_, i) => `crawl${run}e${i}`);
  const rows = tokens.map(row);
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && (b.action ?? "list") === "list") {
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      if (b.countOnly) return { data: { total: rows.length }, error: null };
      return { data: { jobs: rows, total: rows.length, totalAllCompanies: rows.length, companies: [], companiesCount: rows.length, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    return { data: {}, error: null };
  });
  rpc.mockImplementation(answer);
});
/**
 * A person's reads answered with rows: an empty country facet or benchmark
 * answer is retried seconds later, and that retry would land in the next test.
 */
const answer = async (fn: string) =>
  fn === "get_freshness_stats" ? { data: FRESH, error: null }
    : fn === "get_country_facet" ? { data: [{ country: "US", n: 4 }], error: null }
    : fn === "get_salary_benchmarks" ? { data: [{ category: "engineering", currency: "USD", n: 40, median_annual_min: 120000 }], error: null }
    : { data: [], error: null };
afterEach(() => {
  if (realUa) Object.defineProperty(window.navigator, "userAgent", realUa);
  else delete (window.navigator as unknown as Record<string, unknown>).userAgent;
  realUa = undefined;
});

/**
 * Mounts the board and waits until its list has answered (its cards drawn,
 * unless a filter hides them) and every mount-time read has had its turn.
 */
async function mountBoard(path = "/jobs", cardsShown = true) {
  window.history.replaceState({}, "", path);
  render(<MemoryRouter initialEntries={[path]}><Jobs /></MemoryRouter>);
  await waitFor(() => expect(lists().length).toBeGreaterThan(0), SLOW);
  if (cardsShown) await waitFor(() => expect(card(tokens[0])).not.toBeNull(), SLOW);
  await waitFor(() => expect(called()).toContain("get_freshness_stats"), SLOW);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

describe("a crawler on /jobs", () => {
  it("is sent the list and none of the six decorative reads", async () => {
    asCrawler();
    await mountBoard();
    expect(lists().length).toBeGreaterThan(0);
    expect(called().filter((fn) => (DECORATION as readonly string[]).includes(fn))).toEqual([]);
  });

  it("while a person on the same page is sent all six, as before", async () => {
    await mountBoard();
    await waitFor(() => {
      for (const fn of DECORATION) expect(called(), fn).toContain(fn);
    }, SLOW);
  });

  for (const [name, ua] of Object.entries(SEARCH_RENDERERS)) {
    it(`except a search engine's renderer (${name}), which indexes what the page draws and is sent all six (review 2026-11-15)`, async () => {
      asCrawler(ua);
      await mountBoard();
      await waitFor(() => {
        for (const fn of DECORATION) expect(called(), fn).toContain(fn);
      }, SLOW);
    });
  }

  it("with Actively hiring on, is still sent the curves and growth rows the filter partitions on, and nothing else", async () => {
    asCrawler();
    // No employer here has a record, so the filter shows no card.
    await mountBoard("/jobs?activelyHiring=1", false);
    await waitFor(() => {
      expect(called()).toContain("get_company_fill_curve");
      expect(called()).toContain("get_company_growth");
    }, SLOW);
    expect(called().filter((fn) => ["get_country_facet", "get_takedowns_today", "get_salary_benchmarks", "get_employer_layoff_filings"].includes(fn))).toEqual([]);
  });
});

describe("the board's freshness figure after the homepage", () => {
  const strip = () => document.body.textContent ?? "";

  it("is the homepage's answer, printed without asking again", async () => {
    const home = renderHook(() => useBoardFreshness());
    await waitFor(() => expect(home.result.current?.p50Min).toBe(37), SLOW);
    home.unmount();
    expect(called().filter((fn) => fn === "get_freshness_stats")).toHaveLength(1);
    window.history.replaceState({}, "", "/jobs");
    render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
    await waitFor(() => expect(card(tokens[0])).not.toBeNull(), SLOW);
    await waitFor(() => expect(strip()).toMatch(/median feed re-checked 37 min ago/), SLOW);
    expect(called().filter((fn) => fn === "get_freshness_stats"), "the board asked again for what the homepage had just read").toHaveLength(1);
  });

  it("is asked for when no homepage answer is kept, or the kept one failed", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "get_freshness_stats" ? { data: null, error: { message: "timeout" } } : answer(fn)));
    const home = renderHook(() => useBoardFreshness());
    await waitFor(() => expect(called()).toContain("get_freshness_stats"), SLOW);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    home.unmount();
    rpc.mockImplementation(answer);
    await mountBoard();
    expect(called().filter((fn) => fn === "get_freshness_stats")).toHaveLength(2);
    await waitFor(() => expect(strip()).toMatch(/median feed re-checked 37 min ago/), SLOW);
  });
});
