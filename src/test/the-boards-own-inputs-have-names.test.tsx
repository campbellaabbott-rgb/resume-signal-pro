// THE BOARD'S OWN INPUTS HAVE NAMES (NB-45, the Jobs.tsx half).
//
// The board's keyword box, its location box (two layouts) and the
// plain-language box were named only by their placeholders. A placeholder is
// not a name: it vanishes as the reader types, and a screen reader announced
// the keyword box as "Title or keyword, e.g. product designer" or as nothing.
// Each now carries the filter bar's own name for the same control, and the
// plain-language box says what it is for.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Nurse ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 2 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [row(0), row(1)], total: 2, totalAllCompanies: 2, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  render(<MemoryRouter><Jobs /></MemoryRouter>);
});

describe("the board's own inputs have names", () => {
  it("the keyword box is named for what it searches, not by its example", async () => {
    await waitFor(() => expect(document.body.textContent).toContain("Nurse 1"), SLOW);
    const box = document.getElementById("board-search");
    expect(box, "positive control: the keyword box is on the page").not.toBeNull();
    expect(box?.getAttribute("aria-label"), "the keyword box was named only by its placeholder").toBe("Search jobs by title or keyword");
  });

  it("every location box carries the name Location, not only a placeholder", async () => {
    await waitFor(() => expect(document.body.textContent).toContain("Nurse 1"), SLOW);
    const boxes = screen.getAllByPlaceholderText("Location");
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b.getAttribute("aria-label"), "a location box was named only by its placeholder").toBe("Location");
  });

  it("the plain-language box says what it is for", async () => {
    await waitFor(() => expect(document.body.textContent).toContain("Nurse 1"), SLOW);
    fireEvent.click(screen.getByRole("button", { name: "Search in plain language" }));
    const box = screen.getByPlaceholderText(/remote product roles/);
    expect(box.getAttribute("aria-label"), "the plain-language box was named only by its example").toBe("Describe the job you want in plain language");
  });
});
