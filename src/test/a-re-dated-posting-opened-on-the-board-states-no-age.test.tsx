// A RE-DATED POSTING OPENED ON THE BOARD STATES NO AGE (NB-22, the pane's half).
//
// Breezy, Paylocity and UKG rewrite a posting's feed date when it is edited,
// so the card prints no age for them (src/lib/listing/age.ts). The detail
// pane read the raw feed date instead, and the same posting the card would
// not date was "posted 2d ago, by the employer's own date" in the pane. The
// pane reads the card's rule now (listingAge). Mail's half (the digest's
// local-date rule in age.ts) is the mail lane's.
//
// Positive control first: the same row from a system that keeps its dates.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
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
const row = (source: string) => ({
  id: `${source}:acme:R1`, token: "acme", company: "Acme", title: "Warehouse Associate", location: "Reno, NV, USA", country: "US",
  salary: null, applyUrl: "https://x/1", source,
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});

function mountOpen(source: string) {
  const r = row(source);
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") return { data: { job: r, description: "Pick and pack orders." }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 1 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [r], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", `/jobs?job=${encodeURIComponent(r.id)}`);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});

describe("a re-dated posting opened on the board states no age", () => {
  it("positive control: a greenhouse posting's pane states its age by the employer's date", async () => {
    mountOpen("greenhouse");
    await waitFor(() => expect(document.body.textContent).toContain("posted 2d ago, by the employer's own date"), SLOW);
  });

  it("a breezy posting's pane states none", async () => {
    mountOpen("breezy");
    await waitFor(() => expect(document.body.textContent).toContain("Pick and pack orders."), SLOW);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(document.body.textContent, "the pane dated a posting the card will not").not.toContain("posted 2d ago, by the employer's own date");
  });
});
