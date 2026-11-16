// A PAY FLOOR THE SELECT HAS NO STEP FOR IS SHOWN (S14X-295).
//
// A parsed sentence ("over $135k") or a shared link can set a pay floor, a
// ceiling or a years cap the select has no option for. A <select> whose value
// matches no option shows its first option, so the control read "Any salary"
// while the board filtered on $135k. The value now gets an option of its own,
// named as coming from the search.
//
// Positive control first: a value the steps hold shows its own step.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Analyst ${i}`,
  location: "Austin, Texas, United States", salary: "$140,000 - $160,000", applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list" && !(o as { body?: Body }).body?.countOnly)
  .map(([, o]) => (o as { body: Body }).body);

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [row(0), row(1), row(2)], total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
});

const mount = async (url: string) => {
  window.history.replaceState({}, "", url);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  await waitFor(() => expect(document.body.textContent).toContain("Analyst 2"), SLOW);
};
const shown = (label: string) => {
  const sel = screen.getByRole("combobox", { name: label }) as HTMLSelectElement;
  return sel.options[sel.selectedIndex]?.textContent ?? "";
};

describe("a pay floor the select has no step for is shown", () => {
  it("positive control: a floor the steps hold shows its own step", async () => {
    await mount("/jobs?salaryFloor=150000");
    expect(shown("Minimum stated pay")).toBe("150k+ stated");
  });

  it("a floor between the steps is shown as itself, from the search, while the board filters on it", async () => {
    await mount("/jobs?salaryFloor=135000");
    expect(listBodies().some((b) => b.salaryFloor === 135000), "the board did not filter on the floor").toBe(true);
    expect(shown("Minimum stated pay"), "the control read Any salary while a floor applied").toBe("135k+ stated (from your search)");
  });

  it("the ceiling and the years cap the same way", async () => {
    await mount("/jobs?salaryCeiling=175000&maxYears=4");
    expect(shown("Maximum stated pay")).toBe("up to 175k stated (from your search)");
    expect(shown("Maximum years of experience required")).toBe("Asks 4 yrs or fewer (from your search)");
  });
});
