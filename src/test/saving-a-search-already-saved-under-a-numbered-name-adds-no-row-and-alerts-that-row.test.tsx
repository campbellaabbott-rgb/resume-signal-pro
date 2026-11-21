// SAVING A SEARCH ALREADY SAVED UNDER A NUMBERED NAME ADDS NO ROW AND ALERTS
// THAT ROW (sweep BOARD-05, the residue of NB-4 and NB-25).
//
// WHAT WAS WRONG. user_job_searches is UNIQUE(user_id, name). When a search's
// name was already another search's, the board tried "name (2)", "name (3)"
// and so on by inserting, without reading what those rows held. So:
//   - a search saved once as "name (2)" and saved again collided there, went
//     on to "name (3)" and landed: two rows of one search, two digests;
//   - with every numbered name taken, the collision fell through to the
//     alert branch, which switched the digest on for the BASE-name row, the
//     other search, and said "Alerts turned on" for a search that was not
//     saved at all.
//
// WHAT HOLDS NOW, on the board mounted signed in over a search that finds
// nothing (so "Alert me when this exists" is offered):
//   - this search held under "name (2)": Alert me turns the digest on for that
//     row and adds none; a plain Save adds none and says it is already saved;
//   - every numbered name held by other searches: nothing is alerted, nothing
//     is added, and the page says the save failed;
//   - control: a free numbered name still takes the new row, digest on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

type Call = { op: string; row: Record<string, unknown> | null; filters: Array<[string, unknown]> };
const calls: Call[] = [];
const invoke = vi.fn();
/** The rows this reader holds, by name: laid out from the page's own first insert, so `params` is exactly what it saves. */
let rows = new Map<string, Record<string, unknown>>();
let layout: (thisSearch: Record<string, unknown>, base: string) => Map<string, Record<string, unknown>> = () => new Map();
let laidOut = false;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: { user: { id: "user-1" }, access_token: "t" } }),
}));
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toastSpy(...a), useToast: () => ({ toast: toastSpy, toasts: [] }) }));

function stubTable(table: string) {
  const th: Record<string, unknown> = {};
  let call: Call | null = null;
  const named = () => call?.filters.find(([c]) => c === "name")?.[1] as string | undefined;
  const result = () => {
    if (table !== "user_job_searches" || !call) return { data: [], error: null };
    if (call.op === "insert") {
      const name = String(call.row?.name);
      if (!laidOut) { laidOut = true; rows = layout(call.row?.params as Record<string, unknown>, name); }
      if (rows.has(name)) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "user_job_searches_user_id_name_key"' } };
      rows.set(name, call.row?.params as Record<string, unknown>);
      return { data: null, error: null };
    }
    return { data: [], error: null };
  };
  for (const op of ["insert", "update", "upsert", "delete"]) {
    th[op] = (row: Record<string, unknown> | null = null) => {
      call = { op, row, filters: [] };
      if (table === "user_job_searches") calls.push(call);
      return th;
    };
  }
  th.select = () => { if (!call) call = { op: "select", row: null, filters: [] }; return th; };
  for (const k of ["order", "not", "in", "is", "gte", "lte"]) th[k] = () => th;
  th.eq = (col: string, v: unknown) => { call?.filters.push([col, v]); return th; };
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => {
    const name = named();
    const params = table === "user_job_searches" && name ? rows.get(name) : undefined;
    return { data: params ? { params } : null, error: null };
  };
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) => Promise.resolve(result()).then(ok, bad);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

const EMPTY = {
  jobs: [], total: 0, totalAllCompanies: 500000, companies: [], companiesCount: 0,
  categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
};
/** Another search under a name: this one, in another country. */
const other = (p: Record<string, unknown>, country: string) => ({ ...p, country });

function mount() {
  window.history.replaceState({}, "", "/jobs?q=underwater%20basket%20weaving");
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && (b.action === "list" || b.action === undefined)) {
      if (b.countOnly) return { data: { total: 0 }, error: null };
      return { data: EMPTY, error: null };
    }
    return { data: {}, error: null };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const inserts = () => calls.filter((c) => c.op === "insert").map((c) => String(c.row?.name));
const updates = () => calls.filter((c) => c.op === "update");
const toasts = () => toastSpy.mock.calls.map((c) => String((c[0] as { title?: unknown }).title ?? ""));
async function press(label: RegExp) {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: label }, SLOW));
  await waitFor(() => expect(toastSpy).toHaveBeenCalled(), SLOW);
  await new Promise((r) => setTimeout(r, 150));
}

beforeEach(() => {
  calls.length = 0;
  rows = new Map();
  laidOut = false;
  toastSpy.mockReset();
  invoke.mockReset();
  clearBoardBudgetRefusal();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(cleanup);

describe("this search, already saved under a numbered name", () => {
  beforeEach(() => {
    layout = (p, base) => new Map([[base, other(p, "GB")], [`${base} (2)`, p]]);
  });

  it("Alert me turns the digest on for that row and adds none", async () => {
    await press(/Alert me when this exists/);
    const base = inserts()[0];
    expect(inserts(), "the same search was saved a second time under the next number").toEqual([base]);
    expect(updates(), "no row was alerted").toHaveLength(1);
    expect(updates()[0].row).toMatchObject({ digest_opt_in: true, digest_cadence: "daily" });
    expect(updates()[0].filters, "the alert went to another search's row").toEqual(expect.arrayContaining([["user_id", "user-1"], ["name", `${base} (2)`]]));
    expect(toasts()).toContain("Alerts turned on");
  });

  it("a plain Save adds none and says it is already saved", async () => {
    await press(/Save this search/);
    expect(inserts()).toHaveLength(1);
    expect(updates()).toEqual([]);
    expect(toasts()).toContain("You already saved this search.");
  });
});

describe("every numbered name held by another search", () => {
  beforeEach(() => {
    layout = (p, base) => new Map([
      [base, other(p, "GB")],
      ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`${base} (${n})`, other(p, `C${n}`)] as [string, Record<string, unknown>]),
    ]);
  });

  it("Alert me alerts no row, adds none and says the save failed", async () => {
    await press(/Alert me when this exists/);
    expect(updates(), "the base-name row, another search, was alerted for this one").toEqual([]);
    expect(rows.size, "a row was added").toBe(9);
    expect(toasts()).toContain("Couldn't save — try again.");
    expect(toasts()).not.toContain("Alerts turned on");
  });
});

describe("control: a free numbered name", () => {
  beforeEach(() => {
    layout = (p, base) => new Map([[base, other(p, "GB")]]);
  });

  it("takes the new row, with the digest on, and alerts nothing else", async () => {
    await press(/Alert me when this exists/);
    const base = inserts()[0];
    expect(inserts()).toEqual([base, `${base} (2)`]);
    expect(calls.find((c) => c.op === "insert" && c.row?.name === `${base} (2)`)?.row).toMatchObject({ digest_opt_in: true });
    expect(updates()).toEqual([]);
  });
});
