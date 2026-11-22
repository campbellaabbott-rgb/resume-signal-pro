// A POSTING ALREADY BEING SCORED IS NOT SENT AGAIN (sweep MATCH-M1).
//
// WHAT WAS WRONG. The scoring effect re-runs whenever the list changes, and it
// asked for every posting "not in fits". While a batch was still on its way,
// its ids were not in fits yet, so a Load more in that window sent the whole
// first page a second time, against an allowance counted per hour. And each
// run switched the spinner off when it finished, so the first run to return
// put it out while another was still waiting.
//
// WHAT HOLDS NOW, on the mounted board with the first batch held open:
//   - a Load more asks only for the new page's postings;
//   - the "For you" spinner stays until every batch has returned.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const RESUME = "Registered nurse with eight years of acute care experience in a level one trauma centre. ".repeat(3);
const row = (n: number) => ({
  id: `greenhouse:acme:${n}`, token: "acme", company: `Employer ${n}`, title: `Nurse ${n}`, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${n}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const PAGE_ONE = [row(1), row(2), row(3)];
const PAGE_TWO = [row(4), row(5), row(6)];

let fitBatches: string[][] = [];
/** Each fit request waits here until the test lets it answer. */
let gates: Array<() => void> = [];

function mount() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: [] }, error: null };
    if (fn === "job-fit" && b.action === "fit-batch") {
      const ids = (b.ids as string[]) ?? [];
      fitBatches.push(ids);
      await new Promise<void>((release) => { gates.push(release); });
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, 55])), unscored: {}, missing: {}, matched: {} }, error: null };
    }
    if (fn !== "job-board") return { data: null, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 6 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const second = Number(b.offset) > 0;
      return { data: { jobs: second ? PAGE_TWO : PAGE_ONE, total: 6, totalAllCompanies: 6, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: !second }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const forYou = () => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "For you") ?? null;
const spinning = () => !!forYou()?.querySelector(".animate-spin");

/** The first page is in flight; a second page is loaded behind it. */
async function loadMoreDuringTheFirstBatch() {
  mount();
  await waitFor(() => expect(fitBatches, "the first page was never sent to the scorer").toHaveLength(1), SLOW);
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }, SLOW));
  await waitFor(() => expect(document.body.textContent).toContain("Nurse 6"), SLOW);
  await waitFor(() => expect(fitBatches.length, "the second page was never sent to the scorer").toBeGreaterThan(1), SLOW);
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  sessionStorage.setItem("rb_board_resume", RESUME);
  fitBatches = [];
  gates = [];
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(() => { for (const release of gates) release(); cleanup(); });

describe("a Load more while the first batch is still being scored", () => {
  it("asks only for the new page's postings", async () => {
    await loadMoreDuringTheFirstBatch();
    expect(fitBatches[0]).toEqual(PAGE_ONE.map((j) => j.id));
    const sent = fitBatches.flat();
    const twice = sent.filter((id, i) => sent.indexOf(id) !== i);
    expect(twice, "postings already being scored were sent again").toEqual([]);
    expect(fitBatches[1]).toEqual(PAGE_TWO.map((j) => j.id));
  });

  it("keeps the spinner until every batch has returned", async () => {
    await loadMoreDuringTheFirstBatch();
    expect(spinning(), "no spinner while two batches are out").toBe(true);
    // The second batch answers first; the first is still out.
    gates[1]();
    await waitFor(() => expect(document.querySelectorAll('[title^="Keyword fit score "]').length, "the second batch's scores never landed").toBeGreaterThan(0), SLOW);
    expect(spinning(), "the spinner stopped while the first batch was still out").toBe(true);
    gates[0]();
    await waitFor(() => expect(spinning()).toBe(false), SLOW);
    expect(document.querySelectorAll('[title^="Keyword fit score "]').length).toBe(6);
  });
});
