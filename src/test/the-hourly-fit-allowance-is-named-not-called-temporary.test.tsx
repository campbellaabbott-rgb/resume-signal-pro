// THE HOURLY FIT ALLOWANCE IS NAMED, NOT CALLED TEMPORARY (S14X-294, S14X-053's
// held rows).
//
// job-fit refuses a reader past its allowance with 429 and says which:
// {error: "rate_limited", limit, window: "1h" | "24h"}. The board and the
// report's matches card read every failure as a blip: "N postings could not
// be scored just now — this is usually temporary", with a Try again that is
// refused again inside the window, while the loop went on asking for every
// later batch. Now the allowance is named with its number and window, the
// loop stops asking, Try again is not offered inside the window, and a
// posting opened meanwhile says it was not scored because of the allowance.
//
// Positive control first: an ordinary failure keeps its retry.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
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
import { LiveMatches } from "@/components/LiveMatches";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const RESUME = "registered nurse ".repeat(20);
const LIMIT_BODY = { error: "rate_limited", message: "Too many fit checks from this address", limit: 60, window: "1h", scope: "address", rateLimited: true };
/** supabase-js's shape for a non-2xx: the Response rides on error.context. */
const refused = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status }) },
});
const ROWS = Array.from({ length: 25 }, (_, i) => ({
  id: `greenhouse:mercy:${1000 + i}`, token: "mercy", company: "Mercy", title: `Ward Nurse ${i}`,
  location: "Leeds, United Kingdom", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
}));
const fitBatches = () => invoke.mock.calls.filter(([fn, o]) => fn === "job-fit" && (o as { body: Body }).body.action === "fit-batch");

function mockBoard(fitAnswer: () => unknown) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: [] }, error: null };
    if (fn === "job-fit" && b.action === "fit-batch") return fitAnswer();
    if (fn !== "job-board") return { data: null, error: null };
    if (b.action === "detail") return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: ROWS.length }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
async function dropResumeAt(url: string) {
  window.history.replaceState({}, "", url);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull(), SLOW);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([RESUME], "cv.txt", { type: "text/plain" })] } });
  await waitFor(() => expect(fitBatches().length).toBeGreaterThan(0), SLOW);
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
}
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});

describe("the board names the allowance", () => {
  it("positive control: an ordinary failure is a blip with a Try again", async () => {
    mockBoard(() => ({ data: null, error: { message: "546 WORKER_RESOURCE_LIMIT" } }));
    await dropResumeAt("/jobs");
    await waitFor(() => expect(text()).toMatch(/could not be scored just now/), SLOW);
    expect(screen.getAllByRole("button", { name: /Try again/ }).length).toBeGreaterThan(0);
  });

  it("a 429 names the hourly allowance and its number, offers no retry, and stops asking", async () => {
    mockBoard(() => refused(429, LIMIT_BODY));
    await dropResumeAt("/jobs");
    await waitFor(() => expect(document.querySelector("[data-fit-limited]")?.textContent).toContain("Hourly fit-scoring allowance of 60 reached"), SLOW);
    expect(text(), "the allowance was called temporary").not.toMatch(/usually temporary/);
    expect(screen.queryAllByRole("button", { name: /Try again/ }), "a retry inside the window is refused again").toEqual([]);
    expect(fitBatches().length, "the loop asked for the second batch after the first was refused").toBe(1);
  });

  it("a posting opened under the allowance says it was not scored because of it", async () => {
    mockBoard(() => refused(429, LIMIT_BODY));
    await dropResumeAt(`/jobs?job=${encodeURIComponent(ROWS[3].id)}`);
    await waitFor(() => expect(document.querySelector("[data-fit-held]")?.textContent).toContain("the fit-scoring allowance for now is used up"), SLOW);
    expect(text(), "a posting that will not be scored kept a spinner").not.toContain("Scoring this posting against your resume");
  });
});

describe("the report's matches card names it too", () => {
  const JOBS = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, company: `Mercy ${i + 1}`, title: `Ward Nurse ${i + 1}`, location: "Remote", salary: null, applyUrl: `https://x/${i + 1}` }));
  const mockCard = (fitAnswer: () => unknown) => invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: ["registered nurse"] } };
    if (fn === "job-board" && b.action === "list") return { data: { jobs: JOBS, total: 4_242 } };
    if (fn === "job-board" && b.action === "verify") return { data: { live: {} } };
    if (fn === "job-fit" && b.action === "fit-batch") return fitAnswer();
    return { data: null };
  });

  it("positive control: an ordinary failure keeps its retry", async () => {
    mockCard(() => ({ data: null, error: { message: "546" } }));
    render(<MemoryRouter><LiveMatches resumeText={RESUME} industry="healthcare" /></MemoryRouter>);
    await waitFor(() => expect(text()).toMatch(/could not be scored/), SLOW);
    expect(document.querySelector("[data-fit-limited]")).toBeNull();
  });

  it("a 429 names the allowance, and no retry is offered", async () => {
    mockCard(() => refused(429, LIMIT_BODY));
    render(<MemoryRouter><LiveMatches resumeText={RESUME} industry="healthcare" /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-fit-limited]")?.textContent).toContain("Hourly fit-scoring allowance of 60 reached"), SLOW);
    expect(text()).not.toMatch(/usually temporary/);
    expect(screen.queryAllByRole("button", { name: /Try again/ })).toEqual([]);
  });
});
