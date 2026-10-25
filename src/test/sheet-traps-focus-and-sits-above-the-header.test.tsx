/**
 * A SHEET TRAPS FOCUS AND SITS ABOVE THE HEADER.
 *
 * The board's phone drawer was hand-rolled (design audit DX2): focus could
 * walk out of it into the page behind, Escape did nothing, closing it left
 * focus on <body>, and the fixed header (then layer 60) sat over its top edge
 * and its close button. The Sheet primitive replaces it and the header menu.
 * What it must do, checked here:
 *   - open as a named dialog, focus inside it;
 *   - hide the page behind it from assistive technology (aria-hidden);
 *   - close on Escape and hand focus back to what opened it;
 *   - sit on layer 50, above the header's 40, and hide the floating help
 *     button while the body is scroll-locked.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Header } from "@/components/Header";
import { FloatingHelpButton } from "@/components/FloatingHelpButton";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <Header />
      <main>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button type="button">Open posting</button>
          </SheetTrigger>
          <SheetContent side="full" title="Staff Nurse" footer={<button type="button">Apply on employer site ↗</button>}>
            <p>Posting body</p>
            <a href="#x">A link inside</a>
          </SheetContent>
        </Sheet>
      </main>
      <FloatingHelpButton />
    </MemoryRouter>
  );
}

describe("the sheet", () => {
  it("opens as a named dialog with focus inside, and hides the page behind it", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open posting" }));
    const dialog = screen.getByRole("dialog", { name: "Staff Nurse" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    // The page behind is out of the accessibility tree while the sheet is open.
    expect(container.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("banner")).toBeNull();
    // Its header names its close button; its footer holds the primary action.
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Apply on employer site/ })).toBeTruthy();
  });

  it("Escape closes it and focus returns to the control that opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open posting" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Staff Nurse" });
    act(() => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Radix returns focus on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open posting" })), { timeout: 1000 });
  });

  it("sits on layer 50, above the header's 40", () => {
    render(<Harness />);
    const header = screen.getByRole("banner");
    expect(header.className).toMatch(/\bz-40\b/);
    fireEvent.click(screen.getByRole("button", { name: "Open posting" }));
    const dialog = screen.getByRole("dialog", { name: "Staff Nurse" });
    expect(dialog.className).toMatch(/\bz-50\b/);
    const overlay = document.querySelector("[data-sheet-overlay]") as HTMLElement;
    expect(overlay.className).toMatch(/\bz-50\b/);
    expect(header.className).not.toMatch(/z-\[6\d\]|\bz-50\b/);
  });

  it("the floating help button gives way while a sheet holds the page", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open posting" }));
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
    expect(document.querySelector("[data-floating-help]")).toBeTruthy();
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    expect(css).toMatch(/body\[data-scroll-locked\]\s+\[data-floating-help\]\s*\{\s*display:\s*none\s*!important;/);
  });
});

describe("a sheet opened from code, with no trigger", () => {
  // The posting sheet opens from a card's own click handler, not a
  // SheetTrigger; focus must still go back to that card when it closes.
  function CardOpens() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Staff Nurse card</button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="full" title="Staff Nurse">
            <p>Body</p>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  it("hands focus back to whatever opened it", async () => {
    render(<CardOpens />);
    const card = screen.getByRole("button", { name: "Staff Nurse card" });
    card.focus();
    fireEvent.click(card);
    const dialog = screen.getByRole("dialog", { name: "Staff Nurse" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    act(() => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Staff Nurse card" })), { timeout: 1000 });
  });
});

describe("the header menu is a sheet", () => {
  it("opens over the header, traps focus, and Escape hands focus back to Menu", async () => {
    render(<Harness />);
    const menu = screen.getByRole("button", { name: "Menu" });
    menu.focus();
    fireEvent.click(menu);
    const dialog = screen.getByRole("dialog", { name: "Site menu" });
    expect(dialog.className).toMatch(/\bz-50\b/);
    expect(dialog.contains(document.activeElement)).toBe(true);
    act(() => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menu" })), { timeout: 1000 });
  });
});
