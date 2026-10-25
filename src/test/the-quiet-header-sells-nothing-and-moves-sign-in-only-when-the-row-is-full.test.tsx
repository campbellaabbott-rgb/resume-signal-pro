/**
 * THE QUIET HEADER SELLS NOTHING AND MOVES SIGN IN ONLY WHEN THE ROW IS FULL
 * (homepage and pricing spec of 2026-10-17, section 3; switch-over README,
 * step 9; precondition W4).
 *
 * The board-first homepage and the new pricing page each have one filled
 * button of their own ("Search jobs", "Create a free account"). The shared
 * header put a second one beside it on every page: the filled "Get started"
 * (and "Start" on a phone) that scrolled to the scanner. <Header
 * variant="quiet" /> drops both and shows Sign in as a plain link in the row.
 * When the row does not fit, Sign in moves into the Menu sheet, decided by
 * measuring the row: at the default text size it is tightest at 375 to 383 px
 * in Spanish, French and Tagalog (the wordmark goes screen-reader-only below
 * 375 px), and a larger text size, a credits balance or a longer account
 * label fills it at wider widths, so a fixed breakpoint would be wrong in
 * some language either way. The measure runs again whenever what is in the
 * row can change: a new language, a re-render, a control that grows (the
 * row's children are observed), and it counts the row's right padding and a
 * squeezed nav as not fitting. The default header is unchanged.
 *
 * The quiet header shows a credits control only to a browser holding a
 * proven balance: Scan Packs are no longer sold, and nothing on the pages
 * that mount it sells credits, so a visitor with none is not shown a "My
 * credits" explainer about buying them.
 *
 * And Start, where it stays (the default header on every other page), goes
 * to the scanner's own address, /resume-checker#upload, from any page with
 * no uploader of its own (step 11): on the new "/" there is no #upload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
const credits = vi.hoisted(() => ({ known: false, credits: 0 }));
vi.mock("@/hooks/use-scan-credits", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    useScanCredits: () => ({ credits: credits.credits, email: null, signedIn: false, known: credits.known, refreshCredits: async () => {} }),
  };
});

import i18n from "@/i18n";
import { Header } from "@/components/Header";

/**
 * A ResizeObserver the test drives (it records what it was asked to watch),
 * a row whose widths the test sets, a nav whose widths the test sets, and
 * right edges the test sets for the row and its right-hand group.
 */
const observers: Array<() => void> = [];
const observed: Element[] = [];
const widths = { scroll: 0, client: 0, navScroll: 0, navClient: 0 };
const edges = { row: 0, actions: 0 };
beforeEach(() => {
  observers.length = 0;
  observed.length = 0;
  Object.assign(widths, { scroll: 0, client: 0, navScroll: 0, navClient: 0 });
  Object.assign(edges, { row: 0, actions: 0 });
  credits.known = false;
  credits.credits = 0;
  vi.stubGlobal("ResizeObserver", class {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; observers.push(() => this.cb()); }
    observe(el: Element) { observed.push(el); }
    disconnect() {}
    unobserve() {}
  });
  const row = (el: HTMLElement) => el.hasAttribute("data-header-row");
  const nav = (el: HTMLElement) => el.hasAttribute("data-header-nav");
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) { return row(this) ? widths.scroll : nav(this) ? widths.navScroll : 0; });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return row(this) ? widths.client : nav(this) ? widths.navClient : 0; });
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const right = row(this) ? edges.row : this.hasAttribute("data-header-actions") ? edges.actions : null;
    if (right === null) return realRect.call(this);
    return { x: 0, y: 0, top: 0, left: 0, bottom: 56, height: 56, right, width: right, toJSON() { return {}; } } as DOMRect;
  });
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

let where = "";
function Where() { const l = useLocation(); where = `${l.pathname}${l.hash}`; return null; }
function tree(path: string, variant?: "quiet") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="*" element={<><Header variant={variant} /><Where /></>} /></Routes>
    </MemoryRouter>
  );
}
function mount(path: string, variant?: "quiet") {
  return render(tree(path, variant));
}
const header = () => document.querySelector("header") as HTMLElement;
const filled = () => [...header().querySelectorAll<HTMLElement>("button, a")].filter((e) => /(^|\s)bg-primary(\s|$)/.test(e.className));
const barSignIn = () => header().querySelector<HTMLAnchorElement>("[data-header-signin]");
const resize = (scroll: number, client: number) => act(() => { widths.scroll = scroll; widths.client = client; for (const o of observers) o(); });

describe("the default header is unchanged", () => {
  it("keeps its filled Get started and Start", () => {
    mount("/jobs");
    expect(filled().map((e) => e.textContent)).toEqual(["Get Started", "Start"]);
    expect(barSignIn()).toBeNull();
  });

  it("keeps its credits control for every visitor", () => {
    mount("/jobs");
    expect(screen.getByRole("button", { name: /My credits/ })).not.toBeNull();
  });
});

describe("the quiet header", () => {
  it("has no filled button, and Sign in is a plain link in the row", () => {
    mount("/", "quiet");
    expect(filled()).toEqual([]);
    expect(screen.queryByRole("button", { name: /^(Get started|Start)$/i })).toBeNull();
    const link = barSignIn();
    expect(link?.getAttribute("href")).toBe("/auth");
    expect(link?.textContent).toBe("Sign in");
    expect(link?.className).not.toMatch(/\bsr-only\b|\bhidden\b/);
    // A 44 px target under a finger, as every header control.
    expect(link?.className).toMatch(/coarse:h-11/);
  });

  it("moves Sign in into the Menu sheet when the row overflows, and back when it fits again", () => {
    mount("/pricing", "quiet");
    resize(500, 500);
    expect(barSignIn(), "the row fits: Sign in stays in it").not.toBeNull();

    resize(412, 360);
    expect(barSignIn(), "the row overflows: Sign in leaves it").toBeNull();
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu.className, "the Menu is reachable at every width while it holds Sign in").not.toMatch(/\blg:hidden\b/);
    fireEvent.click(menu);
    const nav = screen.getByRole("navigation", { name: "Site menu" });
    expect(within(nav).getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/auth");
    fireEvent.keyDown(window, { key: "Escape" });

    // Narrower than the full row still: it stays in the menu (no flicker).
    resize(360, 400);
    expect(barSignIn()).toBeNull();
    // As wide as the full row was: it comes back.
    resize(412, 412);
    expect(barSignIn()).not.toBeNull();
  });

  it("measures again on a new language, though nothing was resized", async () => {
    mount("/", "quiet");
    resize(500, 500);
    expect(barSignIn()).not.toBeNull();
    // The longer words of the new language overflow the row; its box keeps
    // its size, so no observer fires.
    widths.scroll = 540;
    await act(async () => { await i18n.changeLanguage("es"); });
    expect(barSignIn(), "the Spanish row overflows: Sign in leaves it").toBeNull();
    expect(screen.getByRole("button", { name: /Men/ }).className).not.toMatch(/\blg:hidden\b/);
  });

  it("measures again when the header renders after its content grew, though nothing was resized", () => {
    const view = mount("/pricing", "quiet");
    resize(500, 500);
    expect(barSignIn()).not.toBeNull();
    widths.scroll = 530;
    view.rerender(tree("/pricing", "quiet"));
    expect(barSignIn()).toBeNull();
  });

  it("watches the row's children too, so a control that grows inside the row is measured", () => {
    mount("/", "quiet");
    const row = header().querySelector("[data-header-row]") as HTMLElement;
    const actions = row.querySelector("[data-header-actions]") as HTMLElement;
    const nav = row.querySelector("[data-header-nav]") as HTMLElement;
    expect(observed).toContain(row);
    expect(observed, "the right-hand group (credits, Sign in, Menu)").toContain(actions);
    expect(observed, "the nav").toContain(nav);
    for (const child of actions.children) expect(observed).toContain(child);
  });

  it("counts the row's right padding: controls that eat the gutter do not fit", () => {
    mount("/", "quiet");
    const row = header().querySelector("[data-header-row]") as HTMLElement;
    row.style.paddingRight = "16px";
    // No scroll overflow, but the last control ends 7 px from the edge,
    // inside the 16 px gutter.
    edges.row = 375;
    edges.actions = 368;
    resize(375, 375);
    expect(barSignIn()).toBeNull();
    // Wide enough for the whole row and its gutter again: it comes back.
    edges.row = 400;
    edges.actions = 368;
    resize(400, 400);
    expect(barSignIn()).not.toBeNull();
  });

  it("counts a squeezed nav: links that overlap under the right-hand group do not fit", () => {
    mount("/", "quiet");
    resize(1024, 1024);
    expect(barSignIn()).not.toBeNull();
    act(() => { widths.navScroll = 520; widths.navClient = 470; for (const o of observers) o(); });
    expect(barSignIn()).toBeNull();
  });

  it("shows no credits control to a visitor with no proven balance", () => {
    mount("/", "quiet");
    expect(screen.queryByRole("button", { name: /credits/i })).toBeNull();
    expect(header().textContent).not.toMatch(/credits/i);
  });

  it("shows a proven balance, as the default header does", () => {
    credits.known = true;
    credits.credits = 7;
    mount("/", "quiet");
    expect(screen.getByRole("button", { name: /My credits/ }).textContent).toMatch(/7/);
  });

  it("gives every link in the Menu sheet a 44 px floor that beats the 24 px link floor", () => {
    mount("/", "quiet");
    resize(412, 360);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const nav = screen.getByRole("navigation", { name: "Site menu" });
    const links = within(nav).getAllByRole("link");
    expect(links.length).toBeGreaterThan(5);
    // a[href] (0,1,1) outranks a single-class utility (index.css), so only an
    // important utility sets a link's floor.
    for (const a of links) expect(a.className, a.textContent ?? "").toMatch(/(^|\s)!min-h-11(\s|$)/);
  });

  it("decides by measuring, never by a fixed width", () => {
    const code = readFileSync(resolve(__dirname, "../components/Header.tsx"), "utf8");
    expect(code).toMatch(/ResizeObserver/);
    expect(code).toMatch(/scrollWidth/);
    expect(code, "a fixed 360 px breakpoint").not.toMatch(/\b360\b|min-\[3[0-9]{2}px\]|max-\[3[0-9]{2}px\]:hidden/);
  });
});

describe("Start goes to the scanner's own address", () => {
  it("from a page with no uploader, Start opens /resume-checker#upload", () => {
    mount("/pricing");
    fireEvent.click(screen.getByRole("button", { name: /^Get started$/i }));
    expect(where).toBe("/resume-checker#upload");
  });
});
