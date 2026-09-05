// THE BOARD HELD FIVE FACTS AND SAID NONE OF THEM.
//
// Inventoried 2026-09-04 against the serving rows. Every one of these columns
// is populated, SELECTed on every page, and carried all the way into client
// state — and not one of them reached a reader as a statement:
//
//   source           100%   rowToJob emits it and search_jobs returns it in its
//                           RETURNS TABLE. The card said "Verified direct from
//                           Acme" and never WHICH hiring system Acme publishes
//                           on — the one detail that makes the claim checkable
//                           in ten seconds.
//   category         100%   rendered as a 3px colour stripe down the left edge
//                           of every card, with no surface anywhere saying what
//                           the colour means.
//   country          ~72%   reached the JSON-LD's applicantLocationRequirements
//                           and the filter picker. "Cambridge" is two countries
//                           and "London" is three.
//   salary_period    10.6%  read ONLY as a gate — annualizedPayRange returns
//                           null for "year" and a range for anything else — so
//                           a card printed "≈66k/year as stated" with the
//                           period that figure came off nowhere on the page.
//   salary_currency  ~20%   declared in the client row type and read by nothing
//                           at all. "$120,000" is four different offers.
//
// ── WHAT MAKES THIS HARD IS NOT PRINTING THE COLUMN ─────────────────────────
//
// Every one of these has to obey the house rule: a field the employer did not
// state renders NOTHING. Never a guess, never a zero, never a dash implying the
// absence of the FACT rather than the absence of the STATEMENT. And two of them
// have to obey a second rule that only shows up once you try to render them —
// they are usually ALREADY on the page in the employer's own words. "$32.00 per
// hour · hourly rate" and "London, United Kingdom · United Kingdom" are not
// honesty, they are noise, and noise is how a reader stops reading the line
// that matters.
//
// So the two suppressing helpers below only ever DELETE a true statement that
// is already visible. Neither can invent one: payBasisToName cannot return a
// period the row does not carry, and countryToName cannot return a country the
// row does not carry. A spelling missing from either table costs one redundant
// word — never a wrong one, and never a fabricated one.
//
// Asserted by CALLING the helpers rather than grepping for them. Nine guards in
// this repo have passed while the code they spelled was dead; the greps that
// remain are for the render sites, which are not callable from here, and they
// run against comment-stripped source because four guards this month matched
// their own explanation.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  sourceLabel,
  payBasisToName,
  statedCurrencyCode,
  countryToName,
  countryLabelOrNull,
  outstaysFieldWindow,
} from "../pages/Jobs";
import { ATS_VENDORS, NON_ATS_SOURCES, UNMEASURED_ATS_SOURCES } from "@/config/ats-vendors";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const RAW = read("src/pages/Jobs.tsx");
// Code literals against comment-stripped source; a comment's prose against RAW.
const JOBS = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const BOARD = read("supabase/functions/job-board/index.ts")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("the board held five facts and said none of them", () => {
  it("names the hiring system by the vendor's own name, and never by the column value", () => {
    // Every source the board serves resolves, through the ONE config list that
    // the vendor filter and the sources footnote already read.
    for (const v of [...ATS_VENDORS, ...UNMEASURED_ATS_SOURCES, ...NON_ATS_SOURCES]) {
      expect(sourceLabel(v.key), v.key).toBe(v.label);
    }
    // Case and whitespace are the shapes a column value actually arrives in.
    expect(sourceLabel("GREENHOUSE")).toBe("Greenhouse");
    expect(sourceLabel("  workday ")).toBe("Workday");
    // A source we hold no label for renders NOTHING. Printing "adp_wfn" would
    // be worse than the un-named sentence it replaces: a name the reader
    // cannot check is not evidence.
    for (const v of [null, undefined, "", "some_new_vendor", 7, {}]) {
      expect(sourceLabel(v as string | null | undefined), String(v)).toBeNull();
    }
    // Prototype keys reach this from a server row. accentFor once stringified
    // the Object constructor into a CSS colour through exactly this hole, and
    // `??` does not catch it because a function is not nullish.
    expect(sourceLabel("constructor")).toBeNull();
    expect(sourceLabel("__proto__")).toBeNull();
    expect(sourceLabel("toString")).toBeNull();
  });

  it("the wire actually carries source on both serving paths", () => {
    // The client type is worthless if the row never has the key. The browse
    // exit selects the column; rowToJob emits it under this exact spelling.
    expect(BOARD, "rowToJob emits it").toMatch(/source: r\.source,/);
    expect(BOARD, "the browse SELECT names it").toMatch(/"id,source,company_token/);
    expect(JOBS, "and the client row type finally declares it").toMatch(/source\?: string \| null;/);
  });

  it("a pay figure names its basis — unless the employer's own words already do", () => {
    // The gap this closes: a period the reader had to infer from the amount.
    expect(payBasisToName("$32.00 – $40.00", "hour")).toBe("hour");
    expect(payBasisToName("$120,000", "year")).toBe("year");
    expect(payBasisToName("€5,400", "month")).toBe("month");
    expect(payBasisToName("£450", "day")).toBe("day");
    // Already said, in the shapes feeds ship and the shapes displaySalary
    // normalizes them into. Repeating it is noise on the majority of rows.
    expect(payBasisToName("$32.00 per hour", "hour")).toBeNull();
    expect(payBasisToName("$32.00/hr", "hour")).toBeNull();
    expect(payBasisToName("$85,000.00 per year", "year")).toBeNull();
    expect(payBasisToName("USD 105,000 annually", "year")).toBeNull();
    expect(payBasisToName("€5,400 per month", "month")).toBeNull();
    // NEVER INFERRED. No period stated is no basis shown — not "annual"
    // because the number happens to look like a salary.
    for (const p of [null, undefined, "", "fortnight", "PER_HOUR", 3, {}]) {
      expect(payBasisToName("$120,000", p as string | null), String(p)).toBeNull();
    }
    // And it cannot manufacture a basis for a posting that states no pay.
    expect(payBasisToName(null, "hour")).toBe("hour"); // period stated, text absent
    expect(payBasisToName("", "hour")).toBe("hour");
  });

  it("a currency is named when the symbol alone does not say which one", () => {
    expect(statedCurrencyCode("$120,000", "USD")).toBe("USD");
    expect(statedCurrencyCode("$120,000", "cad")).toBe("CAD");
    expect(statedCurrencyCode("120,000 – 140,000", "SGD")).toBe("SGD");
    // Already stated in the employer's own text.
    expect(statedCurrencyCode("USD 105,000-135,000", "USD")).toBeNull();
    expect(statedCurrencyCode("105,000 EUR", "eur")).toBeNull();
    // Not a currency code, so not a currency. A junk column value must never
    // reach the page dressed as one.
    for (const c of [null, undefined, "", "US", "DOLLARS", 840, {}]) {
      expect(statedCurrencyCode("$120,000", c as string | null), String(c)).toBeNull();
    }
  });

  it("the country is said only where the location line has not already said it", () => {
    // The case that made this worth doing: a city that is several countries.
    expect(countryToName("Cambridge", "GB")).toBe("United Kingdom");
    expect(countryToName("Cambridge", "US")).toBe("United States");
    expect(countryToName("London", "CA")).toBe("Canada");
    // Already answered — by name, by code, or by the alias people actually type.
    expect(countryToName("London, United Kingdom", "GB")).toBeNull();
    expect(countryToName("Austin, TX, USA", "US")).toBeNull();
    expect(countryToName("Toronto, ON, Canada", "CA")).toBeNull();
    expect(countryToName("Berlin, DE", "DE")).toBeNull();
    // ONE CASE PER MECHANISM, because the three suppressors shadow each other
    // for the countries that carry an alias row and a mutation that kills one
    // of them then goes unnoticed. KE has no alias row, so only the NAME check
    // can be answering here; "Vienna, AT" contains neither "Austria" nor any
    // alias, so only the CODE check can be.
    expect(countryToName("Nairobi, Kenya", "KE")).toBeNull();
    expect(countryToName("Nairobi", "KE")).toBe("Kenya");
    expect(countryToName("Vienna, AT", "AT")).toBeNull();
    expect(countryToName("Vienna", "AT")).toBe("Austria");
    // And the code check is a word match, not a substring: "US" inside
    // "Austin" must not swallow the country of a US posting.
    expect(countryToName("Austin", "US")).toBe("United States");
    // A location we hold no text for: the country is then the only place fact
    // there is, so it is stated rather than swallowed.
    expect(countryToName("", "FR")).toBe("France");
    expect(countryToName(null, "FR")).toBe("France");
    // Not a country code => nothing. Never a raw column value on the page.
    for (const c of [null, undefined, "", "USA", "U", 1, {}]) {
      expect(countryToName("Cambridge", c as string | null), String(c)).toBeNull();
    }
    // The panel's labelled row wants the fact unconditionally — a row headed
    // "Country" cannot read as redundant the way a bare appended word can —
    // but junk still produces no row.
    expect(countryLabelOrNull("gb")).toBe("United Kingdom");
    expect(countryLabelOrNull("USA")).toBeNull();
    expect(countryLabelOrNull(null)).toBeNull();
  });

  it("the field-window comparison is refused unless the EMPLOYER dated the posting", () => {
    const field = { p75: 30, n: 4_000 };
    expect(outstaysFieldWindow(31, field)).toBe(true);
    expect(outstaysFieldWindow(30, field), "at the boundary is not past it").toBe(false);
    expect(outstaysFieldWindow(2, field)).toBe(false);
    // THE 2.8-DAY-MEDIAN INCIDENT, recorded once and reintroduced twice since:
    // an undated posting must get silence, never a comparison built on our own
    // discovery time. Callers pass daysAgo(postedAt); null means undated.
    expect(outstaysFieldWindow(null, field)).toBe(false);
    // A field the closure log is too thin to speak about returns NO ROW from
    // get_category_fill_speed (its own 300-closing floor), so an absent field
    // is a thin sample declining rather than a number to be trusted.
    expect(outstaysFieldWindow(400, null)).toBe(false);
    expect(outstaysFieldWindow(400, undefined)).toBe(false);
    expect(outstaysFieldWindow(400, { p75: Number.NaN, n: 4_000 })).toBe(false);
  });

  it("both surfaces render each fact, and both fall back rather than guess", () => {
    // The card and the panel each read the ATS name through the same helper,
    // and each keep the un-named sentence for a source we cannot label.
    expect((JOBS.match(/jobsPage\.trustBadgeAts"/g) ?? []).length, "card + panel").toBe(2);
    expect((JOBS.match(/jobsPage\.trustBadge"/g) ?? []).length, "the un-named fallback survives on both").toBe(2);
    expect(JOBS, "the card").toMatch(/const ats = sourceLabel\(job\.source\);/);
    expect(JOBS, "the panel").toMatch(/sourceLabel\(detailJob\.source\)/);
    // Pay basis and currency reach both surfaces.
    expect(JOBS).toMatch(/payBasisToName\(job\.salary, job\.salaryPeriod\)/);
    expect(JOBS).toMatch(/payBasisToName\(detailJob\.salary, detailJob\.salaryPeriod\)/);
    expect(JOBS).toMatch(/statedCurrencyCode\(job\.salary, job\.salaryCurrency\)/);
    expect(JOBS).toMatch(/statedCurrencyCode\(detailJob\.salary, detailJob\.salaryCurrency\)/);
    // Country: suppressed form on the skimmed card, labelled row in the panel.
    // The card's argument is the DISPLAYED place, not the raw column — see
    // a-requisition-number-is-not-a-place: a location that is nothing but an
    // internal code shows no place at all, and the country is then the only
    // place fact there is. countryToName already states it when the text is
    // empty; feeding it the raw column would let a country name buried inside
    // a requisition string suppress the one word left to say.
    expect(JOBS).toMatch(/const cardCountry = countryToName\(cardLoc\.text, job\.country\);/);
    expect(JOBS).toMatch(/countryLabelOrNull\(detailJob\.country\)/);
    // The category finally has a NAME beside its colour, and the same helper
    // paints both the stripe and the dot so they cannot drift apart.
    expect(JOBS).toMatch(/jobsPage\.factField/);
    expect(JOBS).toMatch(/accentFor\(detailJob\.category\)/);
    // Every one of them sits behind its own existence test — there is no
    // `?? "—"`, no `?? 0` and no "Not specified" anywhere in the fact list.
    expect(JOBS, "an absent fact must not become a printed absence")
      .not.toMatch(/factPay[\s\S]{0,4000}(Not specified|Not stated|not disclosed)/);
  });

  it("the reason each of these is allowed to stay silent is written down", () => {
    // PROSE, so RAW. Strip the comments and the next tidy-up "fixes" the gaps
    // by filling them in, which is the exact defect this file exists to stop.
    expect(RAW).toMatch(/NEVER the raw column value/);
    expect(RAW).toMatch(/Employer-stated or nothing/);
    expect(RAW).toMatch(/It is never inferred from the amount/);
    expect(RAW).toMatch(/it can never produce a country the row does not carry/);
    expect(RAW).toMatch(/THE AGE MUST BE THE COMPANY'S OWN DATE/);
  });

  it("every new string exists in all nine locales, with its interpolations intact", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    // key -> the placeholders that MUST survive translation. A locale that
    // drops {{ats}} renders a trust claim with a hole in it.
    const REQUIRED: Record<string, readonly string[]> = {
      trustBadgeAts: ["{{company}}", "{{ats}}"],
      trustBadgeAtsTip: ["{{company}}", "{{ats}}"],
      annualizedBasisTip: [],
      pastFieldWindow: ["{{field}}"],
      pastFieldWindowTip: ["{{n}}", "{{field}}", "{{window}}", "{{p75}}", "{{age}}"],
      factPay: [], factWorkMode: [], factEmploymentType: [], factExperience: [],
      factCountry: [], factField: [], factPosted: [], factApplying: [], factEmployer: [],
      experienceProvenance: [], minYearsProvenance: [],
      countryProvenance: [], categoryProvenance: [],
    };
    for (const f of files) {
      const jp = (JSON.parse(readFileSync(resolve(dir, f), "utf8")) as {
        jobsPage?: Record<string, unknown>;
      }).jobsPage ?? {};
      for (const [k, holes] of Object.entries(REQUIRED)) {
        expect(typeof jp[k], `${f}: jobsPage.${k}`).toBe("string");
        // A locale that left the English in is not a translation, and this
        // repo ships nine of these by hand.
        expect(String(jp[k]).length, `${f}: jobsPage.${k} is empty`).toBeGreaterThan(0);
        for (const h of holes) {
          expect(String(jp[k]), `${f}: jobsPage.${k} lost ${h}`).toContain(h);
        }
      }
      // The five pay bases, nested exactly like employmentType and workMode so
      // one lookup shape serves every closed-list label on this page.
      const basis = jp.payBasis as Record<string, unknown> | undefined;
      for (const p of ["hour", "day", "week", "month", "year"]) {
        expect(typeof basis?.[p], `${f}: jobsPage.payBasis.${p}`).toBe("string");
      }
    }
  });
});
