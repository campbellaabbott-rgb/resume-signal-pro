// A FIELD LANDER OPENED AT THE LAST BOARD'S SCROLL (S8-091).
//
// The board saved window.scrollY as a bare number when it unmounted and
// restored it on the next board mount, whatever that board was. Board, then
// Explore, then the "Healthcare" tile: /jobs/field/healthcare opened 1,703px
// down, past its heading, its count and its back link (measured in the browser
// pane: scrollTo [0,0] and then {top:1703}).
//
// The offset is now keyed by the address it was saved on and restored only by
// a Back/Forward onto that address. Positive control: coming back to the same
// board still lands where it was left.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
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

const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Nurse ${i}`, category: "healthcare",
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
function board(url: string) {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/field/:category" element={<Jobs />} />
      </Routes>
    </MemoryRouter>,
  );
}
const text = () => document.body.textContent ?? "";
let scrollTo: ReturnType<typeof vi.spyOn>;
const restoredTo = (y: number) => scrollTo.mock.calls.some((c) => {
  const a = c[0] as unknown;
  return !!a && typeof a === "object" && (a as { top?: number }).top === y;
});

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      if (b.countOnly) return { data: { total: 3 }, error: null };
      return { data: { jobs: [row(0), row(1), row(2)], total: 3, totalAllCompanies: 100, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    return { data: {}, error: null };
  });
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
});
afterEach(() => { scrollTo.mockRestore(); });

describe("a field lander opened at the last board's scroll", () => {
  it("a different board does not open at the offset another board was left at", async () => {
    const first = board("/jobs");
    await waitFor(() => expect(text()).toContain("Nurse 2"), SLOW);
    Object.defineProperty(window, "scrollY", { value: 1703, configurable: true, writable: true });
    first.unmount();

    scrollTo.mockClear();
    const lander = board("/jobs/field/healthcare");
    await waitFor(() => expect(text()).toContain("Nurse 2"), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(restoredTo(1703), "the field lander opened at /jobs' scroll offset").toBe(false);
    lander.unmount();

    // Positive control: Back onto /jobs (a POP onto the address it was saved
    // on) lands where that board was left.
    scrollTo.mockClear();
    board("/jobs");
    await waitFor(() => expect(text()).toContain("Nurse 2"), SLOW);
    await waitFor(() => expect(restoredTo(1703)).toBe(true), SLOW);
  });
});
