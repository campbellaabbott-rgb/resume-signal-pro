/**
 * A COMPANY PAGE ON A PHONE SHOWS THE ORDER IT APPLIES, AND LETS IT BE CHANGED
 * (sweep S13-119).
 *
 * The company page's filter row was handed no sort below 640px, and the
 * board's own sort select is not rendered on a company page, so a phone had no
 * order control at all while a shared ?sort=salary link still applied the pay
 * order: an order the visitor could neither see nor change. The row now
 * carries the sort at every width.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;
const now = new Date().toISOString();
const rows = [1, 2, 3].map((n) => ({
  id: `greenhouse:acme:${n}`, source: "greenhouse", token: "acme", company: "Acme", title: `Engineer ${n}`, location: "Leeds, UK", country: "GB",
  salary: `£${40 + n},000`, salaryMinAnnual: 40000 + n * 1000, salaryMaxAnnual: null, salaryPeriod: "year", salaryCurrency: "GBP",
  workMode: null, employmentType: null, experienceBand: null, minYears: null, category: "engineering", department: null, agency: false,
  postedAt: now, lastSeen: now, recheckedAt: now, applyUrl: `https://apply.example/${n}`, remote: false,
}));

let matchMedia: typeof window.matchMedia;
beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  setLanderManifestForTests("*");
  matchMedia = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: /max-width:\s*640px/.test(q), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board" || b.action !== "list") return { data: {} };
    if (b.facetCounts) return { data: { categories: {} } };
    if (b.countOnly) return { data: { total: 3 } };
    return { data: { jobs: rows, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false, unknownCompanies: [] } };
  });
});
afterEach(() => { cleanup(); window.matchMedia = matchMedia; setLanderManifestForTests(null); });

const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Record<string, unknown> })?.body?.action === "list" && "offset" in ((o as { body: Record<string, unknown> }).body))
  .map(([, o]) => (o as { body: Record<string, unknown> }).body);

describe("a company page at 375px", () => {
  it("shows the pay order a shared link applied, and lets the visitor change it", async () => {
    const path = "/jobs/company/acme?sort=salary";
    window.history.replaceState({}, "", path);
    render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(listBodies().length).toBeGreaterThan(0), SLOW);
    expect(listBodies()[0].sort, "control: the link's pay order is applied").toBe("salary");
    const select = await waitFor(() => {
      const el = document.querySelector<HTMLSelectElement>("[data-filter-bar='company'] select#filter-bar-sort");
      expect(el, "the phone's company page has no order control").not.toBeNull();
      return el!;
    }, SLOW);
    expect(select.value).toBe("salary");
    fireEvent.change(select, { target: { value: "newest" } });
    await waitFor(() => expect(listBodies().at(-1)!.sort).not.toBe("salary"), SLOW);
  });
});
