// A DOTTED EMPLOYER TOKEN LINKS TO THE ADDRESS THIS HOST SERVES.
//
// /jobs/company/careers.amd.com answers a 9-byte 404 on this host; the
// slashed /jobs/company/careers.amd.com/ serves the page (the host reads the
// dot as a file extension). The bake learned this in August and routes its
// sitemap and canonical through publicHref; the React side kept building every
// /jobs/company/<token> href by hand. In-app clicks survived, because the
// router never asks the host -- but the href is what a crawler follows, what a
// new tab and a pasted link cold-load, and what the board writes into the
// address bar, which a reload then 404s.
//
// Judged on the rendered hrefs and the address the board writes, with a
// plain token beside each as the control that nothing else moved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { companyLanderPath, publicPath } from "@/lib/public-href";

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

import Jobs from "@/pages/Jobs";
import JobPosting from "@/pages/JobPosting";
import { SimilarCompanies } from "@/components/jobs/SimilarCompanies";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const row = (i: number, token: string, company: string) => ({
  id: `phenom:${token}:${1000 + i}`, token, company, title: `${company} Engineer ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "phenom",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(), missingSince: null,
});
function mock() {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_similar_companies") return { data: [
      { company: "AMD", company_token: "careers.amd.com", open_roles: 40, employees: null, employee_basis: null, category: "engineering" },
      { company: "Globex", company_token: "globex", open_roles: 30, employees: null, employee_basis: null, category: "engineering" },
    ] };
    return { data: [] };
  });
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") return { data: { job: row(0, "careers.amd.com", "AMD"), description: "x".repeat(300) }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 2 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const rows = (b.companies as string[] | undefined)?.[0] === "careers.amd.com"
        ? [row(0, "careers.amd.com", "AMD"), row(1, "careers.amd.com", "AMD")]
        : [row(0, "careers.amd.com", "AMD"), row(1, "globex", "Globex")];
      return { data: { jobs: rows, total: rows.length, totalAllCompanies: 2, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const hrefOf = (name: string) => screen.getAllByRole("link", { name })[0].getAttribute("href");

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
  clearBoardBudgetRefusal();
  mock();
});

describe("a dotted employer token links to the address this host serves", () => {
  it("the shared rule: a dot in the last segment takes the slash, a query stays after it", () => {
    expect(companyLanderPath("careers.amd.com")).toBe("/jobs/company/careers.amd.com/");
    expect(companyLanderPath("careers.amd.com", "from=explore")).toBe("/jobs/company/careers.amd.com/?from=explore");
    expect(companyLanderPath("globex")).toBe("/jobs/company/globex");
    expect(companyLanderPath("emqk~ca3~CX_1")).toBe("/jobs/company/emqk~ca3~CX_1");
    expect(publicPath("/jobs/company/Viz.ai?x=1#y")).toBe("/jobs/company/Viz.ai/?x=1#y");
    // A dot earlier in the path is not a file extension on the last segment.
    expect(publicPath("/jobs/company/a.b/extra")).toBe("/jobs/company/a.b/extra");
  });

  it("the board's card employer links: dotted gets the slash, plain does not", async () => {
    window.history.replaceState({}, "", "/jobs");
    render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    expect(hrefOf("AMD")).toBe("/jobs/company/careers.amd.com/");
    expect(hrefOf("Globex")).toBe("/jobs/company/globex");
  });

  it("the board writes the served form into the address bar and the canonical", async () => {
    const url = "/jobs/company/careers.amd.com/";
    window.history.replaceState({}, "", url);
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.textContent).toContain("AMD Engineer 1"), SLOW);
    await waitFor(() => expect(window.location.pathname, "a reload of this address would 404").toBe("/jobs/company/careers.amd.com/"), SLOW);
    const canon = [...document.head.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute("href"));
    expect(canon).toContain("https://resumebooster.work/jobs/company/careers.amd.com/");
  });

  it("the posting page's employer link", async () => {
    render(
      <MemoryRouter initialEntries={["/jobs/posting/phenom/careers.amd.com/1000"]}>
        <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByRole("link", { name: "AMD" }).length).toBeGreaterThan(0), SLOW);
    expect(hrefOf("AMD")).toBe("/jobs/company/careers.amd.com/");
  });

  it("the similar-companies tiles", async () => {
    render(<MemoryRouter><SimilarCompanies companyToken="initech" /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain("AMD"), SLOW);
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/jobs/company/careers.amd.com/");
    expect(hrefs).toContain("/jobs/company/globex");
  });
});
