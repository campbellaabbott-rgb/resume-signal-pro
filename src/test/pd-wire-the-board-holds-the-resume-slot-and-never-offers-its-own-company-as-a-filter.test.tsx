/**
 * TWO THINGS THE PASS B MEASUREMENT FOUND ON THE BUILT BOARD (2026-10-17).
 *
 * 1. TWO THINGS ARRIVED AFTER FIRST PAINT AND PUSHED THE BOARD DOWN. On
 *    /jobs at 1280 the country picker mounted only once get_country_facet
 *    or the list reply had named a country, ~1.2s in, and wrapped the
 *    controls row onto a third line: 46px under every filter row and the
 *    first card, 0.27 of the page's 0.32 layout shift, the same in ten runs.
 *    On a company page the résumé drop strip ("Drop your résumé here…")
 *    arrived at ~1.3s once resolveFitResume had answered. Now the picker is
 *    in the row from first paint (an empty list until the facet answers
 *    once), the board knows a résumé dropped this session at first paint,
 *    and until the rest of that answer arrives the strip holds its place
 *    invisibly (visibility, not display: the same box, the same height).
 *
 * 2. THE END OF A COMPANY'S LIST OFFERED TO REMOVE THE COMPANY. Allegis's 30
 *    roles ended in "End of results — 30 openings shown for these filters"
 *    with a button "Remove Allegis Global Solutions — 1,042,809 openings":
 *    the page's own scope read as a filter, the whole board as its reward,
 *    on a 394px button that scrolled a 375px phone sideways. The page's
 *    company is never a relaxation: the end card reads the board's end as
 *    broad, no probe is sent, and the relaxation buttons that remain wrap
 *    their label.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const ROOT = resolve(__dirname, "../..");
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const WHOLE_BOARD = 1_042_809;

const job = (token: string, company: string, n: number) => ({
  id: `greenhouse:${token}:${n}`, source: "greenhouse", token, company,
  title: `Platform Engineer ${n}`, location: "New York, NY, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3,
  category: "engineering", department: null, agency: false,
  postedAt: ago(2), lastSeen: ago(2), recheckedAt: ago(0), applyUrl: `https://x/${n}`, remote: false,
});

const CURVE = (token: string) => ({
  company_token: token, open_roles: 3, fills_90d: 0, relists_90d: 0, filled_roles_90d: 0, relisted_roles_90d: 0, ageouts_90d: 0,
  n_at_risk_14: 0, fills_le_14: 0, fill_rate_14: null, still_open_14: null, median_days_to_fill: null, median_censored: true,
  dated_coverage: 1, dated_n: 3, undated_n: 0, tracking_days: 5, sufficient: false, observability_bucket: "full_read", watched_from: "2026-10-01",
});

/**
 * The requests that asked the board for a count of the page's query with the
 * company scope taken off. The board's own "new in the last day" figure is
 * also a countOnly without a company, but it carries maxAgeDays and nothing
 * of the page's filters; a relaxation probe carries the page's derivation
 * and never maxAgeDays.
 */
const countsWithoutTheCompany = () => invoke.mock.calls.filter(([fn, a]) => {
  const b = (a as { body?: Record<string, unknown> } | undefined)?.body ?? {};
  return fn === "job-board" && b.action === "list" && b.countOnly && !("maxAgeDays" in b) && !(Array.isArray(b.companyTokens) && b.companyTokens.length > 0);
});

function mount(path: string, jobs: ReturnType<typeof job>[]) {
  window.history.replaceState({}, "", path);
  const token = jobs[0]?.token ?? "";
  rpc.mockImplementation(async (fn: string, a?: { p_tokens?: string[] }) => {
    if (fn === "get_company_intel") return { data: { employees: null, categories: [], countries: [], open_by_source: [] }, error: null };
    if (fn === "get_company_fill_curve") return { data: (a?.p_tokens ?? []).map(CURVE), error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "detail") return { data: { job: jobs.find((j) => j.id === b.id) ?? jobs[0], description: "A role." } };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      // A count with the company taken off answers the whole board: the
      // number the old end card put on its "Remove <company>" button.
      if (b.countOnly) return { data: { total: Array.isArray(b.companyTokens) && b.companyTokens.length > 0 ? jobs.length : WHOLE_BOARD } };
      return { data: { jobs, total: jobs.length, hasMore: false, totalAllCompanies: WHOLE_BOARD, companies: token ? [{ token, name: jobs[0].company, open: jobs.length }] : [], companiesCount: 1, categories: {}, failedSources: [], refreshedAt: ago(0) }, error: null };
    }
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/company/:companyToken" element={<Jobs />} />
      </Routes>
    </MemoryRouter>,
  );
}
const text = () => document.body.textContent ?? "";
const slot = () => document.querySelector<HTMLElement>("[data-resume-drop]");

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
});

describe("the country picker is in the controls row from the first paint", () => {
  const picker = () => document.querySelector<HTMLElement>('button[aria-label="All countries"]');
  it("is in the document before any reply, and still there once the board has answered", async () => {
    mount("/jobs", [job("acme", "Acme", 1), job("acme", "Acme", 2)]);
    expect(picker(), "the country picker is not in the row at first paint").not.toBeNull();
    await waitFor(() => expect(text()).toContain("Platform Engineer 2"), SLOW);
    expect(picker()).not.toBeNull();
  });
});

describe("the desktop résumé strip holds its place from the first paint", () => {
  it("is in the document at once, invisible and pending, then turns visible in place once the board knows there is no résumé", async () => {
    mount("/jobs", [job("acme", "Acme", 1), job("acme", "Acme", 2)]);
    // Right after the first render, before resolveFitResume has answered.
    const first = slot();
    expect(first, "the strip's box is not in the document at first paint").not.toBeNull();
    expect(first!.getAttribute("data-resume-drop")).toBe("pending");
    expect(first!.className.split(/\s+/), "the pending box must keep its height without being seen").toContain("invisible");
    expect(first!.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(slot()?.getAttribute("data-resume-drop")).toBe("offered"), SLOW);
    const offered = slot()!;
    expect(offered.className.split(/\s+/)).not.toContain("invisible");
    expect(offered.getAttribute("aria-hidden")).toBeNull();
    expect(offered.textContent).toContain("Drop your résumé here");
  });

  it("is never reserved for a visitor who dropped a résumé this session: that answer is known synchronously", () => {
    try { sessionStorage.setItem("rb_board_resume", "Senior engineer. ".repeat(20)); } catch { /* blocked: the case below cannot run */ return; }
    mount("/jobs", [job("acme", "Acme", 1)]);
    expect(slot(), "a visitor with a résumé was shown a pending drop box").toBeNull();
  });
});

describe("the end of a company's own list never offers the company as a filter to remove", () => {
  it("reads the end as the board's end, sends no count with the company taken off, and prints no Remove button", async () => {
    mount("/jobs/company/acme", [job("acme", "Acme", 1), job("acme", "Acme", 2), job("acme", "Acme", 3)]);
    await waitFor(() => expect(text()).toContain("Platform Engineer 3"), SLOW);
    await waitFor(() => expect(text()).toMatch(/You've reached the end — 3 openings shown/), SLOW);
    // Give a burst, if one were armed, its render.
    await new Promise((r) => setTimeout(r, 150));
    expect(text(), "the end card read the page's own company as a narrowing filter").not.toContain("for these filters");
    expect(text()).not.toMatch(/Remove Acme/);
    expect(text()).not.toContain(WHOLE_BOARD.toLocaleString());
    expect(countsWithoutTheCompany().map(([, a]) => JSON.stringify((a as { body?: unknown }).body)), "the board was asked what removing the company would reach").toEqual([]);
  });

  it("the relaxation buttons that remain wrap their label on a phone (source: every zeroRemove Button is whitespace-normal), with teeth", () => {
    const board = codeOf(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
    const buttons = [...board.matchAll(/<Button([^>]*)>\s*\{t\("jobsPage\.zeroRemove"/g)].map((m) => m[1]);
    expect(buttons.length, "the two relaxation buttons (zero page and end card) are not where this guard looks: RE-ANCHOR it").toBe(2);
    for (const attrs of buttons) {
      expect(attrs, "a relaxation button is nowrap: a long employer name scrolls a phone sideways").toMatch(/className="[^"]*\bwhitespace-normal\b/);
      expect(attrs).toMatch(/className="[^"]*\bmax-w-full\b/);
    }
    const planted = board.replace(/className="h-auto max-w-full whitespace-normal" (onClick=\{s\.clear\})/, "$1");
    expect(planted, "the teeth mutation did not apply: RE-ANCHOR it").not.toBe(board);
    const after = [...planted.matchAll(/<Button([^>]*)>\s*\{t\("jobsPage\.zeroRemove"/g)].map((m) => m[1]);
    expect(after.some((attrs) => !/whitespace-normal/.test(attrs))).toBe(true);
  });

  it("the page's company is read out of the relaxations by the one line that does it", () => {
    const board = codeOf(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
    expect(board).toMatch(/const relaxableFilters = useMemo\(\s*\(\) => \(onCompanyPage \? activeFilters\.filter\(\(c\) => c\.key !== "company"\) : activeFilters\)/);
    expect(board).toMatch(/const candidates = relaxableFilters\.slice\(/);
    expect(board).toMatch(/: relaxableFilters\.length > 0 && jobs\.length <= PAGE \? "narrow"/);
    expect(board).toMatch(/&& !endCountUnknown && !activelyHiringOnly && relaxableFilters\.length > 0/);
  });
});
