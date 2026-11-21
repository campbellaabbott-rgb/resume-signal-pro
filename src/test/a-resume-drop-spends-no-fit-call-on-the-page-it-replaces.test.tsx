// A RÉSUMÉ DROP SPENDS NO FIT CALL ON THE PAGE IT REPLACES (sweep MATCH-12).
//
// WHAT WAS WRONG. Switching ranking on over a browse (no query, no employer)
// refetches the list for postings that can be scored, so the page on screen is
// about to be replaced. The "For you" button and the arrival with a résumé
// both make the scorer wait for that page. The résumé drop did not on two of
// its branches: when the résumé names no role, and when it names one but the
// reader's filters are kept. Each scored the page being thrown away first: a
// fit call against an hourly allowance, for rows nobody would see scored.
//
// WHAT HOLDS NOW, on the mounted board, with the described page made of
// different postings than the page it replaces:
//   - a drop whose résumé names no role scores only the replacement page;
//   - a drop under a filter, whose role is not searched, does the same;
//   - control: a drop that searches its role scores that role's page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toastSpy(...a), useToast: () => ({ toast: toastSpy, toasts: [] }) }));
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
const RESUME = "Registered nurse with eight years of acute care experience in a level one trauma centre. ".repeat(3);
const row = (kind: string, n: number) => ({
  id: `greenhouse:${kind}:${n}`, token: kind, company: `Employer ${n}`, title: `${kind} role ${n}`, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${kind}/${n}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
/** The recency page on screen before the drop, the described page that replaces it, and a searched role's page. */
const OLD = [row("old", 1), row("old", 2), row("old", 3)];
const DESCRIBED = [row("described", 1), row("described", 2), row("described", 3)];
const SEARCHED = [row("searched", 1), row("searched", 2), row("searched", 3)];

let fitBatches: string[][] = [];
let terms: string[] = [];

function mount(path: string) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms }, error: null };
    if (fn === "job-fit" && b.action === "fit-batch") {
      const ids = (b.ids as string[]) ?? [];
      fitBatches.push(ids);
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, 61])), unscored: {}, missing: {}, matched: {} }, error: null };
    }
    if (fn !== "job-board") return { data: null, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const jobs = b.q ? SEARCHED : b.hasDescription ? DESCRIBED : OLD;
      return { data: { jobs, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", path);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement | null;
async function drop() {
  await waitFor(() => expect(document.body.textContent).toContain("old role 1"), SLOW);
  await waitFor(() => expect(fileInput(), "the board offered no résumé drop").not.toBeNull(), SLOW);
  fireEvent.change(fileInput()!, { target: { files: [new File([RESUME], "resume.txt", { type: "text/plain" })] } });
}
const scored = () => document.querySelectorAll('[title^="Keyword fit score "]').length;

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  fitBatches = [];
  terms = [];
  invoke.mockReset();
  toastSpy.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("a résumé dropped on a browse", () => {
  it("that names no role scores only the page that replaces the one on screen", async () => {
    terms = [];
    mount("/jobs");
    await drop();
    await waitFor(() => expect(document.body.textContent).toContain("described role 1"), SLOW);
    await waitFor(() => expect(scored()).toBe(3), SLOW);
    expect(fitBatches.flat().filter((id) => id.includes(":old:")), "a fit call was spent on the page being replaced").toEqual([]);
    expect(fitBatches).toEqual([DESCRIBED.map((j) => j.id)]);
  });

  it("under a filter, whose role is not searched, scores only the replacement page too", async () => {
    terms = ["Registered Nurse"];
    mount("/jobs?country=US");
    await drop();
    await waitFor(() => expect(document.body.textContent).toContain("described role 1"), SLOW);
    await waitFor(() => expect(scored()).toBe(3), SLOW);
    expect(fitBatches.flat().filter((id) => id.includes(":old:")), "a fit call was spent on the page being replaced").toEqual([]);
    expect(fitBatches).toEqual([DESCRIBED.map((j) => j.id)]);
    // And the reader was told their filters were kept.
    expect(toastSpy.mock.calls.map((c) => String((c[0] as { title?: unknown }).title ?? "")).join("|")).toContain("your filters are kept");
  });

  it("control: a résumé whose role is searched scores that role's page", async () => {
    terms = ["Registered Nurse"];
    mount("/jobs");
    await drop();
    await waitFor(() => expect(document.body.textContent).toContain("searched role 1"), SLOW);
    await waitFor(() => expect(scored()).toBe(3), SLOW);
    expect(fitBatches).toEqual([SEARCHED.map((j) => j.id)]);
  });
});
