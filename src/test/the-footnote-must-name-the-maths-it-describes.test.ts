import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PERIOD_MULTIPLIER, detectPartTime } from "../../supabase/functions/_shared/salary-extract";

/**
 * TWO CLAIMS THAT WENT FALSE THE MOMENT THE CODE BEHIND THEM MOVED.
 *
 * 1. THE SALARY FOOTNOTE. /jobs published "hourly and monthly rates annualized
 *    (hourly ×2080)" in ten languages. Then the parser gained a day rate (×260)
 *    and a part-time guard that REFUSES to annualise a load-dependent rate at
 *    all — so a day-rate row entered the median at a multiplier the footnote
 *    never named, and part-time rows stopped entering it, under a sentence that
 *    still described only ×2080. The fix that made the numbers honest made the
 *    copy describing them dishonest. This is the project's recurring
 *    claim-drift shape, so the copy is pinned to the CONSTANTS rather than to
 *    a remembered value: change a multiplier and this test tells you which
 *    sentence to rewrite.
 *
 * 2. THE SKIP LINK'S TARGET. The site's skip link is the first focusable
 *    element and points at #main-content. Measured live 2026-08-25:
 *    `curl https://resumebooster.work/jobs` returned 200 and 10,598 bytes, in
 *    which "main-content" occurred EXACTLY ONCE — inside the skip link's own
 *    href. The only <main> was `<main class="pt-10 pb-20">`. The id is added by
 *    React, so the very first key a keyboard user presses did nothing for the
 *    whole 1.0-2.7s hydration window.
 *
 *    The existing guard asserted the id from Jobs.tsx SOURCE and stayed green
 *    the entire time. That is the defect this file exists to not repeat: the
 *    assertion below reads the prerender shell that produces the served bytes,
 *    and the built output when one is present.
 */
const ROOT = resolve(__dirname, "../..");
const SHELL = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
const EN = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8"));
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];

describe("the salary footnote names the maths it describes", () => {
  const basis = EN.jobsPage.salaryContextBasis as string;

  it("every multiplier the annualiser can apply is named in the copy", () => {
    // 52 and 12 are not asserted: week and month are not currently surfaced as
    // separate wording, and year is ×1. What must never drift silently is a
    // factor the reader would need in order to reproduce a published median.
    expect(basis).toContain(String(PERIOD_MULTIPLIER.hour));
    expect(basis, "a day multiplier exists but the footnote does not name it")
      .toContain(String(PERIOD_MULTIPLIER.day));
  });

  it("the refusal path is disclosed, because it changes the population", () => {
    // A part-time rate is now excluded from the annual figure entirely. A
    // median that silently drops rows is a different statistic from the one
    // the footnote used to describe.
    expect(detectPartTime({ title: "Substitute Teacher (Part Time)", description: null, employmentType: null }))
      .not.toBeNull();
    expect(basis.toLowerCase()).toMatch(/part-time|part time/);
  });

  it("every locale carries the same disclosure, not just English", () => {
    // The board serves ten languages. A correction applied only to en.json
    // leaves nine audiences reading the old promise.
    for (const l of LOCALES) {
      const j = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8"));
      const s = j.jobsPage?.salaryContextBasis as string | undefined;
      expect(s, `${l} has no salaryContextBasis`).toBeTruthy();
      expect(s, `${l} does not name the day multiplier`).toContain(String(PERIOD_MULTIPLIER.day));
      expect(s, `${l} does not name the hourly multiplier`).toContain(String(PERIOD_MULTIPLIER.hour));
    }
  });

  it("the hedged feed-health sentence exists in every locale too", () => {
    // Shipped as a new key alongside a fix that made it the ONLY branch
    // production takes; without the translations, nine locales would have
    // fallen back to English on the one line that renders every page.
    for (const l of LOCALES) {
      const j = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8"));
      expect(j.jobsPage?.sourcesDownAtLeast_one, `${l} missing sourcesDownAtLeast_one`).toBeTruthy();
      expect(j.jobsPage?.sourcesDownAtLeast_other, `${l} missing sourcesDownAtLeast_other`).toBeTruthy();
    }
  });
});

describe("the skip link has a target in the bytes actually served", () => {
  it("the prerender shell carries the id, not just the React tree", () => {
    // Raw HTML, so lowercase `tabindex` — `tabIndex` is JSX and would be
    // emitted verbatim as an unknown attribute.
    expect(SHELL).toMatch(/<main id="main-content" tabindex="-1"/);
  });

  it("the shell is the only <main> the prerenderer emits", () => {
    // If a second, un-idded <main> is added the skip link may land on the
    // wrong one — or on nothing, silently, exactly as before.
    const mains = SHELL.match(/<main[ >]/g) ?? [];
    expect(mains.length, `found ${mains.length} <main> tags in the shell`).toBe(1);
  });

  // Only meaningful after a build. Skipped rather than failed on a clean tree —
  // the shell assertion above already holds the contract.
  const built = resolve(ROOT, "dist/jobs/index.html");
  it.skipIf(!existsSync(built))("the built page's skip link resolves to a real element", () => {
    const html = readFileSync(built, "utf8");
    const href = /href="#([^"]+)"/.exec(html)?.[1];
    expect(href, "no fragment link found in the built page").toBeTruthy();
    expect(html, `skip link points at #${href} but no element carries that id`)
      .toMatch(new RegExp(`id="${href}"`));
  });
});
