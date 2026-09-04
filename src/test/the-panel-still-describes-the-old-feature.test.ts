import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BUTTON'S LABEL WENT ON DESCRIBING THE FEATURE IT USED TO BE.
 *
 * Before .24 a dropped résumé only RE-ORDERED the postings already loaded, and
 * the panel said so: "we'll rank the openings on this page against it". .24
 * changed the behaviour — the drop now reads the occupation out of the CV,
 * calls setQ, and lets the ordinary search retrieve from the whole corpus —
 * but the panel copy was not changed with it, in any of the nine locales.
 *
 * So the sentence a reader sees BEFORE dropping anything promised one page
 * while the feature searched 841k openings. It under-sold what it does, and it
 * misdescribed the mechanism. The toast AFTER the drop was already correct
 * ("finding {{role}} roles and ranking them by fit"), which is exactly how a
 * drift like this survives review: the accurate string and the stale one live
 * in the same file, and only one of them is read at the moment of the promise.
 *
 * This pins the LINK rather than the wording. Copy is a product decision and
 * should stay free to change; what must not happen again is the retrieval
 * behaviour and the sentence describing it moving apart. If the drop ever
 * stops calling setQ, this test stops requiring the claim — and if it keeps
 * calling it, no locale may go back to promising a single page.
 *
 * See also the claim-drift rule: a public sentence that names a number or a
 * scope has to move when the thing it describes moves.
 */
const ROOT = resolve(__dirname, "../..");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;

/** The phrase each locale used to scope the promise to the current page. */
const PAGE_SCOPED: Record<string, RegExp> = {
  "en": /on this page/i,
  "en-GB": /on this page/i,
  "de": /auf dieser Seite/i,
  "es": /de esta página/i,
  "fr": /de cette page/i,
  "hi": /इस पेज/,
  "nl": /op deze pagina/i,
  "pt": /desta página/i,
  "tl": /sa pahinang ito/i,
};

describe("the panel still describes the old feature", () => {
  it("the drop RETRIEVES — it sets the query from the résumé", () => {
    // The premise of everything below. If this ever goes red, the feature has
    // changed and the copy rule below should be revisited deliberately.
    expect(JOBS, "fit-terms is what reads the occupation out of the CV").toMatch(
      /action: "fit-terms", resumeText: text/,
    );
    // 2026-09-04: the retrieval moved into the shared `retrieveForResume` so
    // "For you" performs it too; the helper sets the query and RETURNS the
    // term, which is what the caller's copy then names.
    expect(JOBS, "and its first term becomes the query").toMatch(/setQ\(terms\[0\]\);/);
    expect(JOBS, "and the caller is told which term it searched, for the copy")
      .toMatch(/const searched = await retrieveForResume\(text\);/);
  });

  it("no locale promises only the openings already on the page", () => {
    for (const loc of LOCALES) {
      const j = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${loc}.json`), "utf8"));
      const copy = j?.jobsPage?.dropTitleScoped;
      expect(copy, `${loc} has no jobsPage.dropTitleScoped`).toBeTruthy();
      expect(
        copy,
        `${loc}: the panel scopes the promise to this page, but the drop searches the whole corpus`,
      ).not.toMatch(PAGE_SCOPED[loc]);
    }
  });

  it("the inline English fallback says the same thing as en.json", () => {
    // The fallback renders whenever i18n has not loaded, so a stale one is a
    // stale promise for exactly the readers on the slowest connections.
    const en = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8"));
    const fallback = /t\("jobsPage\.dropTitleScoped", "([^"]+)"\)/.exec(JOBS)?.[1];
    expect(fallback, "inline fallback for dropTitleScoped not found").toBeTruthy();
    expect(fallback).toBe(en.jobsPage.dropTitleScoped);
  });

  it("every locale still carries the post-drop toast that was already honest", () => {
    // dropParsedSearched names the role it searched for. It was correct before
    // this fix and must not be collateral damage of changing its neighbour.
    for (const loc of LOCALES) {
      const j = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${loc}.json`), "utf8"));
      expect(j?.jobsPage?.dropParsedSearched, `${loc} lost dropParsedSearched`).toMatch(/\{\{role\}\}/);
    }
  });
});
