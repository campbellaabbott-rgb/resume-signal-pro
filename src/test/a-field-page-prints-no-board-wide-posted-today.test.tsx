// A FIELD PAGE PRINTS NO BOARD-WIDE "POSTED TODAY" (S14X-015).
//
// "N posted today." is one count of the whole board: it is asked with
// maxAgeDays 1 and no other filter. It was printed beside every count line,
// so on /jobs/field/healthcare it stood after the field's own number and read
// as the field's (4,179 "posted today" on a field of 4,595, of which 14 were).
// It is printed now only where nothing narrows the board.
//
// Positive control first: the bare board prints it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
const row = (i: number) => ({
  id: `greenhouse:mercy:${1000 + i}`, token: "mercy", company: "Mercy", title: `Night Nurse ${i}`, category: "healthcare",
  location: "Leeds, United Kingdom", country: "GB", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
function mock() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      // The board-wide posted-today count: maxAgeDays 1 and nothing else.
      if (b.countOnly && b.maxAgeDays === 1) return { data: { total: 4179 }, error: null };
      if (b.countOnly) return { data: { total: 4595 }, error: null };
      if (b.facetCounts) return { data: { categories: { healthcare: 4595 } }, error: null };
      return {
        data: {
          jobs: Array.from({ length: 4 }, (_, i) => row(i)), total: 4595, totalAllCompanies: 815909, companiesOpenCount: 24931,
          categories: { healthcare: 4595 }, companies: [], companiesCount: 0, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: true,
        },
        error: null,
      };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const mount = (url: string) => {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/field/:category" element={<Jobs />} />
      </Routes>
    </MemoryRouter>,
  );
};
const postedToday = () => document.querySelector("[data-board-new-today]");
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  mock();
});

describe("a field page prints no board-wide posted today", () => {
  it("positive control: the bare board prints the board's posted-today count", async () => {
    mount("/jobs");
    await waitFor(() => expect(postedToday()?.textContent).toContain("4,179 posted today."), SLOW);
  });

  it("a field page does not print it beside the field's own count", async () => {
    mount("/jobs/field/healthcare");
    await waitFor(() => expect(document.body.textContent).toContain("Night Nurse 3"), SLOW);
    await settle(150);
    expect(postedToday(), "the board's posted-today count stood beside a field's number").toBeNull();
    expect(document.body.textContent).not.toContain("4,179 posted today");
  });

  it("a filter on the bare board takes it away too", async () => {
    mount("/jobs?mode=remote");
    await waitFor(() => expect(document.body.textContent).toContain("Night Nurse 3"), SLOW);
    await settle(150);
    expect(postedToday()).toBeNull();
  });
});
