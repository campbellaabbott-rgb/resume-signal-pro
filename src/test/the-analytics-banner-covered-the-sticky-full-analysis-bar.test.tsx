/**
 * THE ANALYTICS BANNER COVERED THE STICKY FULL ANALYSIS BAR (2026-10-31).
 *
 * On the scanner page (/resume-checker), a first visit that scrolls past the
 * hero gets the sticky Full Analysis bar, fixed at the bottom of the screen,
 * while the analytics banner (also fixed at the bottom, z-60) still waits for
 * an answer. The banner sat on top of the bar, hiding its price, its button
 * and its dismiss control until the visitor chose.
 *
 * The banner already publishes its height as --consent-banner-h on <html>
 * while it is open (src/components/ConsentBanner.tsx), and the floating help
 * button rises by it. The bar now follows the same idiom: its bottom margin is
 * that height, 0 when no banner is open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })) },
}));
vi.mock("@/lib/consent", async (orig) => ({ ...(await orig<typeof import("@/lib/consent")>()), analyticsConsent: () => "unset" }));

import { ConsentBanner } from "@/components/ConsentBanner";
import { StickyBottomCTA } from "@/components/StickyBottomCTA";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const h = (this as HTMLElement).hasAttribute("data-consent-banner") ? 172 : 0;
    return { top: 0, bottom: h, height: h, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("scroll-padding-bottom");
  document.documentElement.style.removeProperty("--consent-banner-h");
  document.body.style.removeProperty("padding-bottom");
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

function scrollPastHero() {
  act(() => {
    Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("the sticky Full Analysis bar and the analytics banner", () => {
  it("the bar rises by the banner's height while the banner is open", () => {
    render(<ConsentBanner />);
    const { container } = render(<MemoryRouter><StickyBottomCTA /></MemoryRouter>);
    scrollPastHero();
    // The banner states its height on <html>...
    expect(document.documentElement.style.getPropertyValue("--consent-banner-h")).toBe("172px");
    // ...and the bar, fixed to the bottom of the screen, sits that far above it.
    expect(container.textContent, "the bar shows past the hero").toContain("Full Analysis");
    const bar = container.querySelector<HTMLElement>(".fixed.bottom-0");
    expect(bar, "the bar is fixed to the bottom of the screen").not.toBeNull();
    expect(bar!.style.marginBottom).toBe("var(--consent-banner-h, 0px)");
  });

  it("with no banner open the variable is unset, so the bar sits on the bottom edge", () => {
    const { container } = render(<MemoryRouter><StickyBottomCTA /></MemoryRouter>);
    scrollPastHero();
    expect(document.documentElement.style.getPropertyValue("--consent-banner-h")).toBe("");
    // The fallback is 0px: the margin never depends on the banner having mounted.
    expect(container.textContent, "the bar shows past the hero").toContain("Full Analysis");
    expect(container.querySelector<HTMLElement>(".fixed.bottom-0")!.style.marginBottom).toBe("var(--consent-banner-h, 0px)");
  });
});
