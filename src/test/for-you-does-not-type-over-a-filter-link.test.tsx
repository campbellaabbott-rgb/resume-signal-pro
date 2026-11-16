// FOR YOU DOES NOT TYPE OVER A FILTER LINK (S14X-053).
//
// A dropped résumé searches the board for the occupation it names, by typing
// that title into the search box. That was held back for a typed query and an
// employer page, but not for a filter: a link to /jobs?category=healthcare (a
// field, a band, a country) became a search for the résumé's title, and the
// reader's own narrowing was gone under it. A filter is an intent too: it is
// kept, the filtered page is ranked by fit, and the page says so.
//
// Positive control first: on the bare board the résumé's title is searched.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
const toasts: Array<{ title?: unknown }> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/use-toast", () => ({
  toast: (t: { title?: unknown }) => { toasts.push(t); return { id: "1", dismiss() {}, update() {} }; },
  useToast: () => ({ toast: () => ({}), dismiss() {}, toasts: [] }),
}));
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
const RESUME = "Registered nurse with eight years in acute care and ICU. ".repeat(10);
const row = (i: number) => ({
  id: `greenhouse:mercy:${1000 + i}`, token: "mercy", company: "Mercy", title: `Ward Clerk ${i}`, category: "healthcare",
  location: "Leeds, United Kingdom", country: "GB", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list" && !(o as { body?: Body }).body?.countOnly && !(o as { body?: Body }).body?.facetCounts)
  .map(([, o]) => (o as { body: Body }).body);

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  toasts.length = 0;
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: ["registered nurse"] }, error: null };
    if (fn === "job-fit" && b.action === "fit-batch") {
      const ids = (b.ids as string[]) ?? [];
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, 40])), missing: {}, matched: {} }, error: null };
    }
    if (fn !== "job-board") return { data: null, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [row(0), row(1), row(2)], total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
});

const dropResumeAt = async (url: string) => {
  window.history.replaceState({}, "", url);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull(), SLOW);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([RESUME], "cv.txt", { type: "text/plain" })] } });
  await waitFor(() => expect(invoke.mock.calls.some(([fn, o]) => fn === "job-fit" && (o as { body: Body }).body.action === "fit-batch")).toBe(true), SLOW);
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
};
const searchBox = () => document.getElementById("board-search") as HTMLInputElement;
const titles = () => toasts.map((t) => String(t.title ?? ""));

describe("for you does not type over a filter link", () => {
  it("positive control: on the bare board the résumé's title is searched", async () => {
    await dropResumeAt("/jobs");
    await waitFor(() => expect(searchBox().value).toBe("registered nurse"), SLOW);
  });

  it("a field link keeps its field, gets no typed title, and is ranked by fit, saying so", async () => {
    await dropResumeAt("/jobs?category=healthcare");
    expect(searchBox().value, "the résumé's title was typed over the reader's field").toBe("");
    expect(listBodies().some((b) => b.q === "registered nurse"), "the board was asked for the résumé's title").toBe(false);
    expect(listBodies().at(-1)?.category).toBe("healthcare");
    expect(titles()).toContain("Résumé loaded — your filters are kept, and the openings they match are ranked by fit.");
  });
});
