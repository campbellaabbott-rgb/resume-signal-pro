/**
 * THE HOMEPAGE LIST GIVES BACK THE SPACE NO ROW USES, WHEN NOBODY CAN SEE IT
 * MOVE (review round of 2026-10-26).
 *
 * The list reserves its box before any row arrives (review P24) and packs the
 * rows that fit whole. At the commonest phone widths three rows fit and the
 * fourth misses by a few pixels, so the box ended with a blank hole of
 * 150-170 px above the total line. packRows now shrinks the box to its last
 * row when the box's new bottom is still at or below the fold: everything
 * under the list is off screen before and after, so nothing the reader sees
 * moves (no layout shift). When the reader can see the box's end (they
 * scrolled before the rows came, or the list sits high on a tall screen), the
 * reserved box stays, as P24 requires.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { packRows } from "@/lib/home/list-box";

const RESERVED = 544;

/** A list whose top sits at `top` with rows of the given heights and 8 px gaps. */
function list(top: number, heights: number[]) {
  const ul = document.createElement("ul");
  document.body.appendChild(ul);
  let y = top;
  for (const h of heights) {
    const li = document.createElement("li");
    const rowTop = y;
    li.getBoundingClientRect = () => ({ top: rowTop, bottom: rowTop + h, height: h, left: 0, right: 300, width: 300, x: 0, y: rowTop, toJSON: () => ({}) }) as DOMRect;
    ul.appendChild(li);
    y += h + 8;
  }
  ul.getBoundingClientRect = () => ({ top, bottom: top + RESERVED, height: RESERVED, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
    if (el === ul) return { minHeight: ul.style.minHeight || `${RESERVED}px` } as CSSStyleDeclaration;
    return real(el);
  });
  return ul;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("packRows", () => {
  it("below the fold, three rows that fit leave no hole: the box ends at the last row", () => {
    Object.defineProperty(window, "innerHeight", { value: 812, configurable: true });
    const ul = list(740, [120, 124, 122, 160, 130]);
    expect(packRows(ul)).toBe(3);
    const lastBottom = 120 + 8 + 124 + 8 + 122;
    expect(ul.style.minHeight).toBe(`${lastBottom}px`);
    expect(RESERVED - lastBottom).toBeGreaterThan(150);
  });

  it("where the reader can see the box's end, the reserved box stays (nothing below may move)", () => {
    Object.defineProperty(window, "innerHeight", { value: 812, configurable: true });
    const ul = list(120, [120, 124, 122, 160, 130]);
    expect(packRows(ul)).toBe(3);
    expect(ul.style.minHeight).toBe("");
  });

  it("a gap of one row gap or less is left as it is", () => {
    Object.defineProperty(window, "innerHeight", { value: 812, configurable: true });
    const ul = list(740, [130, 130, 130, 130]);
    expect(packRows(ul)).toBe(4);
    expect(RESERVED - (4 * 130 + 3 * 8)).toBeLessThanOrEqual(8);
    expect(ul.style.minHeight).toBe("");
  });

  it("a re-pack (a resize, the fonts landing) measures against the reserved box again", () => {
    Object.defineProperty(window, "innerHeight", { value: 812, configurable: true });
    const ul = list(740, [120, 124, 122, 160, 130]);
    packRows(ul);
    expect(ul.style.minHeight).not.toBe("");
    Object.defineProperty(window, "innerHeight", { value: 2000, configurable: true });
    expect(packRows(ul)).toBe(3);
    expect(ul.style.minHeight).toBe("");
  });
});
