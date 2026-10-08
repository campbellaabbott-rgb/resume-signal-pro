// A CLEARED SEARCH CANNOT KEEP ITS FIELD COUNTS.
//
// Under a query the field rail's numbers come from a facet probe (up to
// 1.5 s). Clearing the box took the "only the field is bound" branch, which
// set the probe counts to null and returned WITHOUT retiring the probe still
// in flight -- so its reply passed the sequence check and painted the old
// query's counts ("Healthcare & Clinical 1,009") over the unfiltered board,
// 3 of 3 runs in the register's scratch test.
//
// The positive control first: an answered probe's counts DO reach the rail
// while its query is applied. Then the race: hold the probe, clear the box,
// release it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
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
const BOARD = { healthcare: 52000, engineering: 30000 };
const NURSE = { healthcare: 1009, engineering: 12 };
const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Nurse ${i}`, category: "healthcare",
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
let release: (() => void) | null = null;
let holdProbe = false;
function mock() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) {
        if (holdProbe) await new Promise<void>((r) => { release = r; });
        return { data: { categories: NURSE }, error: null };
      }
      return { data: { jobs: [row(0), row(1), row(2)], total: 3, totalAllCompanies: 82000, companies: [], companiesCount: 0, categories: b.q ? {} : BOARD, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: BOARD, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const probes = () => invoke.mock.calls.filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.facetCounts === true);
const text = () => document.body.textContent ?? "";
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const box = () => document.getElementById("board-search") as HTMLInputElement;

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  release = null; holdProbe = false;
  mock();
  window.history.replaceState({}, "", "/jobs");
});

describe("a cleared search cannot keep its field counts", () => {
  it("positive control: an answered probe's counts reach the rail while its query stands", async () => {
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(text()).toContain("52,000"), SLOW);
    fireEvent.change(box(), { target: { value: "nurse" } });
    await waitFor(() => expect(probes().length).toBeGreaterThan(0), SLOW);
    await waitFor(() => expect(text()).toContain("1,009"), SLOW);
  });

  it("clearing the box before the probe answers retires the probe", async () => {
    holdProbe = true;
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(text()).toContain("52,000"), SLOW);
    fireEvent.change(box(), { target: { value: "nurse" } });
    await waitFor(() => expect(release, "the probe never went out").not.toBeNull(), SLOW);
    fireEvent.change(box(), { target: { value: "" } });
    await settle(100);
    await act(async () => { release!(); await new Promise((r) => setTimeout(r, 50)); });
    await settle(300);
    expect(text(), "the cleared query's counts were painted over the unfiltered board").not.toContain("1,009");
    expect(text()).toContain("52,000");
  });
});
