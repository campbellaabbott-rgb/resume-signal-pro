// A POSTING OPENED BY ITS LINK GETS A SCORE, OR SAYS WHY NOT (sweep MATCH-01).
//
// WHAT WAS WRONG. The fit scorer was asked only for the postings in the loaded
// list. A posting opened by its link (the View button of a fit-alert mail, a
// shared /jobs?job=<id>) is the open posting and is in no loaded page, so its
// id was in no batch: with ranking on, its panel said "Scoring this posting
// against your resume…" for as long as it stayed open. And an id the scorer
// holds no row for is in neither of its answers, so even when asked it stayed
// unanswered, was asked for again on every run and went on spinning.
//
// WHAT HOLDS NOW, on the board mounted at /jobs?job=<an id the list does not
// hold>, with a résumé this tab already has:
//   - the open posting's id is in a fit request;
//   - when the scorer answers it, the panel prints the score;
//   - when the scorer leaves it out, the panel says it is not scored (reason
//     not_found), the spinner is gone, and the id is not asked for again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
const LINKED = "greenhouse:acme:9001";
const RESUME = "Registered nurse with eight years of acute care experience in a level one trauma centre. ".repeat(3);
const row = (id: string, title: string) => ({
  id, token: "acme", company: "Acme", title, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${encodeURIComponent(id)}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const LISTED = [row("greenhouse:acme:1", "Staff Nurse"), row("greenhouse:acme:2", "Charge Nurse"), row("greenhouse:acme:3", "Nurse Educator")];

let fitBatches: string[][] = [];
/** What the scorer answers for the linked posting: a number, or "omit" to leave it out of both maps. */
let linkedAnswer: number | "omit" = 73;

function mount() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: [] }, error: null };
    if (fn === "job-fit" && b.action === "fit-batch") {
      const ids = (b.ids as string[]) ?? [];
      fitBatches.push(ids);
      const fits: Record<string, number | null> = {};
      for (const id of ids) {
        if (id === LINKED) { if (linkedAnswer !== "omit") fits[id] = linkedAnswer; } else fits[id] = 40;
      }
      return { data: { fits, unscored: {}, missing: {}, matched: {} }, error: null };
    }
    if (fn !== "job-board") return { data: null, error: null };
    if (b.action === "detail") {
      return b.id === LINKED
        ? { data: { job: row(LINKED, "Emergency Department Nurse"), description: "Triage and treat patients in a busy emergency department." }, error: null }
        : { data: { description: "A posting in the list." }, error: null };
    }
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: LISTED, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", `/jobs?job=${encodeURIComponent(LINKED)}`);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
const SPINNER = "Scoring this posting against your resume…";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  // A résumé this tab already holds: the board ranks by fit as it opens.
  sessionStorage.setItem("rb_board_resume", RESUME);
  fitBatches = [];
  linkedAnswer = 73;
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("a posting opened by its link, with fit ranking on", () => {
  it("is sent to the scorer and prints its score", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Triage and treat patients"), SLOW);
    await waitFor(() => expect(fitBatches.flat(), "the open posting was never sent to the scorer").toContain(LINKED), SLOW);
    await waitFor(() => expect(text()).toContain("Your keyword fit: 73%"), SLOW);
    expect(text()).not.toContain(SPINNER);
  });

  it("says it is not scored when the scorer leaves it out, and is not asked for again", async () => {
    linkedAnswer = "omit";
    mount();
    await waitFor(() => expect(text()).toContain("Triage and treat patients"), SLOW);
    await waitFor(() => expect(fitBatches.flat()).toContain(LINKED), SLOW);
    await waitFor(() => expect(document.querySelector('[data-unscored="not_found"]'), "the panel never said why there is no score").not.toBeNull(), SLOW);
    expect(text(), "the panel still spins on a score that is not coming").not.toContain(SPINNER);
    // Nothing more is asked for an answered id, however long the panel stays open.
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(fitBatches.flat().filter((id) => id === LINKED)).toHaveLength(1);
  });

  it("control: the listed postings are scored once each, beside it", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Your keyword fit: 73%"), SLOW);
    const sent = fitBatches.flat();
    for (const j of LISTED) expect(sent.filter((id) => id === j.id), j.id).toHaveLength(1);
  });
});
