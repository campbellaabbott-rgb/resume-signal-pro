/**
 * A COMPANY PAGE'S TITLE AND HEADING MATCH ITS VARIANT (2026-10-18 review).
 *
 *   - The SPA's <title> said "{company} jobs: open roles from their own hiring
 *     system" on every token: on USAJOBS (a listing site, not an employer), on
 *     a board name two employers share (naming the first row's employer on a
 *     page that names none), and on a nameless zero page from the raw token.
 *   - The zero page's H1 stayed a pulsing loading bar, announcing "Loading
 *     the employer's name", forever: no row ever arrives to name it.
 *   - The USAJOBS hub's hiring-record footnote said "this company's official
 *     postings".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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
import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";
import { CompanyHeader } from "@/components/jobs/company/CompanyHeader";
import { HiringRecordCard } from "@/components/jobs/company/HiringRecordCard";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const job = (source: string, token: string, company: string, n: number) => ({
  id: `${source}:${token}:${n}`, source, token, company,
  title: `Role ${n}`, location: "New York, NY, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3,
  category: "engineering", department: null, agency: false,
  postedAt: ago(2 * DAY), lastSeen: ago(2 * DAY), recheckedAt: ago(60_000), applyUrl: `https://x/${n}`, remote: false,
});

function mount(token: string, jobs: ReturnType<typeof job>[]) {
  const path = `/jobs/company/${token}`;
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [], error: null }));
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "detail") return { data: { job: jobs[0], description: "A role." } };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: jobs.length } };
      return { data: { jobs, total: jobs.length, totalAllCompanies: jobs.length, companies: jobs.length ? [{ token, name: jobs[0].company, open: jobs.length }] : [], companiesCount: jobs.length ? 1 : 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false, unknownCompanies: [] } };
    }
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
  document.title = "";
});

describe("the document title follows the page's variant", () => {
  it("USAJOBS: the hub's own wording, never 'own hiring system'", async () => {
    mount("usajobs", [job("usajobs", "usajobs", "Department of the Army", 1)]);
    await waitFor(() => expect(document.title).toContain("Federal openings listed on USAJOBS"), SLOW);
    expect(document.title).not.toMatch(/own hiring system/);
  });

  it("a board name two employers share: the board wording, naming neither employer", async () => {
    mount("clear", [job("greenhouse", "clear", "CLEAR - Corporate", 1), job("bamboohr", "clear", "Clear", 2)]);
    await waitFor(() => expect(document.title).toContain("Open roles on boards named “clear”"), SLOW);
    expect(document.title).not.toMatch(/CLEAR - Corporate|Clear jobs/);
  });

  it("a nameless zero page: the board by its address, in the title and in the heading, never a raw-token company title", async () => {
    mount("10kbi", []);
    await waitFor(() => expect(document.title).toContain("Roles on the “10kbi” board"), SLOW);
    expect(document.title).not.toMatch(/10kbi jobs: open roles/);
    await waitFor(() => expect(document.querySelector("h1")?.textContent ?? "").toContain("Roles on the “10kbi” board"), SLOW);
    expect(document.body.textContent).not.toContain("Loading the employer's name");
  });

  it("positive control: an employer's page keeps '{company} jobs: open roles from their own hiring system'", async () => {
    mount("acme", [job("greenhouse", "acme", "Acme", 1)]);
    await waitFor(() => expect(document.title).toContain("Acme jobs: open roles from their own hiring system"), SLOW);
  });
});

describe("the header's name", () => {
  const input = (o: Partial<LanderInput> = {}): LanderInput => ({
    token: "10kbi", storedName: null, bakedName: null, cachedName: null,
    listTotal: 0, listFloor: false, feedTotal: null, feedFloor: false, feedAsOf: null,
    boardReadAt: null, source: null, agency: false, collision: null, isUsajobs: false,
    loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
    verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
  });
  const h1 = (o: Partial<LanderInput>) => {
    cleanup();
    render(createElement(MemoryRouter, null, createElement(CompanyHeader, { model: buildLanderModel(input(o)), token: "10kbi", system: null, boardReadAt: null, onWatch: () => {} })));
    return document.querySelector("h1")?.textContent ?? "";
  };
  it("while the list is in flight, a loading bar; once it answered with no name, the board's address", () => {
    expect(h1({ loading: true, listTotal: null })).toContain("Loading the employer's name");
    expect(h1({})).toBe("Roles on the “10kbi” board");
    expect(h1({ error: true, listTotal: null })).toBe("Roles on the “10kbi” board");
  });
});

describe("the USAJOBS hub's hiring-record footnote", () => {
  const record: Parameters<typeof HiringRecordCard>[0]["input"] = {
    curve: { open_roles: 9303, filled_roles_90d: 120, relisted_roles_90d: 30, tracking_days: 10, observability_bucket: "full_read", watched_from: "2026-08-01", multi_site_title_share: 0, sufficient: true, dated_coverage: 0.9 },
    gated: { verdict: "unknown", withheld: "tracking" }, actively: "unknown", admitted: null, relistCaution: false,
    growth: { verdict: "unknown", row: null, why: "we set this board aside ourselves" },
    bars: { growthMinRatePct: 25, growthWindowDays: 7, closedWindowDays: 90, shareDays: 14, supportDays: 30 },
  };
  it("speaks of the postings the site lists, not of 'this company's' postings", () => {
    const { container } = render(createElement(MemoryRouter, null, createElement(HiringRecordCard, { input: record, floorOnly: true, listingSite: true })));
    expect(container.textContent).toContain("the postings this site lists");
    expect(container.textContent).not.toContain("this company's");
  });
});
