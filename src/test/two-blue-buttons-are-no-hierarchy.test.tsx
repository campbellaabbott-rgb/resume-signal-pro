// TWO BLUE BUTTONS ARE NO HIERARCHY — AND TWO SURFACES DISAGREEING IS WORSE.
//
// Measured on the live board before this fix:
//
//   THE CARD    "Check my fit — free scan"  outline
//               "Apply ⧉"                   FILLED PRIMARY
//   THE PANEL   "Check my fit — free scan"  FILLED PRIMARY
//               "Apply on company site"     outline
//   THE PHONE   the pinned thumb bar inside that same panel filled Apply,
//               four inches under an actions row that filled the fit scan.
//
// So the board answered "what should I do first?" differently depending on
// which surface the reader happened to be looking at, and the drawer disagreed
// with ITSELF. On the card the two filled-blue controls also sat side by side
// competing for one click, which is the state in which a reader picks neither.
//
// ── THE HIERARCHY, DECIDED ONCE ─────────────────────────────────────────────
//
// The fit scan leads. It is free, it is reversible, it is the thing this
// product has that an aggregator does not, and the board's entire argument is
// "check your fit before you spend an application". Apply is the action that
// leaves the site for good, and it keeps its own button, its icon and its full
// name — it simply stops shouting over the cheaper action. That was already the
// detail pane's decision, written down in the pane's own comment; the card and
// the thumb bar now agree with it instead of contradicting it.
//
// ── THE FOUR ICON CONTROLS ──────────────────────────────────────────────────
//
// Save, report, hide and compare. MEASURED FIRST, then changed: all four
// already carried translated aria-labels before this fix, and the tests below
// keep it that way rather than claiming credit for it. What was actually wrong
// with them is that they sat in the same undifferentiated run as the two real
// actions, and that the compare toggle rendered as a FILLED PRIMARY button
// whenever it was on — a third blue thing, on a card that had just had its
// second one removed — behind a bare "⇄" glyph with no icon and no pressed
// state. They are now one right-aligned utility cluster after the decisions,
// the compare control is a real icon with aria-pressed, and none of the four
// can be the loudest thing on the card.
//
// Behavioural, with the board mocked. The variant classes ARE the hierarchy a
// reader sees, so they are read off the rendered DOM — not grepped out of the
// source, where a swapped call site would still look fine.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "../pages/Jobs";
import { choosePostingMenuItem, openPostingMenu } from "./helpers/posting-menu";

// THE WAITING BUDGET, and why it is not a number chosen here: helpers/mount-
// budget.ts. SLOW was 4000 under vitest's default 5000 ms per-test budget,
// so a stuck wait could only be reported as "Test timed out in 5000ms",
// naming nothing. The slowest case measured 1753 ms on the 2026-09-30 loaded
// run.
vi.setConfig(MOUNT_TEST_BUDGET);

const ROWS = [
  {
    id: "j1", company: "Acme", token: "acme", title: "Backend Engineer", source: "greenhouse",
    location: "Austin, TX, USA", country: "US", salary: null, category: "engineering",
    applyUrl: "https://acme.example/apply", postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

// The two variants the hierarchy is made of, read off the class list the
// Button component actually renders. `from-primary` is the filled default's
// gradient; `bg-transparent` is the outline's.
// The filled variant is the flat Ledger primary (design pass A dropped the gradient).
const isFilled = (el: Element) => /(^|\s)bg-primary(\s|$)/.test(el.className);
const isOutline = (el: Element) => el.className.includes("bg-transparent");

function mount(path = "/jobs", width = 1280) {
  window.history.replaceState({}, "", path);
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: /max-width:\s*640px/.test(query) ? width <= 640 : /min-width:\s*1024px/.test(query) ? width >= 1024 : false,
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  // NON-EMPTY for get_salary_benchmarks on purpose: an empty answer arms a
  // 1.5s retry inside Jobs, which then fires after this file's next mockReset
  // and surfaces as an unhandled rejection under parallel load.
  rpc.mockImplementation(async (fn: string) => (
    fn === "get_salary_benchmarks"
      ? { data: [{ category: "engineering", currency: "USD", n: 4_000, median_annual_min: 100_000 }] }
      : { data: [] }
  ));
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [], fits: {}, missing: {}, matched: {} } };
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "We need a backend engineer." } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [],
          companiesCount: 0, categories: {}, failedSources: [], failedCount: 0,
          refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const card = () => document.querySelector('[data-job-id="j1"]') as HTMLElement;
const drawer = () => screen.getAllByRole("dialog")[0] as HTMLElement;
// The desktop pane (the posting rendered beside the list, not in a dialog).
const detail = () => document.querySelector("[data-posting-detail]") as HTMLElement;
// Every control in a container that a reader would read as "the loud one".
const filledIn = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("button, a"))
    .filter(isFilled)
    .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim());

describe("two blue buttons are no hierarchy", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  // PASS B (2026-10-12): the board's card is the listing vocabulary's JobCard
  // and a posting opens in PostingDetail (the pane, or the phone sheet with its
  // thumb bar). The audit's rule is kept — one loud action per surface, never
  // two filled blues — with the design group's choice of the loud one: Apply on
  // the employer's own site is the one filled control on a posting, the free
  // fit check is the quiet secondary, and the card itself carries no loud
  // action at all (Apply left it for the pane; "Check fit" is an underlined
  // link; the housekeeping is in one ⋯ menu).
  const applyLinks = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLAnchorElement>("[data-apply-link]"));

  it("behaviour: the card offers no loud action; the fit check is a quiet link and Apply is not on it", async () => {
    mount();
    await waitFor(() => expect(card()).not.toBeNull(), SLOW);
    expect(filledIn(card()), "a loud action on the card").toEqual([]);
    const fit = within(card()).getByRole("button", { name: "Check fit: Backend Engineer" });
    expect(isFilled(fit), "the fit check is the quiet one").toBe(false);
    expect(fit.className).toContain("underline");
    expect(applyLinks(card()), "Apply belongs to the pane and the sheet, not the card").toHaveLength(0);
  });

  it("behaviour: the posting's actions row has exactly one loud action, and it is Apply", async () => {
    mount("/jobs?job=j1");
    await waitFor(() => expect(detail()?.textContent).toContain("Backend Engineer"), SLOW);
    const row = detail().querySelector('[data-posting-actions="full"]') as HTMLElement;
    expect(row, "the actions row disappeared").not.toBeNull();
    const apply = row.querySelector("[data-apply-link]") as HTMLAnchorElement;
    expect(isFilled(apply), "Apply is the one filled control").toBe(true);
    expect(apply.getAttribute("href")).toBe("https://acme.example/apply");
    expect(apply.getAttribute("target")).toBe("_blank");
    expect(apply.textContent).toContain("Acme");
    const fit = within(row).getByRole("button", { name: /Check my fit, free/ });
    expect(isFilled(fit), "two filled blues competing for one click").toBe(false);
    expect(filledIn(row)).toHaveLength(1);
    // Every loud control anywhere in the posting is an Apply link (the row's,
    // and on a phone the thumb bar's): the same decision, never a second one.
    for (const el of Array.from(detail().querySelectorAll("button, a")).filter(isFilled)) {
      expect(el.hasAttribute("data-apply-link"), `a second loud action: ${(el.textContent ?? "").trim()}`).toBe(true);
    }
  });

  it("behaviour: on a 375px phone the pinned thumb bar obeys the same hierarchy", async () => {
    // The thumb bar is the control that is ALWAYS on screen while the JD
    // scrolls, so it is the one that decides what a phone reader does.
    mount("/jobs?job=j1", 375);
    await waitFor(() => expect(drawer().textContent).toContain("Backend Engineer"), SLOW);
    const bar = drawer().querySelector(".sticky.bottom-0") as HTMLElement;
    expect(bar, "the thumb bar disappeared").not.toBeNull();
    const barApply = bar.querySelector("[data-apply-link]") as HTMLAnchorElement;
    expect(isFilled(barApply)).toBe(true);
    expect(barApply.textContent).toContain("Apply on employer site");
    expect(barApply.getAttribute("href")).toBe("https://acme.example/apply");
    const barFit = within(bar).getByRole("button", { name: /Check my fit, free/ });
    expect(isFilled(barFit)).toBe(false);
    expect(filledIn(bar)).toHaveLength(1);
    // And Save is still in thumb reach.
    expect(within(bar).getByLabelText("Save Backend Engineer")).toBeTruthy();
  });

  it("behaviour: every icon control has an accessible name — on the phone card too", async () => {
    // TRUE BEFORE THIS FIX AND STILL TRUE AFTER IT. Asserted so a later tidy of
    // the cluster cannot quietly turn one of them back into a bare glyph.
    for (const width of [1280, 375]) {
      const view = mount("/jobs", width);
      await waitFor(() => expect(card()).not.toBeNull(), SLOW);
      const c = within(card());
      expect(c.getByLabelText("Save Backend Engineer").getAttribute("title"), "Save").toBeTruthy();
      expect(c.getByRole("button", { name: "More actions for Backend Engineer" })).toBeTruthy();
      const menu = await openPostingMenu(card());
      expect(within(menu).getByRole("menuitem", { name: /Posting is gone/ }), "the Report group's first reason").toBeTruthy();
      expect(within(menu).getByRole("menuitem", { name: /Hide this posting/ })).toBeTruthy();
      expect(within(menu).getByRole("menuitemcheckbox", { name: /^Compare/ })).toBeTruthy();
      fireEvent.keyDown(menu, { key: "Escape" });
      view.unmount();
    }
  });

  it("behaviour: the decisions come before the utilities, never between them", async () => {
    mount("/jobs?job=j1");
    await waitFor(() => expect(detail()?.textContent).toContain("Backend Engineer"), SLOW);
    const row = detail().querySelector('[data-posting-actions="full"]') as HTMLElement;
    const order = Array.from(row.querySelectorAll("button, a"))
      .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim());
    const at = (re: RegExp) => order.findIndex((x) => re.test(x));
    expect(at(/^Apply on/), "Apply opens the row").toBe(0);
    expect(at(/^Apply on/)).toBeLessThan(at(/Check my fit, free/));
    expect(at(/Check my fit, free/), "Save sits among the decisions").toBeLessThan(at(/^Save Backend Engineer$/));
  });

  it("behaviour: a selected compare toggle is a checked menu item, not a third call to action", async () => {
    mount();
    await waitFor(() => expect(card()).not.toBeNull(), SLOW);
    await choosePostingMenuItem(card(), /^Compare/, "menuitemcheckbox");
    const menu = await openPostingMenu(card());
    await waitFor(() => expect(within(menu).getByRole("menuitemcheckbox", { name: /^Compare/ }).getAttribute("aria-checked")).toBe("true"), SLOW);
    fireEvent.keyDown(menu, { key: "Escape" });
    // ON, and still nothing loud on the card.
    expect(filledIn(card()), "selecting a utility added a loud action").toEqual([]);
  });

  it("behaviour: saving a posting reports its own pressed state", async () => {
    mount();
    await waitFor(() => expect(card()).not.toBeNull(), SLOW);
    expect(within(card()).getByLabelText("Save Backend Engineer").getAttribute("aria-pressed")).toBe("false");
  });
});
