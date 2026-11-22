// AN EMPLOYER OPTION PRINTS A COUNT ONLY ON AN OTHERWISE UNFILTERED BOARD (sweep BOARD-04).
//
// WHAT WAS WRONG. The employer typeahead prints each employer's open roles
// beside its name, "Acme (900)". That number is the employer's roles on the
// whole board. With a field, a place or a search already narrowing the board,
// choosing the option produces far fewer, so the number was a promise the
// click did not keep: the same board-wide figure under a narrowed page that
// the country picker stopped printing long ago.
//
// WHAT HOLDS NOW, on the mounted board with the typeahead open:
//   - with nothing else narrowing the board the options carry their counts,
//     and they still do when other employers are the only thing chosen;
//   - under a country, a field or a search the names stay and the numbers go.
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
let rpcAnswer: (fn: string) => unknown = () => ({ data: [], error: null });

import Jobs, * as JobsModule from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const HEAD = [
  { token: "dominos", name: "Domino's", open: 21531 },
  { token: "chilis", name: "Chili's", open: 1094 },
  { token: "acme", name: "Acme", open: 900 },
];
const row = (n: number) => ({
  id: `workday:acme:${n}`, token: "acme", company: "Acme", title: `Analyst ${n}`, location: "Vienna, Austria", country: "AT",
  salary: null, applyUrl: `https://x/${n}`, source: "workday",
  postedAt: new Date(Date.now() - 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});

function mount(path: string) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "company-suggest") return { data: { companies: [] }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 2 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [row(1), row(2)], total: 2, totalAllCompanies: 50, companies: HEAD, companiesCount: 3, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", path);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

/** The typeahead's own options, as printed. */
async function options(path: string): Promise<string[]> {
  mount(path);
  await waitFor(() => expect(document.body.textContent).toContain("Analyst 1"), SLOW);
  fireEvent.focus(screen.getByLabelText("Employer"));
  const read = () => Array.from(document.querySelectorAll('#company-typeahead-list [role="option"]')).map((o) => (o.textContent ?? "").replace("✓", "").trim());
  await waitFor(() => expect(read().join("|")).toContain("Domino's"), SLOW);
  return read();
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("the employer typeahead's counts", () => {
  it("control: print on a board nothing else narrows", async () => {
    // The typeahead orders its options itself; what is pinned is that each carries its count.
    expect((await options("/jobs")).slice().sort()).toEqual(["Acme (900)", "Chili's (1094)", "Domino's (21531)"]);
  });

  it("control: still print when employers are the only thing chosen", async () => {
    expect(await options("/jobs?company=acme")).toEqual(expect.arrayContaining(["Domino's (21531)", "Chili's (1094)"]));
  });

  it.each([
    ["a country", "/jobs?country=AT"],
    ["a field", "/jobs?category=finance"],
    ["a search", "/jobs?q=analyst"],
    ["an employer and a place", "/jobs?company=acme&location=Vienna"],
  ])("leave under %s: the names stay, the board-wide numbers go", async (_what, path) => {
    const shown = await options(path);
    expect(shown).toEqual(expect.arrayContaining(["Domino's", "Chili's"]));
    expect(shown.join("|"), "a whole-board count was printed beside a name on a narrowed board").not.toMatch(/\(\d/);
  });

  it("the rule is read off the request, not a list of filters: only the employer scope may be bound", () => {
    const stillTrue = (JobsModule as unknown as { companyCountsStillTrue: (body: Record<string, unknown>) => boolean }).companyCountsStillTrue;
    expect(stillTrue({})).toBe(true);
    expect(stillTrue({ companies: ["acme"] })).toBe(true);
    expect(stillTrue({ companies: ["acme"], maxAgeDays: 7 })).toBe(false);
    expect(stillTrue({ excludeAgencies: true })).toBe(false);
  });
});
