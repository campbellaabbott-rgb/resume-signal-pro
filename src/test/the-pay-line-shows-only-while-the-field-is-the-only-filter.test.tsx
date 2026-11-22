// THE PAY LINE SHOWS ONLY WHILE THE FIELD IS THE ONLY FILTER (sweep BOARD-01).
//
// WHAT WAS WRONG. Under the results header the board prints "Advertised pay in
// this field: median floor $…", one median per field across the WHOLE board.
// It was shown whenever a field was chosen, whatever else was. Choose
// Engineering and then London, or a search, or an employer, and the line went
// on printing the whole board's US-dollar figure for engineering over a page
// of London roles: a number about a different set of postings, presented as
// this page's.
//
// WHAT HOLDS NOW, on the mounted board: the line prints while the field is the
// only thing narrowing the board, and leaves under any other filter.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async (fn: string) => rpcAnswer(fn),
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
/** get_category_salary_benchmarks: one row per field, across the whole board. */
let rpcAnswer: (fn: string) => unknown = () => ({ data: [], error: null });

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const row = (n: number) => ({
  id: `greenhouse:acme:${n}`, token: "acme", company: `Employer ${n}`, title: `Engineer ${n}`, location: "Austin, TX, USA", country: "US",
  category: "engineering", salary: null, applyUrl: `https://x/${n}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const ROWS = [row(1), row(2), row(3)];

function mount(path: string) {
  rpcAnswer = () => ({ data: [{ category: "engineering", n: 4120, median_annual_min: 131000, currency: "USD" }], error: null });
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: { engineering: 3 } }, error: null };
      return { data: { jobs: ROWS, total: 3, totalAllCompanies: 900, companies: [], companiesCount: 0, categories: { engineering: 3 }, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: { engineering: 3 }, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", path);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
const PAY_LINE = "Advertised pay in this field";
/** The list has rendered and the benchmark read has had time to land. */
async function settled() {
  await waitFor(() => expect(text()).toContain("Engineer 1"), SLOW);
  await new Promise((r) => setTimeout(r, 400));
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("the field's advertised-pay line", () => {
  it("control: prints while the field is the only filter", async () => {
    mount("/jobs?category=engineering");
    await waitFor(() => expect(text()).toContain(PAY_LINE), SLOW);
    expect(text()).toContain("131,000");
    expect(text()).toContain("4120 postings");
  });

  it.each([
    ["a place", "/jobs?category=engineering&location=London"],
    ["a country", "/jobs?category=engineering&country=GB"],
    ["a search", "/jobs?category=engineering&q=platform"],
    ["an employer", "/jobs?category=engineering&company=acme"],
    ["a pay floor", "/jobs?category=engineering&salaryFloor=90000"],
  ])("leaves under %s, where the whole board's figure does not describe the page", async (_what, path) => {
    mount(path);
    await settled();
    expect(text(), "the whole board's figure was printed over a narrowed page").not.toContain(PAY_LINE);
  });
});
