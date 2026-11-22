// AN EVENING APPLY CLICK IS DATED THE READER'S OWN DAY (S10-159).
//
// WHAT WAS WRONG. An Apply click writes the tracker row's applied_at. Promoting
// a saved row wrote the UTC day (toISOString's first ten characters), and a
// new row took the database's current_date, which is UTC too. At 23:30 on
// 14 November in New York it is already the 15th in UTC, so the tracker said
// the reader applied tomorrow. (The account page prints the stored day as a
// calendar day, so the wrong day was shown exactly as written.)
//
// WHAT HOLDS NOW, on the board mounted signed in at 23:30 New York time on
// 14 November 2026: the new row and the promoted row are both dated the 14th.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

type Call = { table: string; op: string; args: unknown[]; filters: Array<[string, unknown]> };
const invoke = vi.fn();
const calls: Call[] = [];
let tracked: Array<{ job_id: string; status: string }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
// One session object for the whole file: the page's effects are keyed on it,
// and a new object on every render would re-run them on every render.
const AUTH = { user: { id: "u1" }, session: { user: { id: "u1" }, access_token: "t" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
function stubTable(table: string) {
  const c: Call = { table, op: "select", args: [], filters: [] };
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "not", "in", "gte", "lte", "is"]) th[k] = () => th;
  for (const op of ["insert", "update", "upsert", "delete"]) th[op] = (...args: unknown[]) => { c.op = op; c.args = args; calls.push(c); return th; };
  th.eq = (col: string, v: unknown) => { c.filters.push([col, v]); return th; };
  th.limit = async () => ({ data: [], error: null });
  th.maybeSingle = async () => ({ data: null, error: null });
  th.single = async () => ({ data: null, error: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) =>
    Promise.resolve({ data: table === "user_applications" && c.op === "select" ? tracked : [], error: null }).then(ok, bad);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
/** 23:30 on Saturday 14 November 2026 in New York (UTC-5): 04:30 on the 15th in UTC. */
const EVENING = new Date("2026-11-15T04:30:00Z");
const ROW = {
  id: "greenhouse:acme:4411", token: "acme", company: "Acme", title: "Staff Nurse", location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: "https://boards.greenhouse.io/acme/jobs/4411", source: "greenhouse",
  postedAt: "2026-11-12T15:00:00Z", recheckedAt: "2026-11-15T04:00:00Z",
};

function mountOpen() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") return { data: { job: ROW, description: "Care for patients on a busy medical ward." }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 1 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [ROW], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", `/jobs?job=${encodeURIComponent(ROW.id)}`);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const trackerWrites = (op: string) => calls.filter((c) => c.table === "user_applications" && c.op === op);
async function clickApply() {
  mountOpen();
  await waitFor(() => expect(document.body.textContent).toContain("Care for patients"), SLOW);
  fireEvent.click(document.querySelector<HTMLElement>("[data-apply-link]")!);
}

const ownZone = process.env.TZ;
beforeAll(() => { process.env.TZ = "America/New_York"; });
afterAll(() => { if (ownZone === undefined) delete process.env.TZ; else process.env.TZ = ownZone; });

beforeEach(() => {
  // Only the clock is faked: timers stay real, so the page's waits still run.
  vi.useFakeTimers({ toFake: ["Date"], now: EVENING });
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  calls.length = 0;
  tracked = [];
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("an Apply click at 23:30 in New York on 14 November", () => {
  it("the test's own clock is the reader's: the 14th there, already the 15th in UTC", () => {
    const now = new Date();
    expect(now.toISOString().slice(0, 10)).toBe("2026-11-15");
    expect([now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours()]).toEqual([2026, 11, 14, 23]);
  });

  it("dates a new tracker row the 14th", async () => {
    await clickApply();
    await waitFor(() => expect(trackerWrites("insert")).toHaveLength(1), SLOW);
    const written = trackerWrites("insert")[0].args[0] as { status?: string; applied_at?: string };
    expect(written.status).toBe("applied");
    expect(written.applied_at, "the row was left to the database's UTC day, which is tomorrow for this reader").toBe("2026-11-14");
  });

  it("dates a saved row promoted to applied the 14th", async () => {
    tracked = [{ job_id: ROW.id, status: "saved" }];
    await clickApply();
    await waitFor(() => expect(trackerWrites("update")).toHaveLength(1), SLOW);
    const written = trackerWrites("update")[0].args[0] as { status?: string; applied_at?: string };
    expect(written.status).toBe("applied");
    expect(written.applied_at, "the click was dated tomorrow").toBe("2026-11-14");
  });
});
