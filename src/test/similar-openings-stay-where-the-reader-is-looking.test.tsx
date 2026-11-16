// SIMILAR OPENINGS STAY WHERE THE READER IS LOOKING (S11-094).
//
// The pane's "similar openings" asked the board for the posting's title words
// and nothing else: a reader filtering to Germany, remote, was offered
// on-site roles in Texas, with no location on the rows to tell. A title in a
// non-Latin script (or with an accent) was stripped to nothing by an ASCII
// character class, so the lookup was never made. The lookup now carries the
// reader's country, location and work mode, keeps every letter, and each row
// says where it is.
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
const now = new Date().toISOString();
const posting = (id: string, token: string, title: string, location: string) => ({
  id, token, company: token.toUpperCase(), title, location, country: "DE", salary: null, applyUrl: `https://x/${id}`, source: "greenhouse",
  workMode: "remote", postedAt: now, recheckedAt: now,
});
const OPEN = posting("greenhouse:alpha:1", "alpha", "看護師 (正社員)", "Berlin, Germany");
const OTHER = posting("greenhouse:beta:2", "beta", "Krankenpfleger Intensivstation", "Hamburg, Germany");
/** The pane's similar lookup: a list call with limit 12 (the page's own list calls carry an offset). */
const similarCalls = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list" && (o as { body: Body }).body.limit === 12)
  .map(([, o]) => (o as { body: Body }).body);

function mountOpen(qs: string) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") return { data: { job: OPEN, description: "Pflege." }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 1 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      if (b.limit === 12) return { data: { jobs: [OTHER] }, error: null };
      return { data: { jobs: [OPEN], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", `/jobs?${qs}${qs ? "&" : ""}job=${encodeURIComponent(OPEN.id)}`);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});

describe("similar openings stay where the reader is looking", () => {
  it("a title in another script is looked up by its own words", async () => {
    mountOpen("");
    await waitFor(() => expect(similarCalls().length, "the title was stripped to nothing and never looked up").toBeGreaterThan(0), SLOW);
    expect(similarCalls()[0].q).toBe("看護師 正社員");
  });

  it("the lookup carries the reader's country and work mode", async () => {
    mountOpen("country=DE&mode=remote");
    await waitFor(() => expect(similarCalls().length).toBeGreaterThan(0), SLOW);
    expect(similarCalls().at(-1), "similar openings ignored the reader's own filters").toMatchObject({ country: "DE", workMode: "remote" });
  });

  it("each similar row says where it is", async () => {
    mountOpen("");
    await waitFor(() => expect(document.body.textContent).toContain("Krankenpfleger Intensivstation"), SLOW);
    expect(document.body.textContent).toContain("BETA · Hamburg");
  });
});
