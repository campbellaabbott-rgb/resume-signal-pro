/**
 * THE REPORT'S SECTION NAV STICKS BELOW THE SITE HEADER, NOT UNDER IT
 * (register S13-056).
 *
 * SectionNav was "sticky top-0 z-30" while the site header is fixed at top 0,
 * z-40, h-14 (lg:h-16). The moment the nav stuck it sat entirely under the
 * header (navTop 0, navBottom 61, headerBottom 65 in a real browser) and the
 * report's only navigation vanished. It now sticks at the header's height,
 * class for class, and counts as stuck when it reaches the header's bottom
 * edge, not the top of the window.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SectionNav } from "@/components/scorecard/SectionNav";

Element.prototype.scrollIntoView = vi.fn();
const ROOT = resolve(__dirname, "../..");
const SECTIONS = [{ id: "section-overview", label: "Overview" }, { id: "section-fixes", label: "Fixes" }];

afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 375, width: 375, x: 0, y: top, toJSON() { return {}; } }) as DOMRect;

describe("where the nav sticks", () => {
  it("at the header's height, at every breakpoint the header changes height", () => {
    const header = readFileSync(resolve(ROOT, "src/components/Header.tsx"), "utf8");
    const row = /data-header-row className="([^"]+)"/.exec(header)?.[1] ?? "";
    const heights = row.split(/\s+/).filter((c) => /^(?:[a-z]+:)?h-\d+$/.test(c));
    expect(heights.length, "the header row names its heights").toBeGreaterThan(0);
    const { container } = render(<SectionNav sections={SECTIONS} />);
    const nav = container.firstElementChild as HTMLElement;
    const cls = new Set(nav.className.split(/\s+/));
    expect(cls.has("sticky")).toBe(true);
    expect(cls.has("top-0"), "the nav sticks under the fixed header").toBe(false);
    for (const h of heights) expect(cls.has(h.replace(/h-/, "top-")), `${h} on the header, no matching top on the nav`).toBe(true);
  });

  it("counts as stuck when it reaches the header's bottom edge", () => {
    const headerEl = document.createElement("header");
    headerEl.setAttribute("role", "banner");
    headerEl.getBoundingClientRect = () => rect(0, 56);
    document.body.appendChild(headerEl);
    const { container } = render(<SectionNav sections={SECTIONS} />);
    const nav = container.firstElementChild as HTMLElement;
    nav.getBoundingClientRect = () => rect(56, 48);
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(nav.className, "stuck below the header but drawn as not stuck").toMatch(/backdrop-blur/);
  });

  it("a jump lands the section below the header and the nav, not under them", () => {
    const headerEl = document.createElement("header");
    headerEl.setAttribute("role", "banner");
    headerEl.getBoundingClientRect = () => rect(0, 64);
    document.body.appendChild(headerEl);
    const target = document.createElement("div");
    target.id = "section-fixes";
    target.getBoundingClientRect = () => rect(900, 400);
    document.body.appendChild(target);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { container } = render(<SectionNav sections={SECTIONS} />);
    const nav = container.firstElementChild as HTMLElement;
    Object.defineProperty(nav, "offsetHeight", { value: 48, configurable: true });
    fireEvent.click(screen.getByText("Fixes"));
    const top = (scrollTo.mock.calls[0]?.[0] as ScrollToOptions | undefined)?.top ?? 0;
    // window.scrollY is 0 in jsdom: the section's top must clear 64 + 48.
    expect(900 - top).toBeGreaterThanOrEqual(64 + 48);
  });
});
