// THE SHORTCUTS CARD KEEPS ITS KEYS TO ITSELF (NB-26).
//
// "?" opens the keyboard-shortcuts card over the board. Focus stayed on the
// page behind it, and the board's own window key handler still ran under it:
// Escape closed the card AND the posting the reader had open, Enter opened
// that posting's employer site in a new tab, and the arrows moved the
// selection behind the card. The card takes focus now, and Escape and Enter
// close it and go no further; the board's handlers stand down while it, or
// the command palette, is open.
//
// Positive control first: with no card open, Escape closes the posting.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
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
const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Analyst ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://employer.example/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const ROWS = [row(0), row(1), row(2)];
let matchMedia: typeof window.matchMedia;
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  matchMedia = window.matchMedia;
  // A wide screen: the pane is open beside the list, and Enter applies.
  window.matchMedia = ((q: string) => ({ matches: /min-width:\s*1024px/.test(q), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "Analyse things." }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: ROWS, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  // The reader opened Analyst 1 themselves (a link), so Enter would apply to it.
  window.history.replaceState({}, "", `/jobs?job=${encodeURIComponent(ROWS[1].id)}`);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
});
afterEach(() => { cleanup(); window.matchMedia = matchMedia; openSpy.mockRestore(); });

const jobInUrl = () => new URLSearchParams(window.location.search).get("job");
const ready = () => waitFor(() => expect(document.body.textContent).toContain("Analyse things."), SLOW);
const openCard = async () => {
  fireEvent.keyDown(document.body, { key: "?" });
  return await screen.findByRole("dialog", { name: "Keyboard shortcuts" }, SLOW);
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 150)); });

describe("the shortcuts card keeps its keys to itself", () => {
  it("positive control: with no card open, Escape closes the posting", async () => {
    await ready();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(jobInUrl()).toBeNull(), SLOW);
  });

  it("the card takes focus when it opens", async () => {
    await ready();
    const card = await openCard();
    await waitFor(() => expect(card.contains(document.activeElement), "focus stayed on the page behind the card").toBe(true), SLOW);
  });

  it("Escape closes the card and not the posting behind it", async () => {
    await ready();
    await openCard();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull(), SLOW);
    await settle();
    expect(jobInUrl(), "Escape on the card closed the posting too").toBe(ROWS[1].id);
  });

  it("Enter closes the card and does not open the employer's site", async () => {
    await ready();
    await openCard();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull(), SLOW);
    await settle();
    expect(openSpy, "Enter on the card applied to the posting behind it").not.toHaveBeenCalled();
    expect(jobInUrl()).toBe(ROWS[1].id);
  });
});
