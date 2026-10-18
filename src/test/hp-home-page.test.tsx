/**
 * THE NEW HOMEPAGE, RENDERED (corrected spec of 2026-10-17, section 4, and
 * the review traps it fixes).
 *
 * Behavioural: HomePage with the board's own reads answered from fixtures
 * (the counts, freshness and source mix of the mockup's 17 Oct read, whose
 * sums the review checked), four candidate rows and their fill curves.
 *
 *   - one open-postings figure, with its as_of, wherever a count is printed;
 *     every count names its date basis (D1);
 *   - no 24-hour "new · gone" flow figure, and no get_board_flow call (D11);
 *   - the feed-read stamp only on a board read in full (D12, P2);
 *   - no row from a system that moves its dates, and no undated row (P4);
 *   - the board's card with no Save, no Check fit, no menu (P12);
 *   - at most four data calls (P13 budget, spec 8);
 *   - FAQ answers and the sources table stay in the DOM while closed (P9);
 *   - field links only from the category list (P11);
 *   - the plan strip sells nothing while the seller is unknown, gives the
 *     right reason, and never says "unlimited" (G1, G2, G2b, P6, P17);
 *   - fit is said to be free with no account (P5);
 *   - a crawler or a driven browser makes no list call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => stubTable(),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import HomePage from "@/pages/home/HomePage";
import { BOARD_CATEGORY_SLUGS } from "@/lib/job-board-categories";
import type { SaleGates } from "@/lib/home/sale-gates";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const AS_OF = "2026-10-17T22:45:00.000Z";
const COUNTS = {
  as_of: AS_OF,
  cached: true,
  openTotal: 1040488,
  sourcesFacet: {
    workday: 447174, oracle: 148868, smartrecruiters: 78777, icims: 65817, greenhouse: 58486, paylocity: 56934,
    ukg: 35897, workable: 23632, ashby: 20171, teamtailor: 18613, breezy: 14539, usajobs: 14048, lever: 12887,
    adp: 12546, bamboohr: 11313, recruitee: 8760, personio: 4528, rippling: 3987, pinpoint: 3282, jazzhr: 229,
  },
};
const FRESH = [{ boards: 32019, p50_min: 172.1, p95_min: 351.8, max_min: 2990, computed_at: AS_OF }];

const job = (source: string, token: string, company: string, title: string, over: Record<string, unknown> = {}) => ({
  id: `${source}:${token}:1`, source, token, company, title, location: "New York, NY", country: "US",
  workMode: null, employmentType: null, department: null, salary: null, salaryMinAnnual: null, salaryMaxAnnual: null,
  salaryPeriod: null, salaryCurrency: null, postedAt: ago(2 * DAY), missingSince: null, agency: false,
  recheckedAt: ago(4 * 60_000), ...over,
});
const FULL = job("greenhouse", "acme", "Acme", "Platform Engineer");
const LAPS = job("workday", "dominos", "Domino's", "Delivery Driver");
const REDATED = job("paylocity", "sherwood", "Sherwood Center", "Board Certified Assistant Behavior Analyst", { postedAt: ago(DAY) });
const UNDATED = job("icims", "nodate", "No Date Inc", "Undated Role", { postedAt: null });
const BUCKET: Record<string, string> = { acme: "full_read", dominos: "lap_proven", sherwood: "full_read", nodate: "full_read" };

type ListMode = "ok" | "error";
function arrange(mode: ListMode = "ok") {
  rpc.mockImplementation(async (fn: string, a?: { p_tokens?: string[] }) => {
    if (fn === "get_board_vendor_counts") return { data: COUNTS, error: null };
    if (fn === "get_freshness_stats") return { data: FRESH, error: null };
    if (fn === "get_company_fill_curve") return { data: (a?.p_tokens ?? []).map((t) => ({ company_token: t, observability_bucket: BUCKET[t] })), error: null };
    return { data: null, error: null };
  });
  invoke.mockImplementation(async (fn: string, o?: { body?: Record<string, unknown> }) => {
    if (fn === "job-board" && (o?.body?.action ?? "list") === "list") {
      if (mode === "error") return { data: null, error: { message: "refused" } };
      return { data: { jobs: [REDATED, FULL, UNDATED, LAPS], total: 4 }, error: null };
    }
    return { data: null, error: null };
  });
}

function mount(gates?: SaleGates) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/"]}>
        <HomePage gates={gates} />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

const main = () => document.querySelector("main") as HTMLElement;
const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-home-rows] > li[data-job-id]"));
const cardOf = (title: string) => cards().find((c) => (c.textContent ?? "").includes(title)) ?? null;
const ready = () => waitFor(() => expect(document.querySelector('[data-home-rows="ready"]')).not.toBeNull(), SLOW);
const counted = () => waitFor(() => expect(document.querySelector("[data-home-count] strong")).not.toBeNull(), SLOW);

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  try { sessionStorage.clear(); } catch { /* blocked */ }
});
afterEach(() => {
  Object.defineProperty(window.navigator, "webdriver", { configurable: true, get: () => undefined });
});

describe("the hero", () => {
  it("leads with the owner's headline and one filled button, Search jobs", async () => {
    arrange();
    mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Live jobs, straight from employers' own hiring systems.");
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe("/jobs");
    expect(within(form).getByLabelText("Job title, skill or company")).toHaveAttribute("name", "q");
    expect(within(form).getByLabelText("Place, or Remote")).toHaveAttribute("name", "location");
    const filled = Array.from(main().querySelectorAll("button, a")).filter((e) => /\bbg-primary\b/.test(e.className));
    expect(filled.map((e) => e.textContent)).toEqual(["Search jobs"]);
    await ready();
  });

  it("prints the one open-postings figure with the moment it was counted, in UTC", async () => {
    arrange();
    mount();
    await counted();
    const line = document.querySelector("[data-home-count]")!;
    expect(line.textContent).toBe("1,040,488 open postings · counted 17 Oct 2026, 22:45 UTC");
    expect(line.querySelector("time")!.getAttribute("dateTime")).toBe(AS_OF);
    expect(screen.getByRole("link", { name: "Check it free against a posting" })).toHaveAttribute("href", "/resume-checker#upload");
    await ready();
  });
});

describe("the live rows", () => {
  it("shows the full-read board's feed-read time and not the lap-read board's", async () => {
    arrange();
    mount();
    await ready();
    expect(cardOf("Platform Engineer")!.textContent).toContain("feed read");
    expect(cardOf("Delivery Driver")).not.toBeNull();
    expect(cardOf("Delivery Driver")!.textContent).not.toMatch(/feed read/i);
    const curveCalls = rpc.mock.calls.filter(([fn]) => fn === "get_company_fill_curve");
    expect(curveCalls).toHaveLength(1);
    expect((curveCalls[0][1] as { p_tokens: string[] }).p_tokens.sort()).toEqual(["acme", "dominos"]);
  });

  it("drops the row from a system that moves its dates and the undated row", async () => {
    arrange();
    mount();
    await ready();
    expect(cardOf("Board Certified Assistant Behavior Analyst")).toBeNull();
    expect(cardOf("Undated Role")).toBeNull();
    expect(cards()).toHaveLength(2);
    for (const c of cards()) expect(c.querySelector("[data-card-age]")?.textContent).toMatch(/^posted (today|\d+ days? ago)$/);
  });

  it("uses the board's card with no Save, no Check fit and no menu, each title opening the posting's page", async () => {
    arrange();
    mount();
    await ready();
    for (const c of cards()) {
      expect(within(c).queryByRole("button", { name: /^Save /i })).toBeNull();
      expect(within(c).queryByRole("button", { name: /Check fit/i })).toBeNull();
      expect(within(c).queryByRole("button", { name: /More actions/i })).toBeNull();
      expect(c.querySelector("h3 a")!.getAttribute("href")).toMatch(/^\/jobs\/posting\/[^/]+\/[^/]+\/[^/]+$/);
    }
  });

  it("makes at most four data calls, and never reads the 24-hour flow", async () => {
    arrange();
    mount();
    await ready();
    await waitFor(() => expect(rpc.mock.calls.some(([fn]) => fn === "get_freshness_stats")).toBe(true), SLOW);
    const rpcs = rpc.mock.calls.map(([fn]) => fn as string);
    const lists = invoke.mock.calls.filter(([fn]) => fn === "job-board");
    expect(lists).toHaveLength(1);
    expect(lists[0][1]).toMatchObject({ body: { action: "list", sort: "newest", maxAgeDays: 7, excludeAgencies: true, includeFacets: false, limit: 40 } });
    expect(rpcs.filter((f) => f !== "get_board_vendor_counts" && f !== "get_freshness_stats" && f !== "get_company_fill_curve")).toEqual([]);
    expect(rpcs.length + lists.length).toBeLessThanOrEqual(4);
    expect(rpcs).not.toContain("get_board_flow");
    expect(main().textContent ?? "").not.toMatch(/\d[\d,.]*\s+new\s*·|\bgone\b\s*·|new postings, and postings a later read/i);
  });

  it("hides the list when the board refuses, and keeps See all postings and the field links", async () => {
    arrange("error");
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalled(), SLOW);
    await waitFor(() => expect(document.querySelector("[data-home-rows]")).toBeNull(), SLOW);
    expect(screen.getByRole("link", { name: "See all postings" })).toHaveAttribute("href", "/jobs");
    expect(document.querySelectorAll('a[href^="/jobs/field/"]').length).toBeGreaterThan(0);
  });

  it("makes no list call for a driven browser", async () => {
    Object.defineProperty(window.navigator, "webdriver", { configurable: true, get: () => true });
    arrange();
    mount();
    await counted();
    await new Promise((r) => setTimeout(r, 300));
    expect(invoke.mock.calls.filter(([fn]) => fn === "job-board")).toEqual([]);
    expect(document.querySelector("[data-home-rows]")).toBeNull();
    expect(screen.getByRole("link", { name: "See all postings" })).toBeInTheDocument();
  });
});

describe("every count names its date basis", () => {
  it("the count line, the board total, the rail, the AI line and the sources caption each carry the as_of", async () => {
    arrange();
    mount();
    await ready();
    await waitFor(() => expect(document.querySelector("[data-home-freshness] time")).not.toBeNull(), SLOW);
    for (const sel of ["[data-home-count]", "[data-home-total]", "[data-home-freshness]", "[data-home-reach]", "caption"]) {
      const el = document.querySelector(sel);
      expect(el, sel).not.toBeNull();
      expect(el!.querySelector("time")?.getAttribute("dateTime"), sel).toBe(AS_OF);
    }
    expect(document.querySelector("[data-home-total]")!.textContent).toBe("1,040,488 open postings in all · counted 17 Oct 2026, 22:45 UTC");
    expect(document.querySelector("[data-home-freshness]")!.textContent).toMatch(/^32,019job boards with an open postingHalf had a read in the 2 hr, 52 min before 22:45 UTC; 95% within 5 hr, 52 min\. For the largest boards, a read is one part of the board\.$/);
    expect(document.querySelector("[data-home-reach]")!.textContent).toBe(
      "Your AI searches 947,663 of the 1,040,488 open postings: USAJOBS and SmartRecruiters postings (92,825) stay on this website. Counted 17 Oct 2026, 22:45 UTC.",
    );
  });

  it("no five-figure-or-larger count stands outside an element that names its time", async () => {
    arrange();
    mount();
    await ready();
    await waitFor(() => expect(document.querySelector("[data-home-freshness] time")).not.toBeNull(), SLOW);
    const walker = document.createTreeWalker(main(), NodeFilter.SHOW_TEXT);
    const bare: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      if (!/\d{1,3}(?:,\d{3})+/.test(text)) continue;
      const el = n.parentElement!;
      // The hiring-system tables share the outer table's caption, which names the count's time.
      const basis = el.closest("[data-home-count], [data-home-total], [data-stat], [data-home-reach], [data-testid='home-sources-table']");
      const named = basis?.matches("[data-testid='home-sources-table']") ? basis.querySelector("caption time") : basis?.querySelector("time");
      if (!named) bare.push(text);
    }
    expect(bare).toEqual([]);
  });
});

describe("what crawlers and Find can read", () => {
  it("keeps every FAQ answer and the sources table in the DOM while closed", async () => {
    arrange();
    mount();
    await waitFor(() => expect(document.querySelector("caption")).not.toBeNull(), SLOW);
    const faq = document.querySelector("[data-home-faq]")!;
    const items = Array.from(faq.querySelectorAll("details"));
    expect(items).toHaveLength(5);
    expect(items.every((d) => !d.open)).toBe(true);
    expect(faq.textContent).toContain("Each posting shows the employer's posted date when the employer's system states one and keeps it fixed.");
    expect(faq.textContent).toContain("The largest boards are read in parts over several passes, so their postings show no feed-read time.");
    expect(faq.textContent).toContain("It is free, with no account, in the browser where you scanned or dropped your résumé.");
    expect(faq.textContent).toContain("Workday, Oracle, SmartRecruiters, iCIMS, Greenhouse and 14 more");
    const table = document.querySelector("[data-testid='home-sources-table']") as HTMLDetailsElement;
    expect(table.open).toBe(false);
    expect(table.textContent).toContain("447,174");
    expect(table.textContent).toContain("13 more systems (170,384)");
    expect(table.textContent).toContain("JazzHR");
    expect(document.querySelector("[data-testid='home-sample']")!.textContent).toContain("Brackets mark facts only you know. Check every figure before you use it.");
  });

  it("links fields only from the board's category list", async () => {
    arrange();
    mount();
    const hrefs = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/jobs/field/"]')).map((a) => a.getAttribute("href")!.slice("/jobs/field/".length));
    expect(hrefs.length).toBeGreaterThanOrEqual(6);
    for (const h of hrefs) expect(BOARD_CATEGORY_SLUGS as readonly string[]).toContain(h);
    expect(hrefs).toContain("hospitality_retail");
    expect(screen.getByRole("link", { name: "Hospitality & Retail" })).toHaveAttribute("href", "/jobs/field/hospitality_retail");
    expect(screen.getByRole("link", { name: "All fields" })).toHaveAttribute("href", "/explore");
    await ready();
  });
});

describe("the plan strip", () => {
  const text = () => document.querySelector("[data-home-plans]")!.textContent ?? "";

  it("with no seller identity: nothing on sale, the seller's identity as the reason, no Pro row, no buy control", async () => {
    arrange();
    mount();
    expect(document.querySelector('[data-plan="full-analysis"]')!.getAttribute("data-plan-state")).toBe("gatedSeller");
    expect(text()).toContain("Not on sale yet. Sales open once the seller's name and address are published on this page.");
    expect(document.querySelector('[data-plan="pro"]')).toBeNull();
    expect(main().textContent).toContain("Paid extras are not on sale yet; purchases open soon.");
    expect(main().textContent).toContain("All sales are final.");
    expect(main().textContent).toContain("Not yet sold in the EU, the EEA, the UK or India");
    expect(main().textContent).toContain("from the currency, the browser's time zone and a lookup of the IP address");
    const controls = Array.from(main().querySelectorAll("a, button")).map((e) => `${e.textContent} ${e.getAttribute("href") ?? ""}`);
    expect(controls.filter((c) => /\bbuy\b|go pro|checkout|stripe/i.test(c))).toEqual([]);
    await ready();
  });

  it("with the seller known but delivery unwatched, says delivery is the reason", async () => {
    arrange();
    mount({ seller: true, fullAnalysisOnSale: false, proOnSale: false, fullAnalysisDelivers: false, alertsStatable: true });
    expect(text()).toContain("Not on sale yet. We are checking that the report reaches buyers.");
    expect(text()).not.toContain("seller's name");
    await ready();
  });

  it("with every gate open, Pro reads its allowance and its Full Analysis, and never unlimited", async () => {
    arrange();
    mount({ seller: true, fullAnalysisOnSale: true, proOnSale: true, fullAnalysisDelivers: true, alertsStatable: true });
    expect(text()).toContain("$5");
    expect(text()).toContain("$45");
    expect(text()).toContain("5 of each a day and 60 of each a month (a package is one of each), and no daily cap on scans. The Full Analysis is included.");
    expect(main().textContent).toContain("Everything above is free. Two things cost money.");
    expect(main().textContent ?? "").not.toMatch(/unlimited|all-access|freelance|transition pro/i);
    await ready();
  });
});

describe("the free account strip", () => {
  it("offers the saved résumé for fit and does not promise alerts before the digest is ruled", async () => {
    arrange();
    mount();
    const strip = document.getElementById("home-account")!.closest("section")!;
    expect(strip.textContent).toContain("Your résumé, saved");
    expect(strip.textContent).toContain("Fit is a word match. It does not predict interviews or offers.");
    expect(strip.textContent).toContain("Saved searches");
    expect(strip.textContent).not.toContain("and alerts");
    await ready();
  });
});
