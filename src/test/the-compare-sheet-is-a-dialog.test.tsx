// THE COMPARE SHEET IS A DIALOG (S14X-175).
//
// "Side by side" opened as a plain fixed div: no role, no name, focus left
// behind on the tray (which was unmounted under it), the page behind still
// reachable by Tab, and a close mark "✕" with no accessible name. It is a
// dialog now: named by its title, described, focus moved into it and kept
// there, Escape and a named Close button close it, and focus goes back to the
// Compare button it was opened from.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { choosePostingMenuItem } from "./helpers/posting-menu";

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
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const row = (source: string, token: string, company: string, title: string, days: number) => ({
  id: `${source}:${token}:${title.length}`, token, company, title, location: "Berlin, Germany", country: "DE", salary: null,
  applyUrl: `https://x/${token}`, source, postedAt: ago(days), recheckedAt: ago(0.05),
});
const ROWS = [
  row("greenhouse", "acme", "Acme", "Data Analyst", 2),
  row("greenhouse", "beta", "Beta", "Product Analyst", 3),
];

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: ROWS.length }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
});

const cardFor = (needle: string) => Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]")).find((c) => (c.textContent ?? "").includes(needle))!;
async function openCompare(a: string, b: string) {
  window.history.replaceState({}, "", "/jobs");
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  await waitFor(() => expect(cardFor(b)).toBeTruthy(), SLOW);
  await choosePostingMenuItem(cardFor(a), /^Compare/, "menuitemcheckbox");
  await choosePostingMenuItem(cardFor(b), /^Compare/, "menuitemcheckbox");
  await waitFor(() => expect(document.body.textContent).toContain("Comparing 2 of 3"), SLOW);
  // Opened as a keyboard opens it: from the focused button.
  const compare = screen.getByRole("button", { name: "Compare" });
  compare.focus();
  fireEvent.click(compare);
  return await screen.findByRole("dialog", { name: "Side by side" }, SLOW);
}

describe("the compare sheet is a dialog", () => {
  it("opens as a named, described, modal dialog with focus inside it", async () => {
    const dialog = await openCompare("Data Analyst", "Product Analyst");
    expect(dialog.getAttribute("aria-describedby"), "the sheet has no description").toBeTruthy();
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent)
      .toBe("The postings you picked, compared on what the board already holds for each.");
    await waitFor(() => expect(dialog.contains(document.activeElement), "focus stayed behind the sheet").toBe(true), SLOW);
    expect(within(dialog).getByText("Data Analyst")).toBeTruthy();
    expect(within(dialog).getByText("Product Analyst")).toBeTruthy();
  });

  it("its close control has a name, and closing returns focus to Compare", async () => {
    const dialog = await openCompare("Data Analyst", "Product Analyst");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), SLOW);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare" })), SLOW);
  });

  it("Escape closes it, and the tray is still there counting both", async () => {
    const dialog = await openCompare("Data Analyst", "Product Analyst");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), SLOW);
    expect(document.body.textContent).toContain("Comparing 2 of 3");
  });
});
