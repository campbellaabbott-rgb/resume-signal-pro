// A SIGN-IN THE BOARD ASKED FOR FINISHES THE CLICK THAT ASKED (NB-3).
//
// Save, Alert me, Watch and Prepare ask a signed-out reader to sign in. The
// board sent them to /auth with no way back: they returned to the home page,
// their filters gone, and the click that sent them had to be found and made
// again. Now the sign-in comes back to this page with its filters
// (/auth?next=<this address>), and the click is remembered for an hour and
// done once, when the reader is back signed in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
const auth: { value: { user: { id: string } | null; session: { user: { id: string }; access_token: string } | null } } = { value: { user: null, session: null } };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
function stubTable(table: string) {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "in", "gte", "lte", "is", "upsert", "delete"]) th[k] = self;
  th.insert = (row: Record<string, unknown>) => { inserts.push({ table, row }); return th; };
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: { id: "app-1" }, error: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok, bad);
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
function SignIn() {
  const loc = useLocation();
  return <p data-testid="auth">{loc.search}</p>;
}
const mount = (url: string) => {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/auth" element={<SignIn />} />
      </Routes>
    </MemoryRouter>,
  );
};
const saves = () => inserts.filter((i) => i.table === "user_applications");

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  inserts.length = 0;
  auth.value = { user: null, session: null };
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
});
afterEach(() => cleanup());

describe("a sign-in the board asked for finishes the click that asked", () => {
  it("signed out, Save sends the reader to sign in with the way back to this page and its filters", async () => {
    mount("/jobs?mode=remote");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Save Analyst 1" }).length).toBeGreaterThan(0), SLOW);
    fireEvent.click(screen.getAllByRole("button", { name: "Save Analyst 1" })[0]);
    const next = await screen.findByTestId("auth", undefined, SLOW);
    const back = new URLSearchParams(next.textContent ?? "").get("next") ?? "";
    expect(back, "the sign-in had no way back to the board").toMatch(/^\/jobs\?/);
    expect(new URLSearchParams(back.split("?")[1]).get("mode"), "the way back lost the reader's filter").toBe("remote");
    expect(saves()).toEqual([]);
  });

  it("back and signed in, the save is done once, and not again on the next visit", async () => {
    mount("/jobs");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Save Analyst 1" }).length).toBeGreaterThan(0), SLOW);
    fireEvent.click(screen.getAllByRole("button", { name: "Save Analyst 1" })[0]);
    await screen.findByTestId("auth", undefined, SLOW);
    cleanup();
    auth.value = { user: { id: "u1" }, session: { user: { id: "u1" }, access_token: "t" } };
    mount("/jobs");
    await waitFor(() => expect(saves().length, "the click that sent the reader to sign in was never done").toBe(1), SLOW);
    expect(saves()[0].row).toMatchObject({ job_id: "greenhouse:acme:1001" });
    cleanup();
    mount("/jobs");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Save Analyst 0" }).length).toBeGreaterThan(0), SLOW);
    await new Promise((r) => setTimeout(r, 200));
    expect(saves().length, "the remembered click was done twice").toBe(1);
  });

  it("control: a signed-in visit with nothing remembered saves nothing", async () => {
    auth.value = { user: { id: "u1" }, session: { user: { id: "u1" }, access_token: "t" } };
    mount("/jobs");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Save Analyst 0" }).length).toBeGreaterThan(0), SLOW);
    await new Promise((r) => setTimeout(r, 200));
    expect(saves()).toEqual([]);
  });
});
