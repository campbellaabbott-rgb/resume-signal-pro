/**
 * LOAD MORE APPENDS BELOW, AND NEVER RESHUFFLES THE CARDS ABOVE (sweep
 * S10-008).
 *
 * On the default /jobs board and a field page the client weaves employers
 * round-robin. It wove the WHOLE appended list on every Load more: each
 * employer first seen on the new page got a slot in the early rounds near the
 * top, so most of the new postings landed above where the reader was, and the
 * cards they were reading dropped far down (the register measured 53 of 60
 * new cards landing above, and card #60 moving to #113). Each page is now
 * woven on its own and appended, so a card keeps its place once it is drawn.
 *
 * Behavioural, with the board mocked: page one is three employers in date
 * blocks, page two brings two new employers and more of the first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const row = (token: string, n: number, h: number) => ({
  id: `greenhouse:${token}:${n}`, source: "greenhouse", token, company: token.toUpperCase(), title: `${token} role ${n}`,
  location: "Leeds, UK", country: "GB", salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: null, employmentType: null, experienceBand: null, minYears: null, category: "engineering", department: null,
  postedAt: ago(h), lastSeen: ago(0), recheckedAt: ago(0), applyUrl: `https://apply.example/${token}/${n}`, remote: false,
});
// Page one: date blocks of one employer each (the shape the weave exists for).
const PAGE1 = [row("aa", 1, 1), row("aa", 2, 1), row("aa", 3, 1), row("bb", 1, 2), row("bb", 2, 2), row("cc", 1, 3)];
// Page two: two employers new to the list, and more of the first.
const PAGE2 = [row("dd", 1, 4), row("dd", 2, 4), row("ee", 1, 5), row("aa", 4, 6), row("aa", 5, 6), row("bb", 3, 7)];

beforeEach(() => {
  window.history.replaceState({}, "", "/jobs");
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board" || b.action !== "list") return { data: {} };
    if (b.facetCounts) return { data: { categories: {} } };
    if (b.countOnly) return { data: { total: 12 } };
    const offset = Number(b.offset ?? 0);
    const jobs = offset === 0 ? PAGE1 : offset === 6 ? PAGE2 : [];
    return { data: { jobs, total: 12, totalAllCompanies: 12, companies: [], companiesCount: 5, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: offset === 0, nextOffset: offset + 6 } };
  });
});

const order = () => Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]")).map((c) => c.getAttribute("data-job-id"));

describe("load more on the woven default board", () => {
  it("keeps every card already drawn where it was, and puts the new page below them", async () => {
    render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
    await waitFor(() => expect(order().length).toBe(6), SLOW);
    const before = order();
    // The first page IS woven: three employers lead it, not one employer's block.
    expect(new Set(before.slice(0, 3).map((id) => id!.split(":")[1]))).toEqual(new Set(["aa", "bb", "cc"]));
    fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
    await waitFor(() => expect(order().length).toBe(12), SLOW);
    const after = order();
    expect(after.slice(0, 6), "Load more moved cards the reader had already seen").toEqual(before);
    expect(new Set(after.slice(6)), "the new page's postings belong below the old ones").toEqual(new Set(PAGE2.map((r) => r.id)));
    // And the new page is woven within itself.
    expect(new Set(after.slice(6, 9).map((id) => id!.split(":")[1]))).toEqual(new Set(["dd", "ee", "aa"]));
  });
});
