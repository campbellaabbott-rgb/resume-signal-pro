import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * TEN DISCLOSURES WERE EMITTED, TESTED, AND RENDERED BY NOTHING.
 *
 * `filterCoverage`, `intentFilters`, `salaryStatedOnly`, `locationExpandedFrom`,
 * `locationSearched`, `postedAfterUsesStatedDate`, `salaryFromQuery`,
 * `maxAgeClampedTo`, `companyMatched` and `exactWordMatch` were each spread
 * across all seven list exits of the job-board function. Several had their own
 * dedicated test. Every one of those tests asserted that the SERVER EMITS the
 * key — `expect(/salaryStatedOnly: true,/.test(BLK)).toBe(true)` — and not one
 * asked whether a human ever sees it. All of them passed for months while the
 * page said nothing.
 *
 * Measured 2026-08-22 against the LIVE board: a request with a salary floor
 * came back carrying `filterCoverage: {salaryFloor: 0.132, workMode: 0.296,
 * experience: 0.408}`. The data was arriving the whole time. The number that
 * tells a searcher "pay is stated on 13% of postings, so this filter can only
 * see an eighth of the board" was in the payload and never on the screen — and
 * without it a thin result set reads as a verdict on the market rather than on
 * the data.
 *
 * This is the same shape as the keyset cursor that returned null on every
 * response for five days under a guard asserting the identifier it read from,
 * and as the clustering top-up that had never once executed. The recurring
 * failure here is not broken code. It is code that is present, asserted, and
 * inert.
 *
 * SO THIS FILE ASSERTS THE WHOLE CHAIN, NOT ONE END OF IT:
 *   emitted by the function  ->  read by the client  ->  translated in all 9 locales
 *
 * It DISCOVERS the emitted set from the source rather than listing it, so a new
 * disclosure cannot be added silently. Adding one forces a choice: render it, or
 * name it in NOT_RENDERED with a reason. There is no third option that passes.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const LOCALE_DIR = resolve(ROOT, "src/i18n/locales");

/** Every .tsx/.ts under src/, excluding tests and the locale JSON. */
function clientSources(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "test" || e.name === "i18n" || e.name === "node_modules") continue;
        walk(p);
      } else if (/\.(tsx?|jsx?)$/.test(e.name)) {
        out.push(readFileSync(p, "utf8"));
      }
    }
  };
  walk(resolve(ROOT, "src"));
  return out.join("\n");
}
const SRC = clientSources();

/** The body of a named top-level function in the edge function. */
function bodyOf(name: string): string {
  const i = FN.indexOf(`function ${name}(`);
  if (i < 0) return "";
  const j = FN.indexOf("\n}", i);
  return FN.slice(i, j);
}

/**
 * Keys the server emits that are deliberately NOT rendered, each with the
 * reason. Anything not on this list must have a reader in src/.
 */
const NOT_RENDERED: Record<string, string> = {
  searchRoute: "telemetry — which retriever answered. Internal; a visitor has no use for it.",
  searchRouteReason: "telemetry, paired with searchRoute.",
  appliedSignature: "a cache token the client compares, not prose. Read as data, not shown.",
  searchId: "click-attribution id, sent back with the click. Never displayed.",
};

describe("a disclosure nobody renders is not a disclosure", () => {
  // Discovered, not listed — a new `out.foo = ...` in searchDisclosures is
  // picked up here automatically and must then be rendered or exempted.
  const discovered = [
    ...new Set([
      ...[...bodyOf("searchDisclosures").matchAll(/out\.(\w+)\s*=/g)].map((m) => m[1]),
      ...[...bodyOf("coverageDisclosure").matchAll(/\{ (\w+): out \}/g)].map((m) => m[1]),
      ...[...bodyOf("intentDisclosure").matchAll(/\{ (\w+): r\.labels \}/g)].map((m) => m[1]),
    ]),
  ];

  it("finds the disclosure helpers at all", () => {
    // If these are renamed, every assertion below silently passes on an empty
    // set. That is exactly the failure mode this file exists to catch, so the
    // discovery itself is asserted first.
    expect(bodyOf("searchDisclosures"), "searchDisclosures not found").not.toBe("");
    expect(bodyOf("coverageDisclosure"), "coverageDisclosure not found").not.toBe("");
    expect(bodyOf("intentDisclosure"), "intentDisclosure not found").not.toBe("");
    expect(discovered.length, "no disclosure keys discovered — the regexes have rotted").toBeGreaterThanOrEqual(6);
    expect(discovered).toContain("filterCoverage");
    expect(discovered).toContain("intentFilters");
    expect(discovered).toContain("maxAgeClampedTo");
  });

  it("every disclosure the server emits is READ by the client", () => {
    const mute = discovered.filter((k) => !(k in NOT_RENDERED) && !SRC.includes(k));
    expect(
      mute,
      `emitted by the edge function and read by nothing in src/: ${mute.join(", ")}. ` +
        "Render it, or add it to NOT_RENDERED with a reason. An emitter with no reader " +
        "is the defect this file was written for.",
    ).toEqual([]);
  });

  it("the hand-wired disclosures are read too", () => {
    // These are spread inline at their exits rather than through a helper, so
    // discovery cannot see them. Listed explicitly, and each must have a reader.
    for (const k of ["salaryStatedOnly", "companyMatched", "exactWordMatch", "countCapped", "ignoredFilters"]) {
      // `${k}:` OR the shorthand `{ ${k} }` — both are emits.
      const emitted = FN.includes(`${k}:`) || new RegExp(`\\{ ${k} \\}`).test(FN);
      expect(emitted, `${k} is no longer emitted — drop it from this list`).toBe(true);
      expect(SRC.includes(k), `${k} is emitted but nothing in src/ reads it`).toBe(true);
    }
  });

  it("renders filterCoverage as a percentage a person can act on", () => {
    // The one that matters most. A bare fraction (0.132) on screen is worse than
    // nothing; it must be converted, and it must carry the sentence explaining
    // that unstated is not the same as absent.
    expect(SRC).toMatch(/filterCoverage/);
    expect(SRC).toMatch(/Math\.round\(\s*fc\.salaryFloor \* 100\s*\)/);
    expect(SRC).toMatch(/jobsPage\.filterCoverage/);
  });

  it("every new disclosure string exists in all nine locales", () => {
    const keys = [
      "droppedTerms", "filterCoverage", "coveragePay", "coverageWorkMode", "coverageExperience",
      "intentFilters", "salaryStatedOnly", "locationExpanded", "salaryFromQuery",
      "maxAgeClamped", "postedAfterStatedDate", "companyMatched", "exactWordMatch",
    ];
    const langs = readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json"));
    expect(langs.length, "expected nine locale files").toBe(9);
    for (const f of langs) {
      const jp = JSON.parse(readFileSync(resolve(LOCALE_DIR, f), "utf8")).jobsPage ?? {};
      const missing = keys.filter((k) => typeof jp[k] !== "string" || !jp[k].trim());
      expect(missing, `${f} is missing jobsPage keys: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("no locale silently keeps the English string for a translated locale", () => {
    // A copy-paste of the English default into de.json renders English to a
    // German reader while passing every parity check. Compare against en.
    const en = JSON.parse(readFileSync(resolve(LOCALE_DIR, "en.json"), "utf8")).jobsPage;
    const keys = ["filterCoverage", "intentFilters", "salaryStatedOnly", "postedAfterStatedDate"];
    for (const f of ["de.json", "es.json", "fr.json", "nl.json", "pt.json", "hi.json", "tl.json"]) {
      const jp = JSON.parse(readFileSync(resolve(LOCALE_DIR, f), "utf8")).jobsPage;
      const untranslated = keys.filter((k) => jp[k] === en[k]);
      expect(untranslated, `${f} still holds the English text for: ${untranslated.join(", ")}`).toEqual([]);
    }
  });

  it("keeps the interpolation placeholders identical across locales", () => {
    // A {{pct}} that becomes {{prozent}} in de renders a literal brace pair.
    const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
    const en = JSON.parse(readFileSync(resolve(LOCALE_DIR, "en.json"), "utf8")).jobsPage;
    const keys = [
      "droppedTerms", "filterCoverage", "coveragePay", "coverageWorkMode", "coverageExperience",
      "intentFilters", "locationExpanded", "salaryFromQuery", "maxAgeClamped", "companyMatched", "exactWordMatch",
    ];
    for (const f of readdirSync(LOCALE_DIR).filter((x) => x.endsWith(".json"))) {
      const jp = JSON.parse(readFileSync(resolve(LOCALE_DIR, f), "utf8")).jobsPage;
      for (const k of keys) {
        expect(ph(jp[k]), `${f} :: jobsPage.${k} placeholders differ from en`).toBe(ph(en[k]));
      }
    }
  });

  it("disclosures render on an EMPTY page too — the case that needs them most", () => {
    // They all used to sit in the results branch of
    //   jobs.length === 0 ? (zero state) : (results ...disclosures)
    // so a search returning nothing explained nothing. Verified in a browser
    // before the fix: q + salaryFloor=300000 with zero rows rendered no coverage
    // line at all. "Pay is stated on 13% of postings" is ADVICE on an empty page
    // and trivia on a full one, and it was showing only on the full one.
    const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
    const split = JOBS.indexOf(") : jobs.length === 0 ? (");
    expect(split, "the results/empty split moved — re-point this guard").toBeGreaterThan(0);
    for (const key of [
      "jobsPage.filterCoverage", "jobsPage.intentFilters", "jobsPage.salaryStatedOnly",
      "jobsPage.droppedTerms", "jobsPage.ignoredFilters", "jobsPage.locationExpanded",
      "jobsPage.salaryFromQuery", "jobsPage.maxAgeClamped", "jobsPage.postedAfterStatedDate",
      "jobsPage.companyMatched", "jobsPage.exactWordMatch",
    ]) {
      const at = JOBS.indexOf(key);
      expect(at, `${key} is not rendered at all`).toBeGreaterThan(0);
      expect(
        at,
        `${key} renders AFTER the jobs.length === 0 split, so it is invisible on an ` +
          "empty result page — the moment a searcher most needs to be told why.",
      ).toBeLessThan(split);
    }
  });

  it("no board string exists only as an inline English default", () => {
    // PARITY CANNOT CATCH THIS, WHICH IS WHY IT SURVIVED.
    // The i18n parity test compares the nine locale files against each other. A
    // key present in ZERO of them is in perfect parity — and renders its inline
    // English default to a German, Spanish, French, Hindi, Dutch, Portuguese or
    // Filipino reader. Twenty keys were in that state, including the apply
    // agent's price and the sentence describing what it will not do.
    //
    // So the check has to run the other way: from the CALL SITES to the files.
    const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
    const en = JSON.parse(readFileSync(resolve(LOCALE_DIR, "en.json"), "utf8"));
    const lookup = (key: string) => key.split(".").reduce<unknown>(
      (cur, part) => (cur && typeof cur === "object" && part in (cur as Record<string, unknown>))
        ? (cur as Record<string, unknown>)[part]
        : undefined,
      en,
    );
    // The negative lookbehind keeps `p.set("remote", "1")` out — it ends in the
    // same two characters as a t() call and would otherwise read as one.
    const calls = [...JOBS.matchAll(/(?<![A-Za-z0-9_.])t\(\s*"(jobsPage\.[A-Za-z0-9_.]+)"\s*,\s*"/g)].map((m) => m[1]);
    expect(calls.length, "no t() calls found — the matcher has rotted").toBeGreaterThan(50);
    // A COUNTED string resolves through i18next's plural suffixes and has NO
    // bare key — that is the correct shape, not a gap. Accept either form.
    const resolves = (k: string) =>
      typeof lookup(k) === "string" ||
      (typeof lookup(`${k}_other`) === "string" && typeof lookup(`${k}_one`) === "string");
    const orphans = [...new Set(calls)].filter((k) => !resolves(k));
    expect(
      orphans,
      "these render an inline English default to every non-English visitor because no " +
        `locale file has the key: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("the intent lift does not strip a phrase whose filter will be discarded", () => {
    // q="work from home nurse" with workMode=onsite used to delete the phrase
    // from the query AND have its remote:true dropped by the precedence in
    // filters.ts, then report intentFilters:["work from home"] anyway — the
    // words removed from the search, the filter thrown away, and the response
    // asserting both had been applied. The guard has to know that workMode
    // speaks for remote.
    expect(FN).toMatch(/const INTENT_CONFLICTS: Record<string, string\[\]> = \{/);
    expect(FN).toMatch(/remote: \["remote", "workMode"\]/);
    expect(FN).toMatch(/maxAgeDays: \["maxAgeDays", "postedAfter"\]/);
    expect(FN).toMatch(/INTENT_CONFLICTS\[k\] \?\? \[k\]/);
  });
});
