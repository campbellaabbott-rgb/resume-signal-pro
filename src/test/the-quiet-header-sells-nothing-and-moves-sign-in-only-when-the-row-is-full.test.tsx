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
 * measuring the row (fr and es overflow at 360 px, so a fixed breakpoint
 * would be wrong in some language either way). The default header is
 * unchanged.
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

import { Header } from "@/components/Header";

/** A ResizeObserver the test drives, and a row whose widths the test sets. */
const observers: Array<() => void> = [];
const widths = { scroll: 0, client: 0 };
beforeEach(() => {
  observers.length = 0;
  widths.scroll = 0;
  widths.client = 0;
  vi.stubGlobal("ResizeObserver", class {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; observers.push(() => this.cb()); }
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  const row = (el: HTMLElement) => el.hasAttribute("data-header-row");
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) { return row(this) ? widths.scroll : 0; });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return row(this) ? widths.client : 0; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

let where = "";
function Where() { const l = useLocation(); where = `${l.pathname}${l.hash}`; return null; }
function mount(path: string, variant?: "quiet") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="*" element={<><Header variant={variant} /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
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
