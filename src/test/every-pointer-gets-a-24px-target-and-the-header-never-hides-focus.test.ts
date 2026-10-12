/**
 * EVERY POINTER GETS A 24PX TARGET, AND THE HEADER NEVER HIDES FOCUS.
 *
 * Reviews of 3ebdcbb2 (2026-10-12):
 *   - the token pass moved the 44px floor on <a>/<button> under (pointer:
 *     coarse) and left nothing for a mouse, so the legacy board pane's Share
 *     button measured 48x16.5 and its "Open there (prefilled, not sent)" link
 *     159.6x16.5 at 1280px: axe target-size (WCAG 2.5.8, AA) on /jobs?q=nurse,
 *     where the base build had none;
 *   - the header is fixed and nothing set scroll-padding-top, so Shift+Tab
 *     on /pricing at 375 scrolled the focused link to y 0..20 under a header
 *     ending at 57 (WCAG 2.4.11);
 *   - the phone override that held the legacy heroes' blur-[150px] orbs at
 *     50px was dropped with the old stylesheet.
 *
 * Held on the stylesheet itself (comments stripped). The rendered targets are
 * measured by axe in the after-audit; jsdom computes no layout.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The body of the first `selector-list { ... }` block, in any `@layer base`, whose selector list matches `needle`, outside any @media. */
function topLevelRule(needle: RegExp): string | null {
  for (let at = CSS.indexOf("@layer base"); at >= 0; at = CSS.indexOf("@layer base", at + 1)) {
    const found = ruleIn(CSS.slice(at), needle);
    if (found !== null) return found;
  }
  return null;
}
function ruleIn(base: string, needle: RegExp): string | null {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < base.length; i++) {
    const ch = base[i];
    if (ch === "{") {
      const selector = base.slice(start, i).trim();
      // depth 1 = directly inside @layer base, not inside @media.
      if (depth === 1 && needle.test(selector)) {
        const end = base.indexOf("}", i);
        return base.slice(i + 1, end);
      }
      depth++;
      start = i + 1;
    } else if (ch === "}") {
      depth--;
      start = i + 1;
      if (depth === 0) break;
    } else if (ch === ";" && depth >= 1) {
      start = i + 1;
    }
  }
  return null;
}

describe("target size by pointer", () => {
  it("every pointer: buttons, ARIA controls, selects and box links get at least 24px", () => {
    const body = topLevelRule(/\ba\[href\]/);
    expect(body, "no top-level base rule covers a[href]").not.toBeNull();
    expect(body).toMatch(/min-height:\s*24px/);
    const selector = CSS.match(/([^{};]*\ba\[href\][^{]*)\{/)![1];
    for (const s of ["button", '[role="button"]', '[role="menuitem"]', "select", "a[href]"]) expect(selector).toContain(s);
  });

  it("a coarse pointer: 44px for buttons, tabs, menu items and selects", () => {
    const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\}\s*\}/.exec(CSS);
    expect(coarse).not.toBeNull();
    expect(coarse![1]).toMatch(/min-height:\s*44px/);
    for (const s of ["button", '[role="button"]', '[role="tab"]', '[role="menuitem"]', "select"]) expect(coarse![1]).toContain(s);
  });
});

describe("the fixed header never covers what the browser scrolls to", () => {
  it("scroll-padding-top matches the header's height at each breakpoint (h-14, lg:h-16)", () => {
    const header = readFileSync(resolve(__dirname, "../components/Header.tsx"), "utf8");
    expect(header).toMatch(/\bh-14\b[^"]*\blg:h-16\b/);
    expect(CSS).toMatch(/html\s*\{[^}]*scroll-padding-top:\s*3\.5rem/);
    expect(CSS).toMatch(/@media\s*\(min-width:\s*1024px\)\s*\{\s*html\s*\{\s*scroll-padding-top:\s*4rem/);
  });
});

describe("the legacy heroes' blur stays phone-sized until they are cleaned", () => {
  it("a phone holds blur-[150px], blur-[100px] and blur-[80px] at 50px while any file still uses them", () => {
    const override = /@media\s*\(max-width:\s*767px\)\s*\{([^{}]*\{[^}]*\})/.exec(CSS);
    expect(override).not.toBeNull();
    for (const c of ["150px", "100px", "80px"]) expect(override![1]).toContain(`.blur-\\[${c}\\]`);
    expect(override![1]).toMatch(/filter:\s*blur\(50px\)/);
  });
});
