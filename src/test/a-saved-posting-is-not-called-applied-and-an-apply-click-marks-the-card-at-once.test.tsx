// A SAVED POSTING IS NOT CALLED APPLIED, AND AN APPLY CLICK MARKS THE CARD AT
// ONCE (S10-155, S10-156).
//
// WHAT WAS WRONG.
//   - S10-155: "Prep answers" warns before drafting when the posting is
//     already applied to, because applying twice to one role counts against a
//     candidate. It judged "applied" by the row's status OR its applied_at
//     date, and applied_at is NOT NULL with a default of today on every
//     tracker row. So a posting the reader had only bookmarked was announced
//     as "You've already marked this posting as applied".
//   - S10-156: an Apply click writes the tracker row as applied, but the set
//     the card reads its "✓ Applied" mark from was filled once, at mount. The
//     card and "Hide applied" ignored the click until the page was reloaded.
//
// WHAT HOLDS NOW, on the board mounted signed in with a posting open:
//   - a saved posting opens Prep answers with no warning; an applied one (or
//     any status past saved) still warns;
//   - an Apply click marks the card applied as soon as the write lands, for a
//     new row and for a saved one, and not when the write failed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

type Call = { table: string; op: string; args: unknown[]; filters: Array<[string, unknown]> };
const invoke = vi.fn();
const calls: Call[] = [];
/** The tracker's rows for the open posting, as the database holds them. */
let tracked: Array<{ job_id: string; status: string; applied_at: string }> = [];
let writeFails = false;

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
  // The "is this posting already in my tracker" read: every column the row has.
  th.limit = async () => ({ data: table === "user_applications" ? tracked : [], error: null });
  th.maybeSingle = async () => ({ data: null, error: null });
  th.single = async () => ({ data: null, error: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) => Promise.resolve(
    c.op !== "select" && writeFails ? { data: null, error: { code: "XX000", message: "write refused" } }
      : { data: table === "user_applications" && c.op === "select" ? tracked : [], error: null },
  ).then(ok, bad);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const RESUME = "Registered nurse with eight years of acute care experience in a level one trauma centre. ".repeat(3);
// A Greenhouse posting: one whose real application questions the board reads, so Prep answers is offered.
const ROW = {
  id: "greenhouse:acme:4411", token: "acme", company: "Acme", title: "Staff Nurse", location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: "https://boards.greenhouse.io/acme/jobs/4411", source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
};
const WARNING = "You've already marked this posting as applied";

function mountOpen() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: [] }, error: null };
    if (fn === "job-fit" && b.action === "fit-batch") {
      const ids = (b.ids as string[]) ?? [];
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, 44])), unscored: {}, missing: {}, matched: {} }, error: null };
    }
    if (fn !== "job-board") return { data: null, error: null };
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

const text = () => document.body.textContent ?? "";
const card = () => document.querySelector<HTMLElement>(`[data-job-id="${ROW.id}"]`);
const trackerWrites = (op: string) => calls.filter((c) => c.table === "user_applications" && c.op === op);

async function openPrepAnswers() {
  mountOpen();
  await waitFor(() => expect(text()).toContain("Care for patients"), SLOW);
  fireEvent.click((await screen.findAllByRole("button", { name: /Prep answers/ }, SLOW))[0]);
  await waitFor(() => expect(text()).toContain("Prepare your application"), SLOW);
}
async function clickApply() {
  mountOpen();
  await waitFor(() => expect(text()).toContain("Care for patients"), SLOW);
  await waitFor(() => expect(card(), "the posting's card is not on the page").not.toBeNull(), SLOW);
  expect(card()!.textContent, "the card was marked applied before any click").not.toContain("✓ Applied");
  fireEvent.click(document.querySelector<HTMLElement>("[data-apply-link]")!);
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  sessionStorage.setItem("rb_board_resume", RESUME);
  calls.length = 0;
  tracked = [];
  writeFails = false;
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("Prep answers on a posting that is only saved (S10-155)", () => {
  it("does not say the reader already applied", async () => {
    // What the database holds for a bookmark: a date, by default, and status saved.
    tracked = [{ job_id: ROW.id, status: "saved", applied_at: "2026-11-02" }];
    await openPrepAnswers();
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(text(), "a bookmarked posting was announced as already applied to").not.toContain(WARNING);
  });

  it.each(["applied", "interviewing"])("control: a posting whose status is %s still warns", async (status) => {
    tracked = [{ job_id: ROW.id, status, applied_at: "2026-11-02" }];
    await openPrepAnswers();
    await waitFor(() => expect(text()).toContain(WARNING), SLOW);
  });
});

describe("an Apply click (S10-156)", () => {
  it("marks the card applied as soon as the new tracker row lands", async () => {
    await clickApply();
    await waitFor(() => expect(trackerWrites("insert")).toHaveLength(1), SLOW);
    expect(trackerWrites("insert")[0].args[0]).toMatchObject({ job_id: ROW.id, status: "applied" });
    await waitFor(() => expect(card()!.textContent, "the card ignored the click until a reload").toContain("✓ Applied"), SLOW);
  });

  it("marks the card when the posting was saved first", async () => {
    tracked = [{ job_id: ROW.id, status: "saved", applied_at: "2026-11-02" }];
    await clickApply();
    await waitFor(() => expect(trackerWrites("update")).toHaveLength(1), SLOW);
    expect(trackerWrites("update")[0].args[0]).toMatchObject({ status: "applied" });
    // Only a row still saved is promoted: a richer status is never written down.
    expect(trackerWrites("update")[0].filters).toEqual(expect.arrayContaining([["job_id", ROW.id], ["status", "saved"]]));
    await waitFor(() => expect(card()!.textContent).toContain("✓ Applied"), SLOW);
  });

  it("does not mark the card when the write failed", async () => {
    writeFails = true;
    await clickApply();
    await waitFor(() => expect(trackerWrites("insert")).toHaveLength(1), SLOW);
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(card()!.textContent, "a posting the tracker does not hold was marked applied").not.toContain("✓ Applied");
  });
});
