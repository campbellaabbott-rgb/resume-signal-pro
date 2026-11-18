/**
 * A POOLED EMPLOYER PAGE KEEPS ITS POOL UNDER A FILTER (S14X-014).
 *
 * PwC's page pools three Workday boards (the bake's /landers.json). With no
 * filter its address is /jobs/company/<primary>. With any filter on, the
 * board rewrote it to the query form /jobs?company=<primary>&workMode=remote,
 * and a reload or a shared link of that address was the board scoped to the
 * one primary board: the page's route, its pool and its count of the other
 * two boards were gone. A filtered page now keeps its own address, with the
 * filters as its query, and re-entering it re-pools.
 *
 * Positive control first: the bare page keeps the bare address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
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
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;
const now = new Date().toISOString();
const A = "pwc~wd3~Global_Experienced_Careers";
const B = "pwc~wd3~crm_experienced_careers_site";
const C = "pwc~wd3~global_campus_careers";
const POOL = { [A]: `/jobs/company/${A}`, [B]: `/jobs/company/${A}`, [C]: `/jobs/company/${A}` };
const row = (token: string, n: number) => ({
  id: `workday:${token}:${n}`, source: "workday", token, company: "PwC", title: `Associate ${n}`, location: "New York, NY, USA", country: "US",
  salary: null, workMode: "remote", employmentType: "full_time", category: "finance", postedAt: now, lastSeen: now, recheckedAt: now,
  applyUrl: `https://apply.example/${token}/${n}`, remote: true,
});
const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Record<string, unknown> })?.body?.action === "list" && "offset" in ((o as { body: Record<string, unknown> }).body))
  .map(([, o]) => (o as { body: Record<string, unknown> }).body);

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board" || b.action !== "list") return { data: {} };
    if (b.facetCounts) return { data: { categories: {} } };
    const cs = Array.isArray(b.companies) ? (b.companies as string[]) : [];
    if (b.countOnly) return { data: { total: cs.length * 10 } };
    const jobs = cs.map((t, i) => row(t, i + 1));
    return { data: { jobs, total: jobs.length, totalAllCompanies: jobs.length, companies: [], companiesCount: cs.length, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false, unknownCompanies: [] } };
  });
  setLanderManifestForTests(POOL);
});
afterEach(() => { cleanup(); setLanderManifestForTests(null); });

const mountAt = (path: string) => {
  window.history.replaceState({}, "", path);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/company/:companyToken" element={<Jobs />} />
      </Routes>
    </MemoryRouter>,
  );
};
const here = () => decodeURIComponent(window.location.pathname) + window.location.search;

describe("a pooled employer page keeps its pool under a filter", () => {
  it("positive control: the bare page keeps its bare address and reads the pool", async () => {
    mountAt(`/jobs/company/${A}`);
    await waitFor(() => expect(listBodies().length).toBeGreaterThan(0), SLOW);
    expect(listBodies()[0].companies).toEqual([A, B, C]);
    await waitFor(() => expect(document.body.textContent).toContain("Associate 3"), SLOW);
    expect(decodeURIComponent(window.location.pathname)).toBe(`/jobs/company/${A}`);
  });

  it("a filter on the page keeps the page's own address, with the filter as its query", async () => {
    // `stray` is no filter: the URL writer drops it, so its absence says the writer has run.
    mountAt(`/jobs/company/${A}?mode=remote&stray=1`);
    await waitFor(() => expect(listBodies().length).toBeGreaterThan(0), SLOW);
    const first = listBodies()[0];
    expect(first.companies, "the filtered page lost its pool").toEqual([A, B, C]);
    expect(first.workMode).toBe("remote");
    await waitFor(() => expect(document.body.textContent).toContain("Associate 3"), SLOW);
    await waitFor(() => expect(window.location.search).not.toContain("stray"), SLOW);
    expect(here(), "the filtered page was rewritten to the one-board query form").not.toMatch(/^\/jobs\?/);
    expect(decodeURIComponent(window.location.pathname)).toBe(`/jobs/company/${A}`);
    const qs = new URLSearchParams(window.location.search);
    expect(qs.get("mode")).toBe("remote");
    expect(qs.get("company"), "the company is the route; it does not ride in the query too").toBeNull();
  });
});
