/**
 * THE ANALYTICS BANNER HIDES NO FOCUSED CONTROL, AND NO HEADLINE PAINTS
 * AFTER IT (review round of 2026-10-26).
 *
 *   - On a first visit the fixed banner (z-60, bottom of the screen) covered
 *     the controls keyboard focus landed on: 35 of 78 Tab stops on "/" at
 *     1280x800, 36 of 64 at 390x740, on /pricing too (WCAG 2.2 SC 2.4.11,
 *     Focus Not Obscured). While it is open, the page's scroll padding at the
 *     bottom is the banner's height, so a focused control scrolls clear of it.
 *   - Its body was one paragraph of about 30,000 px² at 375 px, larger than
 *     any block the new "/" bakes, so on a phone's first visit the Largest
 *     Contentful Paint waited for the JavaScript that renders the banner
 *     (5.6 s against 2.2 s under a slow 4G profile). The body is two
 *     paragraphs now, each smaller than the page's baked lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { CONSENT_EVENT } from "@/lib/consent";
import en from "@/i18n/locales/en.json";
import { HOME_H1_CLASS } from "@/lib/home/hero-classes";

vi.mock("@/lib/consent", async (orig) => ({ ...(await orig<typeof import("@/lib/consent")>()), analyticsConsent: () => "unset" }));

import { ConsentBanner } from "@/components/ConsentBanner";

let observed: Array<() => void> = [];
beforeEach(() => {
  observed = [];
  vi.stubGlobal("ResizeObserver", class {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; observed.push(() => cb()); }
    observe() {}
    unobserve() {}
    disconnect() { observed = observed.filter((f) => f !== this.cb); }
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const h = (this as HTMLElement).hasAttribute("data-consent-banner") ? 172 : 0;
    return { top: 0, bottom: h, height: h, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("scroll-padding-bottom");
});

describe("while the banner is open", () => {
  it("the page's bottom scroll padding is the banner's height, and it goes when the reader chooses", () => {
    render(<ConsentBanner />);
    expect(document.documentElement.style.scrollPaddingBottom).toBe("180px");
    act(() => { window.dispatchEvent(new Event(CONSENT_EVENT)); });
    expect(document.documentElement.style.scrollPaddingBottom).toBe("");
  });

  it("the body is two paragraphs, so neither is the page's largest painted block", () => {
    const { container } = render(<ConsentBanner />);
    const ps = [...container.querySelectorAll("[data-consent-banner] p")];
    const body = ps.find((p) => p.textContent?.includes(en.consent.body));
    const host = ps.find((p) => p.textContent?.includes(en.consent.host));
    expect(body, "the body paragraph").toBeTruthy();
    expect(host, "the host paragraph").toBeTruthy();
    expect(body).not.toBe(host);
  });
});

describe("the phone's largest baked block", () => {
  it("is the headline: its phone size starts at 30 px, so a 375 px first visit's LCP is the baked H1, not the banner", () => {
    // Measured 2026-10-26 (slow 4G, 4x CPU): with the banner split, its body
    // was 25,043 px² at 375 px against the baked "Posted in the last 7 days"
    // line's 24,563, so the LCP still waited 5.6 s for the banner's script.
    const m = /text-\[clamp\(([\d.]+)rem,([\d.]+)vw,([\d.]+)rem\)\]/.exec(HOME_H1_CLASS);
    expect(m, "the headline's phone size is a clamp").not.toBeNull();
    expect(Number(m![1]) * 16).toBeGreaterThanOrEqual(30);
    expect(Number(m![3])).toBe(2.25);
  });
});

