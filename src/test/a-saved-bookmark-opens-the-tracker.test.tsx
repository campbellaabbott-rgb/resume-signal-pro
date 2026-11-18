// A SAVED BOOKMARK OPENS THE TRACKER (S14X-173).
//
// The card's filled bookmark says "In your application tracker — click to
// open it". Clicking it saved the posting again instead (a second insert, a
// second "Saved" toast) and never opened anything. A saved posting's bookmark
// now opens the tracker; an unsaved one still saves.
//
// Positive control first: the unsaved bookmark saves.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
const inserts: Array<{ table: string; row: unknown }> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { user: { id: "u1" }, access_token: "t" } }) }));
// The tracker holds one posting, saved earlier.
const TRACKED = [{ job_id: "greenhouse:acme:1000", status: "saved" }];
function stubTable(table: string) {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "in", "gte", "lte", "is", "upsert", "delete"]) th[k] = self;
  th.insert = (row: unknown) => { inserts.push({ table, row }); return th; };
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: { id: "app-1" }, error: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) =>
    Promise.resolve({ data: table === "user_applications" ? TRACKED : [], error: null }).then(ok, bad);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Analyst ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
function Tracker() {
  const loc = useLocation();
  return <p data-testid="tracker">tracker {loc.hash}</p>;
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  inserts.length = 0;
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 2 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [row(0), row(1)], total: 2, totalAllCompanies: 2, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  render(
    <MemoryRouter initialEntries={["/jobs"]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/account" element={<Tracker />} />
      </Routes>
    </MemoryRouter>,
  );
});

const bookmark = (title: string) => screen.getAllByRole("button", { name: `Save ${title}` })[0];

describe("a saved bookmark opens the tracker", () => {
  it("positive control: an unsaved posting's bookmark saves it", async () => {
    await waitFor(() => expect(bookmark("Analyst 1").getAttribute("aria-pressed")).toBe("false"), SLOW);
    fireEvent.click(bookmark("Analyst 1"));
    await waitFor(() => expect(inserts.some((i) => i.table === "user_applications")).toBe(true), SLOW);
    expect(screen.queryByTestId("tracker")).toBeNull();
  });

  it("a saved posting's bookmark opens the tracker's pipeline, and saves nothing", async () => {
    await waitFor(() => expect(bookmark("Analyst 0").getAttribute("aria-pressed")).toBe("true"), SLOW);
    fireEvent.click(bookmark("Analyst 0"));
    await waitFor(() => expect(screen.getByTestId("tracker").textContent).toBe("tracker #pipeline"), SLOW);
    expect(inserts.filter((i) => i.table === "user_applications"), "the saved posting was saved again").toEqual([]);
  });
});
