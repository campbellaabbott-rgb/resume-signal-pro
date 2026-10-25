/**
 * THE LEGACY BOARD FOLLOWS THE NEW HEADER AND PILL HEIGHTS.
 *
 * Regressions measured on 3ebdcbb2 (2026-10-12), headless chromium:
 *   - the header became h-14 under lg (64px before), but the board's sticky
 *     search row stayed `sticky top-16`, so at 375 and 768 a 7px strip between
 *     the two showed cards scrolling through (a card's "Apply" link was the
 *     element painted there); AccountNav carried the same top-16;
 *   - the industry row clipped to `sm:max-h-[44px]`, a figure measured when
 *     every button had a 44px floor; with that floor coarse-only the pills
 *     were 30px and the window showed a 6px sliver of the hidden second row,
 *     seven pills half-clipped (axe: partially obscured targets);
 *   - the orientation box's field pills arrive with the counts at ~2.3s and
 *     grew the box 145 -> 183px under the reader: /jobs CLS 0.063 -> 0.106.
 *     The after-audit traced the rest of that shift: on a desktop the board
 *     opens its first posting by itself ~1.4s in, which wrote it into the
 *     recent-jobs list and hid the "Try:" starting points (a 38px row) above
 *     the box, mid-visit. The row now asks the history as it stood on arrival.
 * Held on the source: jsdom computes no layout; the after-audit measures it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => codeOf(readFileSync(resolve(ROOT, f), "utf8"));
const JOBS = read("src/pages/Jobs.tsx");
const HEADER = read("src/components/Header.tsx");

describe("sticky rows sit exactly under the header", () => {
  it("the header is h-14 under lg and h-16 from lg", () => {
    expect(HEADER).toMatch(/className="container flex h-14 [^"]*\blg:h-16\b/);
  });

  it.each(["src/pages/Jobs.tsx", "src/components/account/AccountNav.tsx"])("%s offsets its sticky row by the same heights", (f) => {
    const src = read(f);
    expect(src, `${f} still pins a sticky row at 64px at every width`).not.toMatch(/\bsticky top-16\b/);
    expect(src).toMatch(/\bsticky top-14 lg:top-16\b/);
  });
});

describe("the industry row clips to its pills' own height", () => {
  it("the pills are 30px (44px under a finger) and the window matches each", () => {
    const row = /className=\{`min-w-0 flex-1 flex items-center[^`]*`\}/.exec(JOBS)?.[0] ?? "";
    expect(row, "the industry row moved: re-point this guard").not.toBe("");
    expect(row).not.toMatch(/max-h-\[44px\]/);
    expect(row).toMatch(/\bsm:max-h-\[30px\]/);
    expect(row).toMatch(/\bcoarse:sm:max-h-11\b/);
    const pill = /onClick=\{\(\) => setCategory\(category === c \? "" : c\)\}\s*className=\{`([^`$]*)/.exec(JOBS)?.[1] ?? "";
    expect(pill).toMatch(/\bh-\[30px\]/);
    expect(pill, "vertical padding would make the pill taller than its window").not.toMatch(/\bpy-/);
  });
});

describe("the orientation box does not grow when its counts arrive", () => {
  it("its pill row holds one row open before exactCats answers", () => {
    const box = JOBS.slice(JOBS.indexOf('t("jobsPage.orientSub"'));
    expect(box.slice(0, 600)).toMatch(/className="flex flex-wrap gap-2 mb-3 min-h-\[34px\]"/);
  });
});

describe("the first-visit starting points do not vanish when the board opens a posting itself", () => {
  it("the Try: row reads the recent-jobs count captured on arrival, not the live list", () => {
    expect(JOBS).toMatch(/const recentAtArrival = useRef\(recentJobs\.length\)\.current;/);
    const before = JOBS.slice(0, JOBS.indexOf('t("jobsPage.tryLabel"'));
    const cond = before.slice(before.lastIndexOf("&& ("), before.length).length < 400
      ? before.slice(Math.max(0, before.lastIndexOf("&& (") - 120))
      : "";
    expect(cond, "the Try: row's condition moved: re-point this guard").toMatch(/recentAtArrival === 0 && !q && activeBoardFilterKeys\(filterState\)\.length === 0/);
    expect(cond).not.toMatch(/recentJobs\.length === 0/);
  });
});
