// THE COMPARE SHEET PRINTS REVENUE IN ITS OWN CURRENCY, AND AGE BY THE
// CARD'S RULE (S14X-196, S14X-252).
//
// S14X-196: the sheet printed a listed employer's revenue as "$" + revenue / 1e9 + "B"
// whatever the filing's currency: SAP's EUR 34.2 billion read "$34.2B". It
// formats the figure in its own currency now, as the employer panel does
// (fmtMoney). S14X-252: it printed "posted N days ago" from the raw feed date for
// every posting, including a system that re-dates a posting when it is
// edited (Breezy, Paylocity, UKG), where the card prints no age at all: the
// sheet now takes the card's own age rule.
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
vi.mock("@/lib/employer-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/employer-context")>();
  return {
    ...real,
    getEmployerCtx: async (token: string) => token === "sap"
      ? { ticker: "SAP", exchange: "XETRA", revenue: 34_180_000_000, currency: "EUR", fyYear: 2024, netIncome: null }
      : { ticker: "ACME", exchange: "NYSE", revenue: 2_500_000_000, currency: "USD", fyYear: 2024, netIncome: null },
  };
});

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const row = (source: string, token: string, company: string, title: string, days: number) => ({
  id: `${source}:${token}:${title.length}`, token, company, title, location: "Berlin, Germany", country: "DE", salary: null,
  applyUrl: `https://x/${token}`, source, postedAt: ago(days), recheckedAt: ago(0.05),
});
const ROWS = [
  row("greenhouse", "sap", "SAP", "Cloud Architect", 2),
  row("greenhouse", "acme", "Acme", "Data Analyst", 2),
  row("breezy", "brz", "Brz", "Warehouse Lead", 2),
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
  // Found by its heading, so the controls also run against the sheet before
  // it was a dialog; the-compare-sheet-is-a-dialog holds the dialog itself.
  const heading = await screen.findByRole("heading", { name: "Side by side" }, SLOW);
  return (heading.closest("[data-compare-dialog]") ?? heading.parentElement?.parentElement) as HTMLElement;
}

describe("the compare sheet prints revenue in its own currency", () => {
  it("positive control: a dollar filing reads in dollars", async () => {
    const dialog = await openCompare("Data Analyst", "Cloud Architect");
    await waitFor(() => expect(dialog.textContent).toContain("$2.5B"), SLOW);
  });

  it("a euro filing reads in euros, never as dollars", async () => {
    const dialog = await openCompare("Data Analyst", "Cloud Architect");
    await waitFor(() => expect(dialog.textContent).toContain("€34.2B revenue FY2024"), SLOW);
    expect(dialog.textContent, "a euro revenue printed with a dollar sign").not.toContain("$34.2B");
  });
});

describe("the compare sheet's age is the card's", () => {
  it("a dated posting from a system that keeps its dates states its age; a re-dating system's states none", async () => {
    const dialog = await openCompare("Data Analyst", "Warehouse Lead");
    const ages = Array.from(dialog.querySelectorAll("[data-compare-age]")).map((e) => e.textContent);
    expect(ages, "one age for the greenhouse posting, none for the breezy one").toEqual(["posted 2 days ago"]);
    expect(dialog.textContent, "the re-dated posting is in the sheet").toContain("Warehouse Lead");
  });
});
