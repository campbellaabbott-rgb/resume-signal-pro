/**
 * AN ALERT ASKED FOR ON A SEARCH ALREADY SAVED IS TURNED ON (sweep S11-037).
 *
 * WHAT WAS WRONG. "Alert me when this exists" (a search that found nothing)
 * and "Email me new matches" (a search read to its end) both save the search
 * with the digest on. A search's name is a pure function of its filters, and
 * user_job_searches is UNIQUE on (user_id, name), so a search the visitor had
 * already saved with the plain "Save this search" collided. The duplicate
 * branch only said "You already saved this search." and returned: the digest
 * stayed off, and the person who had just asked to be emailed never was.
 *
 * WHAT HOLDS NOW, on the board mounted signed in with a search that finds
 * nothing and a save that collides:
 *   - the alert CTA turns the digest on for the existing row (daily, the
 *     cadence an alert promises) and says alerts are on;
 *   - the plain "Save this search" on the same collision still only says the
 *     search is already saved, and changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

type Call = { table: string; op: string; args: unknown[]; filters: Array<[string, unknown]> };
const calls: Call[] = [];
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "seeker@example.com" }, session: { user: { id: "user-1", email: "seeker@example.com" }, access_token: "t" } }),
}));
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toastSpy(...a), useToast: () => ({ toast: toastSpy, toasts: [] }) }));

function stubTable(table: string) {
  let current: Call | null = null;
  const th: Record<string, unknown> = {};
  const result = () => {
    if (table === "user_job_searches" && current?.op === "insert") {
      return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "user_job_searches_user_id_name_key"' } };
    }
    return { data: [], error: null };
  };
  for (const op of ["insert", "update", "upsert", "delete"]) {
    th[op] = (...args: unknown[]) => { current = { table, op, args, filters: [] }; calls.push(current); return th; };
  }
  for (const k of ["select", "order", "not", "in", "is", "gte", "lte"]) th[k] = () => th;
  th.eq = (col: string, v: unknown) => { current?.filters.push([col, v]); return th; };
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) => Promise.resolve(result()).then(ok, bad);
  return th;
}

import Jobs from "../pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

const EMPTY = {
  jobs: [], total: 0, totalAllCompanies: 500000, companies: [], companiesCount: 0,
  categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
};

function mount(path: string) {
  window.history.replaceState({}, "", path);
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && (b.action === "list" || b.action === undefined)) {
      if (b.countOnly) return { data: { total: 0 } };
      return { data: EMPTY };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const searchWrites = () => calls.filter((c) => c.table === "user_job_searches");

beforeEach(() => {
  calls.length = 0;
  toastSpy.mockReset();
  invoke.mockReset();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(cleanup);

describe("an alert on a search that is already saved", () => {
  it("turns the digest on for the saved row and says so", async () => {
    mount("/jobs?q=underwater%20basket%20weaving");
    const cta = await screen.findByRole("button", { name: /Alert me when this exists/ }, SLOW);
    fireEvent.click(cta);
    await waitFor(() => expect(searchWrites().some((c) => c.op === "update"), "the existing row was never updated").toBe(true), SLOW);
    const insert = searchWrites().find((c) => c.op === "insert")!;
    const name = (insert.args[0] as { name: string }).name;
    const update = searchWrites().find((c) => c.op === "update")!;
    expect(update.args[0]).toMatchObject({ digest_opt_in: true, digest_cadence: "daily" });
    // The row the collision named: this user's search of this name, nobody else's.
    expect(update.filters).toEqual(expect.arrayContaining([["user_id", "user-1"], ["name", name]]));
    await waitFor(() => expect(toastSpy).toHaveBeenCalled(), SLOW);
    const titles = toastSpy.mock.calls.map((c) => String((c[0] as { title?: unknown }).title ?? ""));
    expect(titles).toContain("Alerts turned on");
    expect(titles, "the alert was refused as a duplicate").not.toContain("You already saved this search.");
  });

  it("a plain save on the same collision changes nothing and says it is already saved", async () => {
    mount("/jobs?q=underwater%20basket%20weaving");
    const save = await screen.findByRole("button", { name: /Save this search/ }, SLOW);
    fireEvent.click(save);
    await waitFor(() => expect(toastSpy).toHaveBeenCalled(), SLOW);
    const titles = toastSpy.mock.calls.map((c) => String((c[0] as { title?: unknown }).title ?? ""));
    expect(titles).toContain("You already saved this search.");
    expect(searchWrites().filter((c) => c.op === "update")).toEqual([]);
  });
});
