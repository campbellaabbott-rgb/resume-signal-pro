// A LIFTED PHRASE WAS NAMED AND COULD NOT BE UNDONE.
//
// The board reads "remote", "part time", "entry level" typed into the search
// box as filters, removes them from the text search and names them in
// `intentFilters`. Its own rationale for doing that is the disclosure: "a
// searcher who did mean the title text can see what happened and say
// otherwise". The page printed the sentence and offered no way to say
// otherwise. Since .91 the server takes `noIntent: true` to search every word
// as text (L8-06); the page never sent it.
//
// And the field-count probe beside the list must ask about the same reading
// of the words, or its numbers describe the lifted search under the unlifted
// list.
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
const row = (i: number, title: string) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const lists: Body[] = [];
const facets: Body[] = [];
function mock() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 2 }, error: null };
      if (b.facetCounts) { facets.push(b); return { data: { categories: { healthcare: 2 }, facetSource: "filters" }, error: null }; }
      lists.push(b);
      // The server's two readings of "remote nurse".
      const jobs = b.noIntent === true
        ? [row(0, "Remote Patient Monitoring Nurse"), row(1, "Remote Nurse Educator")]
        : [row(2, "Nurse (remote)"), row(3, "Telehealth Nurse")];
      return {
        data: {
          jobs, total: 2, totalAllCompanies: 100, companies: [], companiesCount: 0, categories: {},
          failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
          ...(b.noIntent === true ? {} : { intentFilters: ["remote"] }),
        },
        error: null,
      };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  lists.length = 0;
  facets.length = 0;
  clearBoardBudgetRefusal();
  mock();
});

describe("a lifted phrase was named and could not be undone", () => {
  it("the disclosure carries its undo, which re-sends the same words with noIntent, and the undo is itself undoable", async () => {
    window.history.replaceState({}, "", "/jobs?q=remote%20nurse");
    render(<MemoryRouter initialEntries={["/jobs?q=remote%20nurse"]}><Jobs /></MemoryRouter>);
    await waitFor(() => expect(text()).toContain("Telehealth Nurse"), SLOW);
    expect(text()).toMatch(/Read “remote” as a filter and applied it/);
    // Positive control: the first request let the board read the words.
    expect(lists[0].noIntent).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Search those words as text instead" }));
    await waitFor(() => expect(lists.some((b) => b.noIntent === true && b.q === "remote nurse")).toBe(true), SLOW);
    await waitFor(() => expect(text()).toContain("Remote Nurse Educator"), SLOW);
    expect(text()).toContain("Searched for “remote” as words, not as a filter.");
    expect(text(), "the lift sentence outlived the undo").not.toMatch(/Read “remote” as a filter and applied it/);
    // The field counts beside the list read the words the same way.
    await waitFor(() => expect(facets.some((b) => b.noIntent === true)).toBe(true), SLOW);

    const before = lists.length;
    fireEvent.click(screen.getByRole("button", { name: "Apply them as filters again" }));
    await waitFor(() => expect(lists.length).toBeGreaterThan(before), SLOW);
    expect(lists[lists.length - 1].noIntent).toBeUndefined();
    await waitFor(() => expect(text()).toContain("Telehealth Nurse"), SLOW);
  });
});
