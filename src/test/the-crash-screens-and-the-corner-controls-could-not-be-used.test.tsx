/**
 * THE CRASH SCREENS AND THE CORNER CONTROLS COULD NOT BE USED (sweep S8-116,
 * S8-117, S8-118).
 *
 * - S8-116: the résumé, LinkedIn and job-spreadsheet file inputs were
 *   display:none inside non-focusable labels, so Tab skipped every file
 *   chooser (WCAG 2.1.1). They are visually hidden (sr-only) instead.
 * - S8-117: the report's crash notice said "try refreshing the page to see
 *   the results", but the report lives only in React state, so a refresh
 *   discarded it and cost a scan; and the boundary never reset, so a later
 *   scan stayed behind the notice. The global fallback drew gray-900 text on
 *   the near-black body.
 * - S8-118: the sticky bar's dismiss button sat under the help button (same
 *   z-index, later in the DOM), so a tap on dismiss opened Help.
 *
 * jsdom loads no stylesheet, so the two Tailwind utilities that decide
 * whether an input can be reached are installed here exactly as Tailwind
 * defines them.
 */
import { describe, expect, it, vi, beforeAll } from "vitest";
// Purchases open, as once the owner names the seller (owner decision 2026-10-17):
// what this file tests sits behind the buy button that gate hides.
vi.mock("@/lib/purchases-open", () => ({ purchasesOpen: () => true }));
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";
import { ReportBoundary } from "@/components/ReportBoundary";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { StickyBottomCTA } from "@/components/StickyBottomCTA";
import { FloatingHelpButton } from "@/components/FloatingHelpButton";

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = ".hidden{display:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}";
  document.head.appendChild(style);
});

describe("every file chooser on the uploader can be reached", () => {
  it("no file input is display:none", () => {
    const { container } = render(
      <MemoryRouter>
        <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} isLoading={false} />
      </MemoryRouter>,
    );
    const inputs = [...container.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    for (const input of inputs) {
      expect(getComputedStyle(input).display, input.accept).not.toBe("none");
      expect(input.getAttribute("aria-label"), input.accept).toBeTruthy();
    }
  });
});

describe("the report's crash notice", () => {
  const Boom = (): JSX.Element => { throw new Error("card shape drift"); };
  it("says to scan again, not to refresh, and a new result gets a fresh boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<ReportBoundary resultKey={1}><Boom /></ReportBoundary>);
    const notice = document.body.textContent ?? "";
    expect(notice).toMatch(/scan again/i);
    expect(notice).not.toMatch(/refresh/i);
    rerender(<ReportBoundary resultKey={2}><p>the next report</p></ReportBoundary>);
    expect(screen.getByText("the next report")).toBeTruthy();
  });

  it("the global fallback is drawn in the theme's colours", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).not.toMatch(/gray-\d/);
    expect(h1.closest("div.min-h-screen")?.className).toMatch(/\bbg-background\b/);
  });
});

describe("the sticky bar and the help button", () => {
  it("the help button moves above the bar while the bar shows, and back when it is dismissed", () => {
    render(<MemoryRouter><StickyBottomCTA /><FloatingHelpButton /></MemoryRouter>);
    const help = () => screen.getByRole("button", { name: /get help/i }).parentElement as HTMLElement;
    expect(help().className).toMatch(/\bbottom-6\b/);
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
      window.dispatchEvent(new Event("scroll"));
    });
    expect(help().className).toMatch(/\bbottom-28\b/);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(help().className).toMatch(/\bbottom-6\b/);
  });
});
