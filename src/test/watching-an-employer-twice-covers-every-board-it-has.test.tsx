/**
 * WATCHING AN EMPLOYER TWICE COVERS EVERY BOARD IT HAS (S10-157).
 *
 * WHAT WAS WRONG. An employer's own page saves its watch over every board the
 * employer runs (S12-021). A secondary board's page stays its own board and
 * saves a watch of that one board, under the same name, "New roles at PwC".
 * Watched there first, a later Watch on the employer's page collided on the
 * name, answered "You're already watching PwC" and returned: the alerts went
 * on covering one board of three while the page said the employer was watched.
 *
 * WHAT HOLDS NOW, on the employer's page mounted signed in, with a watch of
 * one board already saved under the name:
 *   - the held watch is widened to the union of its boards and this page's,
 *     keeping the board it was saved from as `company`;
 *   - a watch that already covers them is not written again;
 *   - a row of that name that is not a plain employer watch is left alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";
import { companiesOf } from "@/lib/job-search-params";

type Call = { table: string; op: string; args: unknown[]; filters: Array<[string, unknown]> };
const invoke = vi.fn();
const calls: Call[] = [];
const toasts: Array<{ title?: string }> = [];
/** The params of the watch already saved under the name, or null when none is. */
let held: unknown = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [], error: null }),
  },
}));
// One session object for the whole file: the page's effects are keyed on it,
// and a new object on every render would re-run them on every render.
const AUTH = { user: { id: "u1" }, session: { user: { id: "u1" }, access_token: "t" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/hooks/use-toast", () => ({
  toast: (t: { title?: string }) => { toasts.push(t); return { id: "1", dismiss() {}, update() {} }; },
  useToast: () => ({ toast: () => ({}), dismiss() {}, toasts: [] }),
}));
function stubTable(table: string) {
  const c: Call = { table, op: "select", args: [], filters: [] };
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "not", "in", "gte", "lte", "is"]) th[k] = () => th;
  for (const op of ["insert", "update", "upsert", "delete"]) th[op] = (...args: unknown[]) => { c.op = op; c.args = args; calls.push(c); return th; };
  th.eq = (col: string, v: unknown) => { c.filters.push([col, v]); return th; };
  th.limit = async () => ({ data: [] });
  // The row a name already holds.
  th.maybeSingle = async () => ({ data: table === "user_job_searches" && held ? { params: held } : null, error: null });
  th.single = async () => ({ data: null });
  // A second watch of the same name collides: the table is unique on (user, name).
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) => Promise.resolve(
    table === "user_job_searches" && c.op === "insert" && held
      ? { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
      : { data: [], error: null },
  ).then(ok, bad);
  return th;
}
import Jobs, * as JobsModule from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 } as const;
const now = new Date().toISOString();
const row = (token: string, n: number) => ({
  id: `workday:${token}:${n}`, source: "workday", token, company: "PwC", title: `Associate ${n}`, location: "New York, NY, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "finance", department: null, agency: false,
  postedAt: now, lastSeen: now, recheckedAt: now, applyUrl: `https://apply.example/${token}/${n}`, remote: false,
});
const A = "pwc~wd3~Global_Experienced_Careers";
const B = "pwc~wd3~crm_experienced_careers_site";
const C = "pwc~wd3~global_campus_careers";
const POOL = { [A]: `/jobs/company/${A}`, [B]: `/jobs/company/${A}`, [C]: `/jobs/company/${A}` };

const searchWrites = (op: string) => calls.filter((c) => c.table === "user_job_searches" && c.op === op);

async function watchOnTheEmployersPage() {
  setLanderManifestForTests(POOL);
  const path = `/jobs/company/${A}`;
  window.history.replaceState({}, "", path);
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /^Watch/ }, SLOW));
  await waitFor(() => expect(toasts.length, "the click was never answered").toBeGreaterThan(0), SLOW);
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  calls.length = 0; toasts.length = 0; held = null;
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board" || b.action !== "list") return { data: {} };
    if (b.facetCounts) return { data: { categories: {} } };
    const cs = Array.isArray(b.companies) ? (b.companies as string[]) : [];
    if (b.countOnly) return { data: { total: cs.length * 100 } };
    const jobs = cs.map((t, i) => row(t, i + 1));
    return { data: { jobs, total: cs.length * 100, totalAllCompanies: cs.length * 100, companies: [], companiesCount: cs.length, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false, unknownCompanies: [] } };
  });
});
afterEach(() => { cleanup(); setLanderManifestForTests(null); });

describe("a Watch on the employer's page, when one of its boards is already watched under the name", () => {
  it("widens the held watch to every board the employer has", async () => {
    held = { company: C };
    await watchOnTheEmployersPage();
    expect(toasts.at(-1)!.title).toBe("You're already watching PwC.");
    const updates = searchWrites("update");
    expect(updates, "the watch went on covering one board of three").toHaveLength(1);
    const params = (updates[0].args[0] as { params: { company?: string; companies?: string[] } }).params;
    expect([...(params.companies ?? [])].sort()).toEqual([A, B, C].sort());
    // The board it was saved from stays its `company`, and the digest reads every board.
    expect(params.company).toBe(C);
    expect([...(companiesOf(params) ?? [])].sort()).toEqual([A, B, C].sort());
    // The row the collision named: this user's watch of this name.
    expect(updates[0].filters).toEqual(expect.arrayContaining([["user_id", "u1"], ["name", "New roles at PwC"]]));
  });

  it("writes nothing when the held watch already covers them", async () => {
    held = { company: A, companies: [A, B, C] };
    await watchOnTheEmployersPage();
    expect(toasts.at(-1)!.title).toBe("You're already watching PwC.");
    expect(searchWrites("update")).toEqual([]);
  });

  it("leaves a row of that name alone when it is not a plain employer watch", async () => {
    held = { company: C, q: "tax", country: "US" };
    await watchOnTheEmployersPage();
    expect(searchWrites("update"), "a saved search with its own filters was rewritten").toEqual([]);
  });

  it("control: with no watch held, the watch is saved over every board", async () => {
    held = null;
    await watchOnTheEmployersPage();
    const saved = searchWrites("insert")[0].args[0] as { params: unknown };
    expect(saved.params).toEqual({ company: A, companies: [A, B, C] });
    expect(searchWrites("update")).toEqual([]);
  });
});

describe("the widening rule", () => {
  const widen = (JobsModule as unknown as { widenedWatchParams: (held: unknown, boards: string[]) => { company?: string; companies: string[] } | null }).widenedWatchParams;

  it("unions the boards, first-saved first, and never repeats one", () => {
    expect(widen({ company: C }, [A, B, C])).toEqual({ company: C, companies: [C, A, B] });
    expect(widen({ company: A, companies: [A, B] }, [A, B, C])).toEqual({ company: A, companies: [A, B, C] });
    expect(widen({ companies: [B] }, [A])).toEqual({ companies: [B, A] });
  });

  it("has nothing to write for a covered watch, an unreadable row or a search with other filters", () => {
    expect(widen({ company: A, companies: [A, B, C] }, [A, B, C])).toBeNull();
    expect(widen({ company: A }, [A])).toBeNull();
    expect(widen(null, [A])).toBeNull();
    expect(widen("nope", [A])).toBeNull();
    expect(widen({}, [A])).toBeNull();
    expect(widen({ company: C, q: "tax" }, [A])).toBeNull();
  });
});
