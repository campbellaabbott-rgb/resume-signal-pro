// A LAP-READ BOARD'S POSTING IS VERIFIED WHEN IT IS OPENED (S14X-244).
//
// Opening a posting asks job-board to re-check it only when its re-check stamp
// is over six hours old. A board read in laps (the big Workday and Oracle
// boards) restamps its rows on every partial visit, so the stamp is almost
// never that old, and the posting a reader opens on exactly the boards whose
// closures we cannot prove was never re-checked. On a lap-read board the
// opened posting is now verified once, whatever its stamp says.
//
// Positive control first: a fully read board's fresh stamp still asks nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

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

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const hourAgo = new Date(Date.now() - 3600_000).toISOString();
const row = (token: string) => ({
  id: `workday:${token}:R1`, token, company: token === "lapco" ? "Lapco" : "Fullco", title: `Analyst at ${token}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: "https://x/1", source: "workday",
  postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), recheckedAt: hourAgo,
});
const curve = (token: string, bucket: string) => ({
  company_token: token, observability_bucket: bucket, open_roles: 40, filled_roles_90d: 3, relisted_roles_90d: 0,
  tracking_days: 30, sufficient: false, dated_coverage: 0.5,
});
const verifies = () => invoke.mock.calls.filter(([fn, o]) => fn === "job-board" && (o as { body: Body }).body?.action === "verify").map(([, o]) => (o as { body: Body }).body.ids);

function mountOpen(token: string, bucket: string) {
  const r = row(token);
  rpc.mockImplementation(async (fn: string) => fn === "get_company_fill_curve" ? { data: [curve(token, bucket)], error: null } : { data: [], error: null });
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") return { data: { job: r, description: "Analyse things." }, error: null };
    if (b.action === "verify") return { data: { live: { [r.id]: true } }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 1 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [r], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", `/jobs?job=${encodeURIComponent(r.id)}`);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  return r;
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  rpc.mockReset();
  clearBoardBudgetRefusal();
});

describe("a lap-read board's posting is verified when opened", () => {
  it("positive control: a fully read board's posting re-checked an hour ago is not asked about", async () => {
    mountOpen("fullco", "full_read");
    await waitFor(() => expect(rpc.mock.calls.some(([fn]) => fn === "get_company_fill_curve")).toBe(true), SLOW);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(verifies()).toEqual([]);
  });

  it("a lap-read board's posting re-checked an hour ago is verified, once", async () => {
    const r = mountOpen("lapco", "lap_pending");
    await waitFor(() => expect(verifies(), "the opened posting on a lap-read board was never re-checked").toEqual([[r.id]]), SLOW);
    await act(async () => { await new Promise((res) => setTimeout(res, 200)); });
    expect(verifies().length, "verified more than once for one opening").toBe(1);
  });
});
