// A "POSTING IS GONE" REPORT SAYS WHAT FAILED, AND "LOGGED" ONLY WHAT WAS.
//
// The report re-checks the posting against the employer's feed. Two wirings
// put false sentences in the toast:
//   - verifyJob returned null both for a genuine live:null (the employer's
//     feed pages short of its total) AND for our own failed verify call
//     (network, 5xx, budget refusal), so a failed check printed
//     "{{company}}'s feed lists more roles than it lets us read in one pass"
//     -- blaming a named employer's feed for our outage;
//   - the report POST was awaited but its {error} discarded (invoke resolves
//     on an HTTP error rather than throwing), so "Your report is logged"
//     followed a report that never landed.
// The positive control is the genuine page-capped answer, which keeps its
// feed sentence because there it is true.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { Toaster } from "@/components/ui/toaster";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const ROW = {
  id: "workday:acme~wd3~Careers:JR1", token: "acme~wd3~Careers", company: "Acme", title: "Staff Nurse",
  location: "Leeds, United Kingdom", salary: null, applyUrl: "https://x/1", source: "workday",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 600_000).toISOString(),
};
const httpError = (status: number) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify({ error: "x" }), { status, headers: { "Content-Type": "application/json" } }) },
});
function mock(opts: { verify: () => unknown; report: () => unknown }) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "verify") return opts.verify();
    if (b.action === "report") return opts.report();
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 1 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [ROW], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    return { data: null, error: null };
  });
}
async function reportGone() {
  window.history.replaceState({}, "", "/jobs");
  render(<MemoryRouter><Jobs /><Toaster /></MemoryRouter>);
  await waitFor(() => expect(document.body.textContent).toContain("Staff Nurse"), SLOW);
  fireEvent.click(screen.getAllByRole("button", { name: "Report this posting" })[0]);
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Posting is gone" })[0]); });
}
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});

describe("a gone report says what failed, and 'logged' only what was", () => {
  it("positive control: a page-capped feed keeps its feed sentence, and the report is logged", async () => {
    mock({ verify: () => ({ data: { live: { [ROW.id]: null } }, error: null }), report: () => ({ data: { ok: true }, error: null }) });
    await reportGone();
    await waitFor(() => expect(text()).toMatch(/feed lists more roles than it lets us read/), SLOW);
    expect(text()).toMatch(/Your report is logged/);
  });

  it("our own failed check blames nobody's feed", async () => {
    mock({ verify: () => httpError(503), report: () => ({ data: { ok: true }, error: null }) });
    await reportGone();
    await waitFor(() => expect(text()).toMatch(/couldn't check it just now/), SLOW);
    expect(text(), "our failure was published as the employer's feed size").not.toMatch(/feed lists more roles/);
    expect(text()).toMatch(/Your report is logged/);
  });

  it("a report that never landed is not called logged", async () => {
    mock({ verify: () => ({ data: { live: { [ROW.id]: null } }, error: null }), report: () => httpError(500) });
    await reportGone();
    await waitFor(() => expect(text()).toMatch(/did not reach us/), SLOW);
    expect(text(), "a failed report was confirmed as logged").not.toMatch(/Your report is logged/);
  });
});
