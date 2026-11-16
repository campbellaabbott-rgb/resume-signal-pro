// TWO DIFFERENT SAVED SEARCHES ARE NEVER ONE NAME (NB-4, NB-25).
//
// user_job_searches is UNIQUE(user_id, name), and a search's name is built
// from its filters. The name left out the unsorted widening, the employers
// beyond the first, and the pay floor and ceiling, so two different searches
// got one name, and saving the second answered "already saved" (or switched
// on the first one's alert) while saving nothing. The name now carries every
// one of those; and when a name is taken by a DIFFERENT search anyway, the
// new one is saved as "<name> (2)" instead of being refused.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { searchName } from "@/lib/job-search-params";

const invoke = vi.fn();
const inserted: Array<{ name: string; params: unknown }> = [];
let held: unknown = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { user: { id: "u1" }, access_token: "t" } }) }));
function stubTable(table: string) {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "in", "gte", "lte", "is", "upsert", "delete"]) th[k] = self;
  // The search the reader saved before holds the plain name; any other is free.
  th.insert = (row: { name: string; params: unknown }) => {
    if (table === "user_job_searches") inserted.push({ name: row.name, params: row.params });
    const taken = table === "user_job_searches" && !/\(\d\)$/.test(row.name);
    return { then: (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: taken ? { code: "23505", message: "duplicate key value" } : null }).then(ok) };
  };
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: table === "user_job_searches" && held ? { params: held } : null, error: null });
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

describe("the name carries what tells two searches apart (NB-25)", () => {
  it("the unsorted widening, the other employers and the pay band each change the name", () => {
    const base = { q: "nurse", category: "healthcare" };
    expect(searchName({ ...base, includeUncategorised: true })).not.toBe(searchName(base));
    expect(searchName({ company: "acme", companies: ["acme", "beta"] })).not.toBe(searchName({ company: "acme" }));
    expect(searchName({ company: "acme", companies: ["acme", "beta", "gamma"] })).toContain("acme +2 more");
    expect(searchName({ ...base, salaryFloor: 135_000 })).toContain("$135k+");
    expect(searchName({ ...base, salaryFloor: 135_000 })).not.toBe(searchName({ ...base, salaryFloor: 120_000 }));
    expect(searchName({ ...base, salaryCeiling: 175_000 })).toContain("≤$175k");
  });
});

describe("a taken name held by a different search saves the new one beside it (NB-4)", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    inserted.length = 0;
    held = null;
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

  const saveAt = async (url: string) => {
    window.history.replaceState({}, "", url);
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Save this search" }, SLOW));
    await waitFor(() => expect(inserted.length).toBeGreaterThan(0), SLOW);
    await new Promise((r) => setTimeout(r, 150));
  };

  it("the same search saved again is not saved twice", async () => {
    held = { q: "nurse" };
    await saveAt("/jobs?q=nurse");
    expect(inserted.map((i) => i.name)).toEqual(["nurse"]);
  });

  it("a different search under the same name is saved as its own, numbered", async () => {
    held = { q: "nurse", country: "GB" };
    await saveAt("/jobs?q=nurse");
    expect(inserted.map((i) => i.name), "the second search was refused as a duplicate of a different one").toEqual(["nurse", "nurse (2)"]);
    expect(inserted[1].params).toMatchObject({ q: "nurse" });
  });

  it("control: a held row that cannot be read keeps the old answer", async () => {
    held = null;
    await saveAt("/jobs?q=nurse");
    expect(inserted.map((i) => i.name)).toEqual(["nurse"]);
  });
});
