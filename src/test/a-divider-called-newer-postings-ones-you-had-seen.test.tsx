// A DIVIDER CALLED NEWER POSTINGS ONES YOU HAD SEEN (S8-028).
//
// "posted before your last visit" is placed by position: the first card dated
// at or before the last visit, and everything under it reads as old. It ran
// whenever the sort was "newest", which is also true of the employer-woven
// default browse and of a search shown in relevance order, and it read an
// undated posting as epoch 0. On the default browse the divider landed two
// cards in, with 57 of the 58 cards below it newer than a 24-hour last visit.
//
// Positive control: a search the reader asked to see newest first is a real
// date order, and the divider still marks it.
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

const HOUR = 3_600_000;
const at = (h: number | null) => (h === null ? null : new Date(Date.now() - h * HOUR).toISOString());
const row = (token: string, title: string, hoursAgo: number | null) => ({
  id: `greenhouse:${token}:${title.length}`, source: "greenhouse", token, company: token.toUpperCase(), title,
  location: "Austin, TX", country: "US", salary: null, category: "engineering",
  postedAt: at(hoursAgo), lastSeen: at(1), recheckedAt: at(1), applyUrl: `https://x/${token}`, remote: false,
});
const DIVIDER = "posted before your last visit";
function mount(url: string, jobs: unknown[]) {
  // The last visit was a day ago.
  localStorage.setItem("rb_board_last_visit", String(Date.now() - 24 * HOUR));
  window.history.replaceState({}, "", url);
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      if (b.countOnly) return { data: { total: jobs.length }, error: null };
      return { data: { jobs, total: jobs.length, totalAllCompanies: 100, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    return { data: {}, error: null };
  });
  return render(<MemoryRouter initialEntries={[url]}><Jobs /></MemoryRouter>);
}
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});

describe("a divider called newer postings ones you had seen", () => {
  it("positive control: a search sorted newest first is marked where the older postings begin", async () => {
    mount("/jobs?q=engineer&sort=newest", [row("acme", "Engineer One", 2), row("beta", "Engineer Two", 5), row("gamma", "Engineer Three", 72)]);
    await waitFor(() => expect(text()).toContain("Engineer Three"), SLOW);
    await waitFor(() => expect(text()).toContain(DIVIDER), SLOW);
  });

  it("the woven default browse, with an undated posting second, carries no divider", async () => {
    mount("/jobs", [row("acme", "Fresh A", 2), row("beta", "Undated B", null), row("acme", "Fresh A2", 3), row("gamma", "Fresh C", 4)]);
    await waitFor(() => expect(text()).toContain("Fresh C"), SLOW);
    expect(text(), "the divider told a returning visitor that today's postings were old").not.toContain(DIVIDER);
  });

  it("a search in relevance order carries no divider", async () => {
    mount("/jobs?q=engineer", [row("acme", "Engineer Fresh", 2), row("beta", "Engineer Old", 72), row("gamma", "Engineer Newer", 3)]);
    await waitFor(() => expect(text()).toContain("Engineer Newer"), SLOW);
    expect(text()).not.toContain(DIVIDER);
  });
});
