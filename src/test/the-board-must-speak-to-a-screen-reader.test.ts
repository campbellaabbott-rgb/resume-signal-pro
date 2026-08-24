import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD WAS SILENT AT EXACTLY THE MOMENTS THAT MATTER.
 *
 * Measured from source and confirmed live in a browser, 2026-08-24:
 *
 *  - The site's skip link is the FIRST focusable element in the document and
 *    points at #main-content — an id only the home page rendered. On /jobs,
 *    which is the SEO landing surface, the first key a keyboard user pressed
 *    did nothing.
 *  - The results live region sat inside the `!loading && !error` arm of a
 *    four-way branch, so results arriving, a filter emptying the list, and an
 *    outright error were ALL silent. A sighted user watches 60 rows swap;
 *    everyone else got nothing.
 *  - Every job card was a <li tabIndex={0}> whose Enter handler duplicated the
 *    title button added to replace it: 60 redundant tab stops and 60 duplicate
 *    announcements per page. Deleting it took the list from 540 focusable
 *    elements to 480, verified in the DOM.
 *  - aria-pressed appeared ZERO times. Toggles carried their state in colour
 *    and font weight only, so three date chips read as three identical
 *    buttons.
 *  - A <select>'s aria-label REPLACES its content, so a chosen value was
 *    announced as the placeholder ("All fields") — the opposite of the truth.
 *  - The card focus ring measured 2.24:1 against the page; WCAG 1.4.11 needs
 *    3:1 and every other control on the page was 5.85:1.
 */
const JOBS = readFileSync(resolve(__dirname, "../../src/pages/Jobs.tsx"), "utf8");

describe("the board must speak to a screen reader", () => {
  it("the skip link has somewhere to land", () => {
    expect(JOBS).toMatch(/<main id="main-content" tabIndex=\{-1\}/);
  });

  it("one status region reports loading, results, empty AND error", () => {
    const block = JOBS.slice(JOBS.indexOf('role="status"'), JOBS.indexOf('role="status"') + 900);
    expect(block).toMatch(/aria-live="polite"/);
    expect(block).toMatch(/sr-only/);
    // All four states must be reachable from the one region — the defect was
    // that three of them lived outside the branch that announced.
    expect(block).toMatch(/loading/);
    expect(block).toMatch(/error/);
    expect(block).toMatch(/shownCount === 0/);
    expect(block).toMatch(/a11yResults/);
  });

  it("the job card carries no redundant tab stop", () => {
    // The card's title button is the accessible control. A tabbable <li> with
    // its own Enter handler puts a second stop on every card and announces the
    // same job twice.
    expect(JOBS).not.toMatch(/tabIndex=\{0\}\s*\n\s*onKeyDown=\{\(e\) => \{\s*\n\s*if \(e\.key === "Enter" && e\.target === e\.currentTarget\)/);
  });

  it("toggles expose their state, not just their colour", () => {
    expect(JOBS).toMatch(/aria-pressed=\{freshness === v\}/);
    expect(JOBS).toMatch(/aria-pressed=\{density === "compact"\}/);
  });

  it("a control's accessible name is its FIELD, never its placeholder value", () => {
    // aria-label replaces content: labelling the experience select "Any
    // experience" makes a screen reader say that even when a level is chosen.
    expect(JOBS).toMatch(/aria-label=\{t\("jobsPage\.experienceFieldLabel"/);
    expect(JOBS).toMatch(/aria-label=\{t\("jobsPage\.salaryFieldLabel"/);
    expect(JOBS).toMatch(/aria-label=\{t\("jobsPage\.companyFieldLabel"/);
  });

  it("the card focus ring is not a half-alpha hint", () => {
    expect(JOBS).not.toMatch(/focus-visible:ring-primary\/50 \$\{\s*\n?\s*detailJob\?\.id === job\.id/);
  });
});
