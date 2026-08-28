import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * EVERY COLUMN ON THIS BOARD IS POPULATED AND ALMOST NONE OF IT IS REACHABLE.
 *
 * Measured on the live board, 2026-08-25, over 559,805 servable rows:
 *
 *   experience_band   559,805 non-null, but 318,607 of those are "unspecified"
 *                     -> 241,198 usable (43.1%): entry 63,961, mid 62,329,
 *                     senior 69,261, expert 45,647
 *   department        226,631 (40.5%)
 *   min_years         162,032 (28.9%)
 *   work_mode         157,584 (28.1%)
 *   salary_min_annual 112,524 (20.1%)
 *   salary_max_annual  87,001 (15.5%)
 *   salary_period      59,505 (10.6%) -> hour 41,542, year 17,312, month 627
 *
 * A visitor could reach exactly two of those: work mode and experience. The
 * rest were populated, indexed, and invisible.
 *
 * AND FOUR FILTERS THE API ALREADY ACCEPTED WERE THROTTLED BY THE PAGE, not by
 * the server:
 *
 *   experience   — filters.ts `asBands` has taken an array or a comma string
 *                  since the day it was written; the page sent one value.
 *   companies    — the server slices an ARRAY to companyTokenLimit and names
 *                  what it drops; the typeahead REPLACED the selection with one
 *                  token, so a multi-employer scope existed in the URL, in the
 *                  state shape, and in the request contract — and in no control.
 *   maxAgeDays   — the server takes 1..30 and clamps above that with a notice.
 *                  The page offered two of the thirty (1 and 7).
 *   salaryFloor  — any number, with no ceiling control at all, so a band was
 *                  one-sided.
 *
 * The country facet was the other half of the same story. get_country_facet
 * returned error 57014 on 10 of 10 calls (3.20-3.32s) on 2026-08-08, so the
 * page fell back to deriving countries from the rows on screen. Re-measured
 * against production on 2026-08-25 it answers in 0.49s: US 253,609 / GB 20,625
 * / CA 19,220 / IN 14,568 / DE 11,413. The comment claiming a permanent failure
 * had outlived the failure, and it was hiding twenty countries with real counts
 * behind a fallback that knows no counts at all.
 *
 * Departments were sampled the same day across q=nurse/engineer/sales: 79 of
 * 120 rows carried one, written however the employer writes it — "Engineering",
 * "Nursing", "Sales", but also "680 - Engineering - CoreSuite Platform" and
 * "Sycamore Senior Living (SCL) - 6032". That is why the control is a substring
 * box and not a dropdown.
 *
 * These assertions CALL the page's filter derivation rather than grepping for
 * it. A guard that greps source passes while the code is dead, which has caught
 * this repo nine times; the source assertions that remain are the ones with no
 * importable surface, and they read comment-stripped text for the same reason.
 */
import { boardFilterBody, activeBoardFilterKeys, type BoardFilterState } from "../pages/Jobs";

const root = resolve(__dirname, "../..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const JOBS = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");
const JOBS_CODE = strip(JOBS);
const LOCALES = resolve(root, "src/i18n/locales");
const LOCALE_FILES = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));

/** Nothing switched on. Every assertion below starts from here and turns on one thing. */
const OFF: BoardFilterState = {
  q: "", location: "", remoteOnly: false, workMode: "", category: "", inclUncat: false,
  agentOnly: false, country: "", experience: "", companyTokens: [], salaryFloor: 0,
  salaryCeiling: 0, payBasis: "", statedPayOnly: false, includeUnstatedPay: false, maxYears: 0, department: "",
  vendor: "", freshness: "",
};

describe("a filter the API takes and the page cannot send", () => {
  it("an untouched board sends no filter at all", () => {
    // The client's isUnfiltered: keys are DELETED rather than left undefined, so
    // the emptiness of this object is what "unfiltered" means here.
    expect(boardFilterBody(OFF)).toEqual({});
    expect(activeBoardFilterKeys(OFF)).toEqual([]);
  });

  it("each of the six new filters reaches the wire under its contract name", () => {
    // The names are the API's, not the page's: `hasStatedPay` for the checkbox
    // called "States pay", `vendor` (singular) for the multi-select, `maxYears`
    // for a control labelled in years. A page-side spelling would be a filter
    // the server silently ignores, which is the one thing this board forbids.
    expect(boardFilterBody({ ...OFF, payBasis: "hourly" })).toEqual({ payBasis: "hourly" });
    expect(boardFilterBody({ ...OFF, payBasis: "salaried" })).toEqual({ payBasis: "salaried" });
    expect(boardFilterBody({ ...OFF, statedPayOnly: true })).toEqual({ hasStatedPay: true });
    expect(boardFilterBody({ ...OFF, salaryCeiling: 120_000 })).toEqual({ salaryCeiling: 120_000 });
    expect(boardFilterBody({ ...OFF, maxYears: 3 })).toEqual({ maxYears: 3 });
    expect(boardFilterBody({ ...OFF, department: "nursing" })).toEqual({ department: "nursing" });
    expect(boardFilterBody({ ...OFF, vendor: "greenhouse,lever" })).toEqual({ vendor: "greenhouse,lever" });
  });

  it("hasStatedPay is a LITERAL true, never a truthy value", () => {
    // Same contract as sendableOnly and includeUncategorised: the server takes
    // `=== true`, so a truthy string would evaporate and narrow nothing while
    // the chip on screen says the board is restricted to the 20.1% that publish
    // a figure.
    expect(boardFilterBody({ ...OFF, statedPayOnly: true }).hasStatedPay).toBe(true);
    expect("hasStatedPay" in boardFilterBody({ ...OFF, statedPayOnly: false })).toBe(false);
  });

  it("a ceiling under the floor is still SENT, so the server can name it", () => {
    // normalizeFilters refuses this pair and reports "salaryCeiling" in
    // ignoredFilters. Quietly correcting it here — clamping, or dropping the
    // ceiling — would leave the visitor looking at a band the board never
    // applied with nothing on screen saying so.
    const body = boardFilterBody({ ...OFF, salaryFloor: 150_000, salaryCeiling: 60_000 });
    expect(body.salaryFloor).toBe(150_000);
    expect(body.salaryCeiling).toBe(60_000);
  });

  it("an off control sends nothing, not a null", () => {
    // A `salaryCeiling: null` on the wire is a request the server has to decide
    // about; an absent key is not a request at all. The distinction is what
    // keeps `Object.keys()` usable as the filtered/unfiltered test.
    for (const on of [
      { payBasis: "" }, { statedPayOnly: false }, { salaryCeiling: 0 },
      { maxYears: 0 }, { department: "" }, { vendor: "" }, { freshness: "" },
    ] as Array<Partial<BoardFilterState>>) {
      expect(boardFilterBody({ ...OFF, ...on })).toEqual({});
    }
  });

  it("whitespace typed into the department box is not a filter", () => {
    // The box is a free-text ILIKE. A stray space would bind '% %' and narrow
    // the board to whatever happens to contain one.
    expect(boardFilterBody({ ...OFF, department: "   " })).toEqual({});
    expect(boardFilterBody({ ...OFF, department: "  Nursing " })).toEqual({ department: "Nursing" });
  });
});

describe("the four filters the page was throttling", () => {
  it("experience goes out as the comma list the server has always accepted", () => {
    expect(boardFilterBody({ ...OFF, experience: "senior,expert" }))
      .toEqual({ experience: "senior,expert" });
    // One band still looks exactly like the old single-select request, so every
    // ?experience=entry link Explore has ever minted behaves identically.
    expect(boardFilterBody({ ...OFF, experience: "entry" })).toEqual({ experience: "entry" });
  });

  it("the experience control is the multi-select, capped at the number of bands", () => {
    // No importable surface: this is JSX. Read stripped, so a comment mentioning
    // MultiSelectFilter cannot stand in for using it.
    const block = JOBS_CODE.slice(
      JOBS_CODE.indexOf('aria-label={t("jobsPage.experienceFieldLabel"'),
      JOBS_CODE.indexOf('aria-label={t("jobsPage.experienceFieldLabel"') + 1400,
    );
    expect(block).toMatch(/<MultiSelectFilter/);
    expect(block).toMatch(/value=\{experience\}/);
    expect(block).toMatch(/onChange=\{setExperience\}/);
    expect(block).toMatch(/max=\{EXPERIENCE_IDS\.length\}/);
    // The old shape, which could only ever send one band.
    expect(JOBS_CODE).not.toMatch(/onChange=\{\(e\) => setExperience\(e\.target\.value\)\}/);
  });

  it("companies accumulate instead of replacing each other", () => {
    expect(boardFilterBody({ ...OFF, companyTokens: ["oscar", "cigna", "elevance"] }))
      .toEqual({ companies: ["oscar", "cigna", "elevance"] });
    // The typeahead must ADD, and both of its commit paths — Enter and click —
    // must go through the same one. `setCompany(<token>)` as a bare replacement
    // is the throttle this removes.
    expect(JOBS_CODE).toMatch(/const toggleCompanyToken = useCallback\(/);
    // Both commit paths: Enter on the highlighted option, and the click.
    expect((JOBS_CODE.match(/toggleCompanyToken\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(JOBS_CODE).not.toMatch(/setCompany\(opts\[companyIdx\]\.token\)/);
    expect(JOBS_CODE).not.toMatch(/onMouseDown=\{\(\) => \{ setCompany\(c\.token\)/);
  });

  it("the date window is any of the thirty days the API takes", () => {
    for (const d of ["1", "3", "7", "14", "30"]) {
      expect(boardFilterBody({ ...OFF, freshness: d })).toEqual({ maxAgeDays: Number(d) });
    }
    // The chip row must offer more than the two it had. Counted on stripped
    // source so the step list has to be real markup.
    const chips = JOBS_CODE.slice(
      JOBS_CODE.indexOf('t("jobsPage.freshAll"'),
      JOBS_CODE.indexOf('aria-pressed={freshness === v}'),
    );
    for (const key of ["freshDay", "fresh3", "freshWeek", "fresh14", "fresh30"]) {
      expect(chips, `the ${key} step is missing from the window chips`).toContain(`jobsPage.${key}`);
    }
  });

  it("a link minted before the window became a number still filters", () => {
    // ?fresh=day and ?fresh=week are on every shared link, every bookmark and
    // every Explore destination older than today. Dropping them would reproduce
    // exactly the defect this param already has a comment about: the control
    // works, the address bar round-trips, and the board comes back unfiltered.
    const reader = JOBS_CODE.slice(
      JOBS_CODE.indexOf('const [freshness, setFreshness]'),
      JOBS_CODE.indexOf('const [freshness, setFreshness]') + 500,
    );
    expect(reader).toMatch(/f === "day" \|\| f === "week" \? f : ""/);
    expect(reader).toMatch(/legacy === "day" \? "1" : "7"/);
    expect(reader).toMatch(/n >= 1 && n <= 30/);
  });

  it("nothing still sets the window to a word", () => {
    // The state carried "day" and "week" and now carries a day COUNT, and the
    // type is `string` because the URL may legitimately hand it any of 1..30.
    // That means the compiler cannot catch a caller left on the old spelling —
    // and three of them were: two preset buttons and the welcome card's "posted
    // today". `Number("week")` is NaN, so each of those quietly set the window
    // to nothing while the chip lit up.
    const bad = (JOBS_CODE.match(/setFreshness\("(?!\d+"|")[^"]*"\)/g) ?? []);
    expect(bad, `setFreshness called with a non-numeric window: ${bad.join(", ")}`).toEqual([]);
    expect((JOBS_CODE.match(/setFreshness\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("the pay band has both ends", () => {
    expect(boardFilterBody({ ...OFF, salaryFloor: 80_000, salaryCeiling: 150_000 }))
      .toEqual({ salaryFloor: 80_000, salaryCeiling: 150_000 });
    const pay = JOBS_CODE.slice(
      JOBS_CODE.indexOf('aria-label={t("jobsPage.salaryFieldLabel"'),
      JOBS_CODE.indexOf('aria-label={t("jobsPage.payBasisFieldLabel"'),
    );
    expect(pay, "the ceiling must sit beside the floor, as one band").toMatch(/setSalaryCeiling\(/);
  });
});

describe("one derivation, and everything downstream reads it", () => {
  it("Remote has ONE definition and it is the strict-subset-safe one", () => {
    // remote=true is a strict subset of work_mode='remote', so sending both ANDs
    // them and drops 7.6% of {workMode:remote,country:GB}. Four call sites used
    // to spell this and the rescue probe had already spelled it differently.
    expect(boardFilterBody({ ...OFF, remoteOnly: true })).toEqual({ remote: true });
    expect(boardFilterBody({ ...OFF, remoteOnly: true, workMode: "remote" }))
      .toEqual({ workMode: "remote" });
    expect(boardFilterBody({ ...OFF, remoteOnly: true, workMode: "hybrid" }))
      .toEqual({ workMode: "hybrid" });
  });

  it("the unsorted opt-in means nothing without a field", () => {
    expect(boardFilterBody({ ...OFF, inclUncat: true })).toEqual({});
    expect(boardFilterBody({ ...OFF, category: "design", inclUncat: true }))
      .toEqual({ category: "design", includeUncategorised: true });
  });

  it("activeBoardFilterKeys picks up a new field mechanically", () => {
    // The client's twin of isUnfiltered(): derived from the body rather than
    // hand-listed, so the badge on the mobile Filters button counts a filter the
    // moment it exists. This is the assertion that fails if a seventh filter is
    // added and this derivation is bypassed.
    for (const [label, on] of [
      ["payBasis", { payBasis: "hourly" }],
      ["hasStatedPay", { statedPayOnly: true }],
      ["salaryCeiling", { salaryCeiling: 90_000 }],
      ["maxYears", { maxYears: 5 }],
      ["department", { department: "legal" }],
      ["vendor", { vendor: "ashby" }],
      ["maxAgeDays", { freshness: "14" }],
      ["experience", { experience: "senior,expert" }],
      ["companies", { companyTokens: ["oscar", "cigna"] }],
    ] as Array<[string, Partial<BoardFilterState>]>) {
      expect(activeBoardFilterKeys({ ...OFF, ...on }), `${label} is invisible to the filter count`)
        .toEqual([label]);
    }
  });

  it("the search box is not counted, and a widening toggle is not a narrowing", () => {
    expect(activeBoardFilterKeys({ ...OFF, q: "nurse" })).toEqual([]);
    expect(activeBoardFilterKeys({ ...OFF, category: "design", inclUncat: true }))
      .toEqual(["category"]);
  });

  it("every board call derives its body here", () => {
    // Five hand-built bodies is five chances for one of them to be missing the
    // filter the visitor can see on screen — the list, the filtered-category
    // facet, the zero-result rescue probe and the disclosure denominator.
    expect((JOBS_CODE.match(/boardFilterBody\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // The rescue probe relaxes STATE and re-derives, so a relaxation cannot
    // describe a different query from the page it is rescuing.
    expect(JOBS_CODE).toMatch(/const RELAX: Record<string, Partial<BoardFilterState>>/);
    expect(JOBS_CODE).toMatch(/boardFilterBody\(\{ \.\.\.filterState, \.\.\.RELAX\[c\.key\] \}\)/);
  });

  it("every filter chip has a relaxation and a chip of its own", () => {
    // "Clear all" is `activeFilters.forEach(f => f.clear())`, so that array IS
    // the definition of what a filter is on this page. A filter with no chip
    // survives Clear all and narrows the board invisibly — which is exactly what
    // agentOnly, inclUncat and activelyHiring each did.
    const chipBlock = JOBS_CODE.slice(
      JOBS_CODE.indexOf("const activeFilters = useMemo("),
      JOBS_CODE.indexOf("// S1: search suggestions"),
    );
    const relaxBlock = JOBS_CODE.slice(
      JOBS_CODE.indexOf("const RELAX: Record<string, Partial<BoardFilterState>>"),
      JOBS_CODE.indexOf("const candidates = activeFilters.slice(0, 4);"),
    );
    expect(chipBlock.length, "the chip array did not parse").toBeGreaterThan(400);
    expect(relaxBlock.length, "the relaxation table did not parse").toBeGreaterThan(200);
    for (const key of [
      "experience", "maxYears", "salaryFloor", "salaryCeiling", "payBasis",
      "statedPay", "department", "vendor", "freshness", "agentOnly",
    ]) {
      expect(chipBlock, `${key} narrows the board with no chip`).toContain(`key: "${key}"`);
      expect(relaxBlock, `${key} has no relaxation, so its rescue button re-counts the same zero`)
        .toContain(`${key}: {`);
    }
  });

  it("every new filter is WRITTEN to the URL, not only read from it", () => {
    // Read-but-never-written has produced this bug three times on this page
    // (fresh, sort, activelyHiring): the control works, the address bar loses
    // it, and a reload or a shared link serves an unfiltered board under a chip
    // that still claims to be on.
    for (const [param, guard] of [
      ["salaryCeiling", "salaryCeiling"],
      ["payBasis", "payBasis"],
      ["statedPay", "statedPayOnly"],
      ["maxYears", "maxYears"],
      ["department", "department"],
      ["vendor", "vendor"],
    ]) {
      expect(JOBS_CODE, `?${param}= is never written back`).toMatch(
        new RegExp(`if \\(${guard}\\) p\\.set\\("${param}"`),
      );
      expect(JOBS_CODE, `?${param}= is never read on mount`).toContain(`initial.get("${param}")`);
    }
  });

  it("a lander URL cannot swallow one of the new filters", () => {
    // /jobs/company/:token and /jobs/field/:slug carry no query string, so
    // dropping into the lander form with a filter on discards it from every
    // shared or reloaded link while the chip still shows on screen.
    expect(JOBS_CODE).toMatch(
      /const extraFilters = !!\(salaryCeiling \|\| payBasis \|\| statedPayOnly \|\| includeUnstatedPay \|\| maxYears \|\| department \|\| vendor\);/,
    );
    expect((JOBS_CODE.match(/&& !extraFilters &&/g) ?? []).length).toBe(2);
  });

  it("a natural-language search resets the filters it does not mention", () => {
    // nl-search maps a sentence onto the board's filters and the interpretation
    // chips list exactly what it read. A filter left on from before is a
    // constraint the interpretation does not mention and the visitor cannot see
    // the source of.
    const nl = JOBS_CODE.slice(
      JOBS_CODE.indexOf("const applyNlSearch = useCallback("),
      JOBS_CODE.indexOf("const [companyQuery, setCompanyQuery]"),
    );
    for (const reset of [
      "setSalaryCeiling(0)", "setPayBasis(\"\")", "setStatedPayOnly(false)",
      "setMaxYears(0)", "setDepartment(\"\")", "setVendor(\"\")",
    ]) {
      expect(nl, `an NL search leaves ${reset} untouched`).toContain(reset);
    }
  });
});

describe("a filter over a column employers leave blank says so", () => {
  it("every partly-populated new filter has a coverage line", () => {
    // coverageDisclosure() in index.ts publishes filterCoverage for ACTIVE
    // filters only, and a fraction on screen that nobody renders is not a
    // disclosure. `vendor` is 100% and is rendered anyway, so the line's silence
    // about it cannot be confused with the silence about an inactive filter.
    const cov = JOBS_CODE.slice(
      JOBS_CODE.indexOf("const fc = data?.filterCoverage;"),
      JOBS_CODE.indexOf('t("jobsPage.filterCoverage"'),
    );
    expect(cov.length, "the coverage renderer did not parse").toBeGreaterThan(400);
    for (const [field, key] of [
      ["salaryCeiling", "coverageCeiling"],
      ["hasStatedPay", "coverageStatedPay"],
      ["payBasis", "coveragePayBasis"],
      ["maxYears", "coverageMaxYears"],
      ["department", "coverageDepartment"],
      ["vendor", "coverageVendor"],
    ]) {
      expect(cov, `filterCoverage.${field} arrives and nothing renders it`).toContain(`fc.${field}`);
      expect(cov, `${field} coverage has no sentence`).toContain(`jobsPage.${key}`);
      expect(cov, `${field} coverage renders a bare fraction`).toContain(`Math.round(fc.${field} * 100)`);
    }
  });

  it("the whole pay band triggers the hidden-openings disclosure, not just the floor", () => {
    // A $80k floor took 572,348 postings to 10,374 — a 98% collapse that is
    // mostly silence, not low pay. The ceiling, the basis and the stated-pay
    // flag read the same published figure and hide the same majority; only the
    // floor used to raise the line.
    expect(JOBS_CODE).toMatch(
      /\(salaryFloor \|\| salaryCeiling \|\| payBasis \|\| statedPayOnly\) \? "salary"/,
    );
  });

  it("what the saved-search email carries is EVERYTHING the board filters on", () => {
    // This assertion used to be the inverse — the digest hand-listed ten params
    // and the save-side toast NAMED the seven it dropped, with the failure
    // message here reading "now rides along — save it instead of naming it".
    // That day came (2026-08-27): the digest forwards the full filter set, the
    // params are saved, and the toast names only what genuinely cannot ride.
    const digest = readFileSync(resolve(root, "supabase/functions/send-search-digest/index.ts"), "utf8");
    for (const k of ["salaryCeiling", "payBasis", "hasStatedPay", "includeUnstatedPay", "maxYears", "department", "vendor", "sendableOnly", "includeUncategorised"]) {
      expect(digest, `${k} dropped from the digest body — the email mails a wider search than the one saved`)
        .toMatch(new RegExp(`${k}: p\.${k}`));
    }
    // And the save side actually stores them, or the digest forwards nothing.
    for (const k of ["salaryCeiling", "payBasis", "maxYears", "vendor"]) {
      expect(JOBS_CODE, `${k} is not saved — parity is one-sided`).toMatch(new RegExp(`${k}: `));
    }
    // The toast now names ONLY the genuinely un-mailable: a multi-employer
    // scope (the runner sends one token) and Actively hiring (browser-side).
    expect(JOBS_CODE).toMatch(/const unsavedFilters = \[/);
    expect(JOBS_CODE).toContain("jobsPage.savedWithoutFilters");
    expect(JOBS_CODE, "the toast still names a filter that now rides along")
      .not.toMatch(/payBasis \? filterLabel/);
    // The digest sends `companies: p.company ? [p.company] : undefined` — ONE
    // element — so a comma-joined "a,b" reaches the board as a single employer
    // token spelled "a,b" and matches nothing. Save what the runner honours.
    expect(digest).toContain("companies: p.company ? [p.company] : undefined");
    expect(JOBS_CODE).toMatch(/company: companyTokens\.length === 1 \? companyTokens\[0\] : undefined,/);
  });
});

describe("the country facet is measured again, not remembered", () => {
  it("the direct RPC is the source and the result set is the fallback", () => {
    const effect = JOBS_CODE.slice(
      JOBS_CODE.indexOf('const call = () => (supabase as unknown as {'),
      JOBS_CODE.indexOf("honourPendingSkipLink(window.location.hash)"),
    );
    expect(effect).toMatch(/rpc\("get_country_facet"\)/);
    // The retry was unconditional, so every mount paid a second 3s-delayed RPC
    // after a call that had already succeeded. It is kept for the failure it was
    // written for and nothing else.
    expect(effect).toMatch(/if \(rows\.length === 0\) \{/);
    expect(effect).toMatch(/setTimeout\(r, 3000\)/);
    // A transient facet failure must not remove the FILTER.
    expect(JOBS_CODE).toMatch(/countryFacet\.length > 0 \|\| fallbackCountries\.length > 0/);
    expect(JOBS_CODE).toMatch(/countryFacet\.length \? countryFacet : fallbackCountries/);
  });

  it("the stale note is gone and both measurements are dated", () => {
    // Deliberately asserted on the RAW text: this one is about a comment, and
    // the comment is what sent the next reader down the wrong path. It claimed a
    // permanent failure that had already stopped happening.
    expect(JOBS).not.toContain("get_country_facet returns 57014 on every");
    const note = JOBS.slice(
      JOBS.indexOf("THE DIRECT FACET FIRST, THE RESULT SET ONLY IF IT FAILS"),
      JOBS.indexOf("THE DIRECT FACET FIRST, THE RESULT SET ONLY IF IT FAILS") + 1200,
    );
    expect(note, "the failure that justified the fallback must stay on the record").toContain("57014");
    expect(note).toContain("2026-08-08");
    expect(note).toContain("2026-08-25");
    expect(note, "the re-measurement needs its numbers, not an adjective").toContain("253,609");
    expect(note).toContain("0.49s");
  });
});

describe("a key that exists only in English ships English to eight audiences", () => {
  const NEW_KEYS = [
    "experienceBandsLabel", "nExperience", "experienceAtMax", "clearExperience", "experienceTip",
    "maxYearsFieldLabel", "anyMaxYears", "maxYearsOption", "maxYearsTip",
    "payFieldLabel", "salaryCeilingFieldLabel", "anyCeiling", "salaryCeilingOption", "salaryCeilingTip",
    "payBasisFieldLabel", "anyPayBasis", "payBasisHourly", "payBasisSalaried", "payBasisTip",
    "statedPay", "statedPayTip",
    "departmentFieldLabel", "departmentPlaceholder", "departmentTip",
    "allVendors", "vendorFieldLabel", "nVendors", "vendorsAtMax", "clearVendors", "vendorTip",
    "fresh3", "fresh14", "fresh30", "freshDays",
    "coverageCeiling", "coverageStatedPay", "coveragePayBasis", "coverageMaxYears",
    "coverageDepartment", "coverageVendor",
    "savedWithoutFilters",
  ];
  const NEW_FILTER_NAMES = ["salaryCeiling", "payBasis", "hasStatedPay", "maxYears", "department", "vendor"];

  it("there are nine locales and the list did not shrink", () => {
    expect(LOCALE_FILES.sort()).toEqual(
      ["de.json", "en-GB.json", "en.json", "es.json", "fr.json", "hi.json", "nl.json", "pt.json", "tl.json"],
    );
  });

  for (const f of readdirSync(LOCALES).filter((x) => x.endsWith(".json"))) {
    it(`${f} carries every new string`, () => {
      const jp = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, unknown>;
      for (const k of NEW_KEYS) {
        expect(typeof jp[k], `${f} is missing jobsPage.${k}`).toBe("string");
        expect(String(jp[k]).trim().length, `${f} jobsPage.${k} is empty`).toBeGreaterThan(0);
      }
      const names = jp.filterName as Record<string, string>;
      for (const k of NEW_FILTER_NAMES) {
        // ignoredFilters renders these by name. Without one the warning prints a
        // raw camelCase identifier at the moment it is telling somebody their
        // filter did not apply.
        expect(typeof names?.[k], `${f} is missing jobsPage.filterName.${k}`).toBe("string");
      }
    });
  }

  it("no translation drops an interpolation", () => {
    // A locale VALUE beats the inline t() default, so a translation missing
    // {{pct}} renders a sentence with a hole in it — silently, in a language
    // nobody on the team reads.
    const en = JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")).jobsPage as Record<string, string>;
    for (const f of LOCALE_FILES) {
      const jp = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, string>;
      for (const k of NEW_KEYS) {
        const want = (en[k].match(/\{\{\w+\}\}/g) ?? []).sort();
        const got = (String(jp[k]).match(/\{\{\w+\}\}/g) ?? []).sort();
        expect(got, `${f} jobsPage.${k} drops ${want.join(",")}: ${jp[k]}`).toEqual(want);
      }
    }
  });

  it("no new string was left in English in another language's file", () => {
    // Copying the English through is the same regression as omitting the key —
    // it just hides better. Checked on the strings with real words in them; the
    // short interpolation-only ones legitimately match across locales.
    const en = JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")).jobsPage as Record<string, string>;
    const prose = ["experienceTip", "maxYearsTip", "payBasisTip", "statedPayTip", "departmentTip", "vendorTip", "savedWithoutFilters"];
    for (const f of LOCALE_FILES) {
      if (f === "en.json" || f === "en-GB.json") continue;
      const jp = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, string>;
      for (const k of prose) {
        expect(jp[k], `${f} jobsPage.${k} is still the English string`).not.toBe(en[k]);
      }
    }
  });
});
