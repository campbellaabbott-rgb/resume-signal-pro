// A LINK OPENED WHILE THE BROWSER CHECK IS REFUSED OFFERS A RETRY FOR THAT
// POSTING (S10-164's review blocker, lane board-ui).
//
// WHAT WAS WRONG. S10-164 keeps a "pass" refusal (the board's browser check
// was missing or stale) out of the page-wide store when a background call met
// it, so a refused badge count no longer pauses the whole board. But every
// call through the board's invokeBoard was made a background one, including
// the detail read of a posting opened by its link, and that read returned in
// silence on any refusal, trusting the page-wide notice to speak for it. With
// nothing in the store there was no notice: the reader who clicked a fit-alert
// mail's View link saw the list and nothing about the posting they opened.
//
// WHAT HOLDS NOW, on the board mounted at /jobs?job=<an id the list does not
// hold>, the list served and that id's detail read refused with code "pass":
//   - the link's own note appears, with a Try again, and nothing is claimed
//     about the posting (no "no longer available", no noindex);
//   - Try again asks for a new browser check first, then reads the posting
//     again, and the posting opens;
//   - controls: an ordinary failure gets the same note but no new check; an
//     allowance refusal stands page-wide, so the board's notice speaks and the
//     link adds no note of its own.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { boardBudgetRefusal, clearBoardBudgetRefusal } from "@/lib/board-budget";

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
// The new browser check is the board-pass module's; here it is only counted.
const freshPass = vi.fn(async () => null as string | null);
vi.mock("@/lib/invoke-job-board", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestFreshBoardPass: () => freshPass(),
}));
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
const LINKED = "greenhouse:acme:9001";
const row = (id: string, title: string) => ({
  id, token: "acme", company: "Acme", title, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${encodeURIComponent(id)}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const LISTED = [row("greenhouse:acme:1", "Staff Nurse"), row("greenhouse:acme:2", "Charge Nurse"), row("greenhouse:acme:3", "Nurse Educator")];
const POSTING_TEXT = "Triage and treat patients in a busy emergency department.";

/** What supabase-js hands back for a non-2xx: data null, the Response on error.context, body unread. */
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});
const PASS_REFUSAL = () => httpError(429, { error: "board_budget", code: "pass", limit: null, resetAt: null });
const ADDRESS_REFUSAL = () => httpError(429, { error: "board_budget", code: "address", limit: 10000, used: 10000, resetAt: new Date(Date.now() + 6 * 3600_000).toISOString() });
const SERVER_ERROR = () => httpError(500, { error: "boom" });

let linkedReads = 0;
/** The first `failedReads` reads of the linked posting answer this; every later read serves it. */
let firstLinkedAnswer: () => unknown = PASS_REFUSAL;
let failedReads = 1;

function mount() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") {
      if (b.id !== LINKED) return { data: { description: "A posting in the list." }, error: null };
      linkedReads += 1;
      if (linkedReads <= failedReads) return firstLinkedAnswer();
      return { data: { job: row(LINKED, "Emergency Department Nurse"), description: POSTING_TEXT }, error: null };
    }
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: LISTED, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    if (b.action === "verify") return { data: { live: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", `/jobs?job=${encodeURIComponent(LINKED)}`);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
const note = () => document.querySelector("[data-deep-link-failed]");
/** The note's first button is its Try again (its second is Dismiss). */
const retry = () => document.querySelector<HTMLButtonElement>("[data-deep-link-failed] button");
const noindex = () => document.querySelector('meta[name="robots"][content*="noindex"]');
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  linkedReads = 0;
  firstLinkedAnswer = PASS_REFUSAL;
  failedReads = 1;
  invoke.mockReset();
  freshPass.mockClear();
  clearBoardBudgetRefusal();
});
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); });

describe("a posting opened by its link, whose read meets a refused browser check", () => {
  it("shows the link's own note with a Try again, and claims nothing about the posting", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Nurse"), SLOW);
    await waitFor(() => expect(linkedReads, "the linked posting was never read").toBe(1), SLOW);
    await waitFor(() => expect(note(), "the reader who opened the link sees nothing about it").not.toBeNull(), SLOW);
    expect(retry(), "the note offers no Try again").not.toBeNull();
    // Nothing is claimed about a posting nobody answered for.
    expect(text()).not.toContain("Posting no longer available");
    expect(noindex(), "a refused read put noindex on what may be a live posting").toBeNull();
    // The list the reader was given stays on screen.
    expect(text()).toContain("Charge Nurse");
  });

  it("asks for a new browser check on Try again, then reads the posting again and opens it", async () => {
    mount();
    await waitFor(() => expect(retry()).not.toBeNull(), SLOW);
    expect(freshPass).not.toHaveBeenCalled();
    fireEvent.click(retry()!);
    await waitFor(() => expect(freshPass, "Try again did not ask for a new browser check").toHaveBeenCalledTimes(1), SLOW);
    await waitFor(() => expect(linkedReads, "Try again did not read the posting again").toBe(2), SLOW);
    await waitFor(() => expect(text()).toContain(POSTING_TEXT), SLOW);
    expect(note(), "the note stays after the posting opened").toBeNull();
  });

  it("control: an ordinary failure gets the same note, and its Try again asks for no new check", async () => {
    // An ordinary failure is retried once, quietly, before the page hears of it.
    firstLinkedAnswer = SERVER_ERROR;
    failedReads = 2;
    mount();
    await waitFor(() => expect(retry()).not.toBeNull(), SLOW);
    fireEvent.click(retry()!);
    await waitFor(() => expect(text()).toContain(POSTING_TEXT), SLOW);
    expect(freshPass).not.toHaveBeenCalled();
  });

  it("control: an allowance refusal stands page-wide, the board's notice speaks for it, and the link adds no note", async () => {
    firstLinkedAnswer = ADDRESS_REFUSAL;
    mount();
    await waitFor(() => expect(linkedReads).toBe(1), SLOW);
    await waitFor(() => expect(text()).toContain("The job board is paused for this connection"), SLOW);
    expect(boardBudgetRefusal()?.code).toBe("address");
    await settle(300);
    expect(note()).toBeNull();
    expect(text()).not.toContain("Posting no longer available");
  });
});
