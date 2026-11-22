// SAVING A POSTING STORES THE FIT OF THE RÉSUMÉ THE BOARD RANKED WITH
// (sweep MATCH-11, the board's save path).
//
// WHAT WAS WRONG. Saving a posting from the board writes a tracker row and
// then scores it (application-fit), so the tracker can say "Strong match".
// That score was taken against the reader's LATEST SCAN whatever the board was
// ranking with: a résumé dropped on the board, or the one pinned for matching,
// put one fit on the card and another, for a different document, on the row
// the reader then worked from.
//
// WHAT HOLDS NOW, on the board mounted signed in, ranking by a résumé dropped
// on it, with a different latest scan on the account:
//   - the save scores the posting against the dropped résumé, the one the
//     card's badge was scored with, and stores that fit on the row;
//   - control: with nothing dropped, pinned or stashed, the latest scan is
//     still what is scored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

type Call = { table: string; op: string; args: unknown[]; filters: Array<[string, unknown]> };
const invoke = vi.fn();
const calls: Call[] = [];

const DROPPED = "Registered nurse with ten years in intensive care, ventilator management, triage, patient assessment and electronic health records across three hospital systems.";
const LATEST = "Backend engineer who builds payment systems in Go and PostgreSQL, runs Kubernetes clusters on AWS and designs event-driven services with Kafka.";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
const AUTH = { user: { id: "u1" }, session: { user: { id: "u1" }, access_token: "t" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
function stubTable(table: string) {
  const c: Call = { table, op: "select", args: [], filters: [] };
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "not", "in", "gte", "lte", "is"]) th[k] = () => th;
  for (const op of ["insert", "update", "upsert", "delete"]) th[op] = (...args: unknown[]) => { c.op = op; c.args = args; calls.push(c); return th; };
  th.eq = (col: string, v: unknown) => { c.filters.push([col, v]); return th; };
  // The account's latest scan is a different résumé from the one on the board.
  const rows = () => (table === "user_scans" ? [{ id: "scan-latest", ats_score: 71, resume_text: LATEST }] : []);
  th.limit = async () => ({ data: rows(), error: null });
  th.maybeSingle = async () => ({ data: null, error: null });
  th.single = async () => ({ data: null, error: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) => Promise.resolve({ data: c.op === "select" ? rows() : null, error: null }).then(ok, bad);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const row = (n: number) => ({
  id: `greenhouse:acme:${n}`, token: "acme", company: "Acme Health", title: `Nurse ${n}`, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${n}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const ROWS = [row(1), row(2)];

function mount() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit") {
      const ids = (b.ids as string[] | undefined) ?? [];
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, 64])) }, error: null };
    }
    if (fn === "application-fit") return { data: { success: true, data: { pct: 64, missing: ["telemetry"] } }, error: null };
    if (fn !== "job-board") return { data: null, error: null };
    if (b.action === "detail") return { data: { description: `Acme Health is hiring a nurse for posting ${String(b.id)}: intensive care, triage, patient assessment.` }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 2 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: ROWS, total: 2, totalAllCompanies: 2, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const fitCalls = () => invoke.mock.calls.filter(([fn]) => fn === "application-fit").map(([, o]) => (o as { body: Body }).body);
const boardScoredWith = () => invoke.mock.calls.filter(([fn]) => fn === "job-fit").map(([, o]) => (o as { body: Body }).body.resumeText);

async function saveTheFirst() {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /^Save Nurse 1/ }, SLOW));
  await waitFor(() => expect(fitCalls().length, "the save never scored the posting").toBeGreaterThan(0), SLOW);
}

beforeEach(() => {
  calls.length = 0;
  invoke.mockReset();
  clearBoardBudgetRefusal();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe("a posting saved from a board ranked by a dropped résumé", () => {
  it("is scored against the dropped résumé, the one its badge was scored with", async () => {
    sessionStorage.setItem("rb_board_resume", DROPPED);
    await saveTheFirst();
    // The board itself ranked with the dropped résumé.
    await waitFor(() => expect(boardScoredWith()).toContain(DROPPED), SLOW);
    expect(fitCalls()[0].resumeText, "the tracker's fit was taken against the latest scan, not the résumé the board ranked with").toBe(DROPPED);
    const stored = calls.find((c) => c.table === "user_applications" && c.op === "update" && (c.args[0] as Record<string, unknown>)?.fit_pct !== undefined);
    expect(stored?.args[0]).toMatchObject({ fit_pct: 64 });
  });
});

describe("control: nothing dropped, pinned or stashed", () => {
  it("the latest scan is what is scored", async () => {
    await saveTheFirst();
    expect(fitCalls()[0].resumeText).toBe(LATEST);
  });
});
