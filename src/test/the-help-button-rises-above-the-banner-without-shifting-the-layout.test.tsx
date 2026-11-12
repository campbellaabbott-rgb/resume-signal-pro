/**
 * THE HELP BUTTON RISES ABOVE THE BANNER WITHOUT SHIFTING THE LAYOUT
 * (PERF-05, SEO/GEO audit 2026-11-07).
 *
 * The fixed help button rose above the analytics banner by margin-bottom
 * (and above the homepage's sticky bar by switching bottom-6 to bottom-28,
 * with a transition on bottom). The banner opens 2.5-3.9 s into every first
 * visit, so the lab recorded one layout shift of 0.019 on /, /jobs, a posting,
 * /pricing, /jobs/field/engineering and Domino's company page: a fifth of the
 * 0.1 CLS budget, and all of the field lander's CLS. A transform moves only
 * the pixels and no layout-shift score counts it. The button lands where it
 * did: above the banner by the banner's height, and above the bar by the
 * 5.5rem between bottom-28 and bottom-6.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FloatingHelpButton, STICKY_BAR_LIFT, helpButtonLift } from "@/components/FloatingHelpButton";
import { StickyBottomCTA } from "@/components/StickyBottomCTA";

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--consent-banner-h");
});

/** Tailwind's default spacing step: bottom-N is N quarter-rems. */
const rem = (step: number) => step / 4;

describe("the help button", () => {
  it("rests at bottom-6 and rises above the banner by a transform, never a margin or a bottom", () => {
    const { container } = render(<MemoryRouter><FloatingHelpButton /></MemoryRouter>);
    const box = container.querySelector<HTMLElement>("[data-floating-help]")!;
    expect(box.className).toMatch(/\bbottom-6\b/);
    expect(box.style.transform).toBe("translateY(calc(-1 * (var(--consent-banner-h, 0px) + 0px)))");
    expect(box.style.marginBottom).toBe("");
    expect(box.style.bottom).toBe("");
    // What animates is the transform; a transition on bottom or margin would animate layout.
    expect(box.className).toMatch(/\btransition-transform\b/);
    expect(box.className).not.toMatch(/transition-\[(?:bottom|margin)/);
  });

  it("keeps its layout box still while the banner opens and the sticky bar shows: only the transform changes", () => {
    const { container } = render(<MemoryRouter><StickyBottomCTA /><FloatingHelpButton /></MemoryRouter>);
    const box = container.querySelector<HTMLElement>("[data-floating-help]")!;
    const layout = () => ({ className: box.className, margin: box.style.marginBottom, bottom: box.style.bottom, top: box.style.top });
    const resting = layout();
    act(() => { document.documentElement.style.setProperty("--consent-banner-h", "172px"); });
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
      window.dispatchEvent(new Event("scroll"));
    });
    expect(layout()).toEqual(resting);
    expect(box.style.transform).toBe(helpButtonLift(true));
  });

  it("lands where bottom-28 put it above the sticky bar", () => {
    expect(STICKY_BAR_LIFT).toBe(`${rem(28) - rem(6)}rem`);
    expect(helpButtonLift(true)).toBe("translateY(calc(-1 * (var(--consent-banner-h, 0px) + 5.5rem)))");
    expect(helpButtonLift(false)).toBe("translateY(calc(-1 * (var(--consent-banner-h, 0px) + 0px)))");
  });
});
