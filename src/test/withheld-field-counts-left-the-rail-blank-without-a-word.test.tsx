// WITHHELD FIELD COUNTS LEFT THE RAIL BLANK WITHOUT A WORD.
//
// Since .91 the board refuses to count fields for a text search (L13-24): its
// counter matched by substring while the list matches by full-text search, so
// q=rn showed "legal 1,159" over a legal list of 8. It now answers
// `facetSource: "withheld"` with no numbers. The page dropped every number from
// the field chips and said nothing, which reads as a broken rail.
//
// Positive control: counted fields ("filters") print their numbers and no note.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Registered Nurse ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
let facetsAsked = 0;
function mock(facet: Body) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 2 }, error: null };
      if (b.facetCounts) { facetsAsked++; return { data: facet, error: null }; }
      return { data: { jobs: [row(0), row(1)], total: 2, totalAllCompanies: 100, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const NOTE = "No counts beside the fields for a text search";
const text = () => document.body.textContent ?? "";
async function search() {
  window.history.replaceState({}, "", "/jobs?q=rn");
  render(<MemoryRouter initialEntries={["/jobs?q=rn"]}><Jobs /></MemoryRouter>);
  await waitFor(() => expect(text()).toContain("Registered Nurse 1"), SLOW);
  await waitFor(() => expect(facetsAsked).toBeGreaterThan(0), SLOW);
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  facetsAsked = 0;
  clearBoardBudgetRefusal();
});

describe("withheld field counts left the rail blank without a word", () => {
  it("positive control: counted fields print their numbers and no note", async () => {
    mock({ categories: { healthcare: 1234, legal: 8 }, facetSource: "filters" });
    await search();
    await waitFor(() => expect(text()).toContain("1,234"), SLOW);
    expect(text()).not.toContain(NOTE);
  });

  it("a withheld facet is named beside the rail", async () => {
    mock({ categories: {}, facetSource: "withheld" });
    await search();
    await waitFor(() => expect(text()).toContain(NOTE), SLOW);
  });
});
