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

const SLOW = { timeout: 4000 } as const;

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
const isFilled = (el: Element) => el.className.includes("from-primary");
const isOutline = (el: Element) => el.className.includes("bg-transparent");

function mount(path = "/jobs", width = 1280) {
  window.history.replaceState({}, "", path);
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: /max-width:\s*640px/.test(query) ? width <= 640 : false,
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

  it("behaviour: the card offers exactly ONE loud action, and it is the free scan", async () => {
    mount();
    await waitFor(() => expect(card()).not.toBeNull(), SLOW);
    const fit = within(card()).getByText("Check my fit — free scan").closest("button")!;
    const apply = within(card()).getByText("Apply").closest("a")!;
    expect(isFilled(fit), "the differentiator is the quiet one").toBe(true);
    expect(isFilled(apply), "two filled blues competing for one click").toBe(false);
    expect(isOutline(apply), "Apply must still be a real button, not a link in prose").toBe(true);
    // Apply did not lose anything but the fill.
    expect(apply.getAttribute("href")).toBe("https://acme.example/apply");
    expect(apply.getAttribute("target")).toBe("_blank");
    expect(apply.getAttribute("title")).toContain("Acme");
    // ONE. Not two, and not zero.
    expect(filledIn(card())).toEqual(["Check my fit — free scan"]);
  });

  it("behaviour: the detail panel says the same thing the card does", async () => {
    mount("/jobs?job=j1");
    await waitFor(() => expect(drawer().textContent).toContain("Backend Engineer"), SLOW);
    // The panel renders its actions row AND, on a phone, a pinned thumb bar.
    // Both are inside this drawer, so "every one of them" is the claim.
    const fits = within(drawer()).getAllByText("Check my fit — free scan").map((n) => n.closest("button")!);
    expect(fits.length).toBeGreaterThan(0);
    for (const f of fits) expect(isFilled(f), "a fit control that is not the primary").toBe(true);
    const applies = Array.from(drawer().querySelectorAll("a"))
      .filter((a) => /Apply/.test(a.textContent ?? ""));
    expect(applies.length).toBeGreaterThan(0);
    for (const a of applies) {
      expect(isFilled(a), "the panel put Apply back in primary blue").toBe(false);
      expect(isOutline(a)).toBe(true);
    }
    // The one hierarchy, stated as an equality between the two surfaces.
    expect(new Set(filledIn(drawer()))).toEqual(new Set(["Check my fit — free scan"]));
  });

  it("behaviour: on a 375px phone the pinned thumb bar obeys the same hierarchy", async () => {
    // The thumb bar is the control that is ALWAYS on screen while the JD
    // scrolls, so it is the one that decides what a phone reader does. It used
    // to fill Apply while the row above it filled the scan.
    mount("/jobs?job=j1", 375);
    await waitFor(() => expect(drawer().textContent).toContain("Backend Engineer"), SLOW);
    const bar = drawer().querySelector(".sticky.bottom-0") as HTMLElement;
    expect(bar, "the thumb bar disappeared").not.toBeNull();
    const barFit = within(bar).getByText("Check my fit — free scan").closest("button")!;
    const barApply = within(bar).getByText("Apply").closest("a")!;
    expect(isFilled(barFit)).toBe(true);
    expect(isFilled(barApply)).toBe(false);
    // Apply keeps its full name where the label had to shorten to fit.
    expect(barApply.getAttribute("title")).toBe("Apply on company site");
    expect(barApply.getAttribute("href")).toBe("https://acme.example/apply");
    // And Save is still in thumb reach.
    expect(within(bar).getByLabelText("Save")).toBeTruthy();
  });

  it("behaviour: all four icon controls have accessible names — on the phone card too", async () => {
    // TRUE BEFORE THIS FIX AND STILL TRUE AFTER IT. Asserted so a later tidy of
    // the cluster cannot quietly turn one of them back into a bare glyph.
    for (const width of [1280, 375]) {
      const view = mount("/jobs", width);
      await waitFor(() => expect(card()).not.toBeNull(), SLOW);
      const c = within(card());
      expect(c.getByLabelText("Save")).toBeTruthy();
      expect(c.getByLabelText("Report this posting")).toBeTruthy();
      expect(c.getByLabelText("Hide this posting")).toBeTruthy();
      expect(c.getByLabelText("Add to compare (up to 3)")).toBeTruthy();
      // A mouse reader gets the same explanation a screen-reader user does.
      for (const label of ["Save", "Report this posting", "Hide this posting", "Add to compare (up to 3)"]) {
        expect(c.getByLabelText(label).getAttribute("title"), label).toBeTruthy();
      }
      view.unmount();
    }
  });

  it("behaviour: the utility cluster comes after the two decisions, never between them", async () => {
    mount();
    await waitFor(() => expect(card()).not.toBeNull(), SLOW);
    const order = Array.from(card().querySelectorAll("button, a"))
      .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim());
    const at = (s: string) => order.findIndex((x) => x === s);
    expect(at("Check my fit — free scan")).toBeGreaterThanOrEqual(0);
    expect(at("Check my fit — free scan")).toBeLessThan(at("Apply"));
    for (const util of ["Save", "Report this posting", "Hide this posting", "Add to compare (up to 3)"]) {
      expect(at("Apply"), `${util} sits among the decisions`).toBeLessThan(at(util));
    }
  });

  it("behaviour: a selected compare toggle is a pressed utility, not a third call to action", async () => {
    mount();
    await waitFor(() => expect(card()).not.toBeNull(), SLOW);
    const cmp = within(card()).getByLabelText("Add to compare (up to 3)");
    expect(cmp.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(cmp);
    await waitFor(() => expect(cmp.getAttribute("aria-pressed")).toBe("true"), SLOW);
    // ON, and still not the loudest thing on the card.
    expect(isFilled(cmp)).toBe(false);
    expect(cmp.className, "the old selected state was a filled primary button")
      .not.toContain("text-primary-foreground");
    expect(filledIn(card()), "selecting a utility added a second loud action")
      .toEqual(["Check my fit — free scan"]);
  });

  it("behaviour: saving a posting reports its own pressed state", async () => {
    mount();
    await waitFor(() => expect(card()).not.toBeNull(), SLOW);
    expect(within(card()).getByLabelText("Save").getAttribute("aria-pressed")).toBe("false");
  });
});
