/**
 * PERSONIO STATES PAY AND OUR OWN CODE SAID IT DOES NOT.
 *
 * WHAT THIS GUARDS, and why each part of it exists.
 *
 * 1. THE FIELD IS READ AT ALL. Until 2026-09-27 normalizePersonio hardcoded a
 *    null salary under a comment asserting the feed carries no compensation
 *    field, and a repo-wide search for the element's name returned zero hits —
 *    the claim was false and nothing contradicted it, so the board's least
 *    transparent vendor (0.62% of rows stating pay) stayed that way while the
 *    employer's own minimum, maximum, currency and period sat in a string this
 *    function was already handed. The fixture beside this test is that feed,
 *    fetched live from the tenants the audit named, unedited.
 *
 * 2. THE EMPLOYER'S DIGITS SURVIVE. The obvious implementation is to reuse
 *    leverSalary, which takes exactly this shape — and its fmtAmount rounds
 *    above 1,000, so a stated 3,500–4,000 per month becomes "€4k–4k/month" and
 *    parses to an annual floor of 48,000 where the employer offered 42,000.
 *    That is €6,000 of a raise nobody offered, on the vendor whose figures sit
 *    precisely in the band the rounding destroys. One case below runs
 *    leverSalary on the real pair and asserts the fabrication, so the reason
 *    this reader exists cannot be forgotten and "simplified" back.
 *
 * 3. A CONTRADICTED LABEL IS REFUSED AS TEXT, NOT JUST AS COLUMNS. The shared
 *    parser already refuses to annualise 3,700–5,600 "yearly" — but only the
 *    annual COLUMNS go null. The card prints the salary text and the stated-pay
 *    predicate tests the text column, so such a row would still display
 *    "€3,700 per year" and still count as an employer who disclosed pay. Eight
 *    of 444 measured blocks (1.8%) are labelled that wrongly. The four refusal
 *    fixtures and the three acceptance fixtures are the audit's own, measured
 *    live on 2026-09-26/27.
 *
 * 4. A PART-TIME HOURLY WAGE IS NOT AN ANNUAL SALARY. 33 of 97 measured gains
 *    are part-time or full-or-part-time and 21 are hourly. detectPartTime can
 *    only see that through words, so the vendor's own words are carried beside
 *    the normalised enum and handed to the salary context at every ingest parse.
 *
 *    AND THE WORDS ALONE WERE NOT ENOUGH, which a review of this bundle caught
 *    before it shipped. They never reach a column, and the stored-text re-sweep
 *    reads the ROW — so the very version bump this bundle carries would have
 *    recomputed the annual ingest had refused, on exactly the rows ingest was
 *    refusing. Three things now hold the refusal down, and the case below proves
 *    each in the state its defect lives in: the guard's vocabulary accepts our
 *    own underscore spelling (`part_time` is the only durable record of a
 *    schedule there is, and the earlier version of this file PINNED it as
 *    unmatched — that assertion was the record of the defect and is inverted, not
 *    deleted); the sweep selects employment_type and passes it; and because the
 *    vendor's third state, full-or-part-time, is normalised to `full_time` and
 *    cannot be recovered from any column, the sweep refuses outright to promote a
 *    NULL annual to a number on a load-dependent period for this source.
 *
 * NO NUMBER IN THIS FILE IS INVENTED. Every expected annual figure is what the
 * shared parser returns for the text the reader emits; the test asserts the
 * round trip, not a multiplication of its own.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  leverSalary,
  normalizePersonio,
  personioSalary,
  statesTheSameMoney,
} from "../../supabase/functions/job-board/normalize";
import { detectPartTime, parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const FEED = readFileSync(resolve(ROOT, "src/test/fixtures/personio-stated-pay.xml"), "utf8");
const ROWS = normalizePersonio(FEED, "Fixture Employer", "tok", "jobs.personio.de");
const byId = (id: string) => {
  const row = ROWS.find((r) => r.id === `personio:tok:${id}`);
  if (!row) throw new Error(`fixture position ${id} missing from the feed`);
  return row;
};

/** What ingest does with the text: the shared parser, with the vendor's own schedule words. */
const asIngestWouldRead = (row: { salary: string | null; title: string; employmentTypeText?: string | null }) =>
  parseSalaryStructured(row.salary, null, {
    title: row.title,
    description: null,
    employmentType: row.employmentTypeText ?? null,
  });

describe("a Personio figure reaches the board unrounded and correctly labelled", () => {
  it("reads the compensation block the feed has always carried", () => {
    // The fixture is nine real positions; six carry a compensation block and
    // three of those are publishable. If this drops to zero the field is unread
    // again, which is the state this whole change exists to end.
    const stated = ROWS.filter((r) => r.salary !== null);
    expect(stated.length).toBeGreaterThan(0);
    expect(byId("2811482").salary).toBe("EUR 3,500.00 – 4,000.00 per month");
  });

  it("keeps full precision instead of rounding to thousands", () => {
    // The employer's cents, both ends. 3,254.83 is not 3,000 and not 3k.
    expect(byId("2445009").salary).toBe("EUR 3,254.83 – 3,550.32 per month");
    const read = asIngestWouldRead(byId("2445009"));
    expect(read?.min).toBe(3254.83);
    expect(read?.max).toBe(3550.32);
    expect(read?.annualMin).toBe(39058);
    expect(read?.annualMax).toBe(42604);
  });

  it("does not take leverSalary's rounding, which raises the employer's floor", () => {
    // THE REASON THIS READER IS NOT A ONE-LINE REUSE. Same pair, same vendor
    // shape, through the helper that already accepts it.
    const rounded = leverSalary({ min: 3500, max: 4000, currency: "EUR", interval: "monthly" });
    const roundedRead = parseSalaryStructured(rounded, null, null);
    expect(roundedRead?.annualMin).toBe(48000); // the employer said 42,000
    const faithful = asIngestWouldRead(byId("2811482"));
    expect(faithful?.annualMin).toBe(42000);
    expect(faithful?.annualMax).toBe(48000);
    expect(rounded).not.toBe(byId("2811482").salary);
  });

  it("refuses the pair when the employer's period label contradicts the magnitude", () => {
    // All four measured live. A monthly German salary labelled yearly, an
    // Ausbildung stipend labelled yearly, a Bulgarian monthly wage labelled
    // yearly, and an annual figure labelled monthly.
    expect(personioSalary({ min: "3700.00", max: "5600.00", currencyCode: "EUR", currencySymbol: "€", type: "yearly" })).toBeNull();
    expect(personioSalary({ min: "1100.00", max: "1300.00", currencyCode: "EUR", currencySymbol: "€", type: "yearly" })).toBeNull();
    expect(personioSalary({ min: "1400.00", max: "1700.00", currencyCode: "BGN", currencySymbol: "лв", type: "yearly" })).toBeNull();
    expect(personioSalary({ min: "38000.00", max: "49000.00", currencyCode: "EUR", currencySymbol: "€", type: "monthly" })).toBeNull();
  });

  it("publishes the pair when the label and the magnitude agree", () => {
    expect(personioSalary({ min: "60000.00", max: "80000.00", currencyCode: "EUR", currencySymbol: "€", type: "yearly" }))
      .toBe("EUR 60,000.00 – 80,000.00 per year");
    expect(personioSalary({ min: "3500.00", max: "4000.00", currencyCode: "EUR", currencySymbol: "€", type: "monthly" }))
      .toBe("EUR 3,500.00 – 4,000.00 per month");
    expect(personioSalary({ min: "14.50", currencyCode: "EUR", currencySymbol: "€", type: "hourly" }))
      .toBe("EUR 14.50 per hour");
  });

  it("refuses a contradicted row as TEXT, not only as annual columns", () => {
    // The distinction that matters: the parser alone would null the annual and
    // leave the text on the card. The fixture row is the live academedia
    // position — 3,700–5,600 called yearly.
    const contradicted = byId("2694122");
    expect(contradicted.salary).toBeNull();
    // Proof the parser alone is not enough: hand it the text this reader
    // refused to write and it keeps every figure while nulling the annual.
    const ifWeHadWrittenIt = parseSalaryStructured("EUR 3,700.00 – 5,600.00 per year", null, null);
    expect(ifWeHadWrittenIt?.min).toBe(3700);
    expect(ifWeHadWrittenIt?.annualMin).toBeNull();
  });

  it("states the currency the vendor stated, and says nothing where it stated none", () => {
    // Code first (the parser resolves an ISO code exactly and a bare symbol by
    // country), then the vendor's symbol, then SILENCE. Never the office, and
    // never a bare number either: an unlabelled figure used to be published here,
    // which put a number with no unit of account on the card and still counted as
    // an employer disclosing pay under `pay_stated = salary IS NOT NULL`.
    expect(personioSalary({ min: "3500.00", max: "4000.00", currencySymbol: "€", type: "monthly" }))
      .toBe("€3,500.00 – 4,000.00 per month");
    expect(personioSalary({ min: "3500.00", max: "4000.00", type: "monthly" })).toBeNull();
    expect(personioSalary({ min: "3500.00", max: "4000.00", currencySymbol: "  ", type: "monthly" })).toBeNull();
    // What a bare figure would have become, so the cost of the refusal is stated:
    // a parse that keeps every digit and labels no currency at all.
    const guessed = parseSalaryStructured("3,500.00 – 4,000.00 per month", "DE", null);
    expect(guessed?.min).toBe(3500);
    expect(guessed?.currency).toBeNull();
    // A code outside the parser's ISO set is still the employer's own answer and
    // is still published; the column stays null, so nothing ranks or filters it.
    expect(personioSalary({ min: "80000.00", currencyCode: "LKR", type: "monthly" })).toBe("LKR 80,000.00 per month");
  });

  it("treats a lone upper bound, an equal pair and an inverted pair as not a range", () => {
    // A ceiling is not this job's pay; equal ends are ONE bound, not a range;
    // a maximum below its minimum is two readings that disagree.
    expect(personioSalary({ max: "4000.00", currencyCode: "EUR", type: "monthly" })).toBeNull();
    expect(personioSalary({ min: "3500.00", max: "3500.00", currencyCode: "EUR", type: "monthly" }))
      .toBe("EUR 3,500.00 per month");
    expect(personioSalary({ min: "4000.00", max: "3000.00", currencyCode: "EUR", type: "monthly" })).toBeNull();
  });

  it("refuses a figure it cannot render without changing it", () => {
    // A third decimal cannot survive a two-decimal render, and the parser reads
    // three decimals as a thousands group, so both readings are refused rather
    // than one being published rounded.
    expect(personioSalary({ min: "16.955", currencyCode: "EUR", type: "hourly" })).toBeNull();
    // A locale-grouped string is a 1,000x question we decline to answer.
    expect(personioSalary({ min: "3.500,00", currencyCode: "EUR", type: "monthly" })).toBeNull();
    expect(personioSalary({ min: "0", currencyCode: "EUR", type: "monthly" })).toBeNull();
    expect(personioSalary({ min: "3500.00", currencyCode: "EUR", type: "per fortnight" })).toBeNull();
    expect(personioSalary(null)).toBeNull();
  });

  it("refuses to annualise a part-time hourly wage at a full-time load", () => {
    // Live: alpha-industries' Minijobber, schedule part-time, €14.50 per hour.
    const minijob = byId("1613939");
    expect(minijob.employmentTypeText).toBe("part-time");
    expect(minijob.salary).toBe("EUR 14.50 per hour");
    const read = asIngestWouldRead(minijob);
    expect(read?.min).toBe(14.5);       // the wage still shows
    expect(read?.annualMin).toBeNull(); // the 2,080-hour assumption does not
    expect(read?.partTimeSignal).toBe("part-time");
    // And a full-time hourly row on the same feed keeps its annual, so the
    // guard is discriminating rather than simply off.
    const fullTime = asIngestWouldRead(byId("2782509"));
    expect(fullTime?.annualMin).toBe(47840);
  });

  it("fires the guard on the spelling a column can hold, as well as the vendor's", () => {
    // THE ASSERTION THAT WAS THE DEFECT, INVERTED RATHER THAN DELETED. This case
    // used to pin `part_time` as UNMATCHED, and that was true and was the reason
    // the vendor's words had to be carried — but it also meant the one spelling
    // that survives in a COLUMN was the one the guard could not see, so no reader
    // without the vendor payload could ever reproduce the refusal. The underscore
    // form is now in the vocabulary, which is what lets the stored-text re-sweep
    // fire the same guard from the row.
    expect(detectPartTime({ title: "Mitarbeiter", employmentType: "part-time" })).not.toBeNull();
    expect(detectPartTime({ title: "Mitarbeiter", employmentType: "part_time" })).not.toBeNull();
    // full-or-part-time is ambiguous about the load, so it is treated as the
    // part-time case — the vendor's third state, carried through intact, in both
    // spellings.
    expect(detectPartTime({ title: "Mitarbeiter", employmentType: "full-or-part-time" })).not.toBeNull();
    expect(detectPartTime({ title: "Mitarbeiter", employmentType: "full_or_part_time" })).not.toBeNull();
    expect(byId("2694122").employmentTypeText).toBe("full-or-part-time");
    // AND THE WORDS ARE STILL CARRIED, because the enum is lossy in the direction
    // that matters: full-or-part-time normalises to `full_time`, which declares
    // the opposite. So the column can hold the refusal for a part-time row and
    // cannot hold it for a full-or-part-time one — the gap the sweep's own rule
    // closes, asserted in its own file.
    expect(byId("2694122").employmentType).toBe("full_time");
    expect(detectPartTime({ title: "Mitarbeiter", employmentType: "full_time" })).toBeNull();
  });

  it("hands those words to BOTH ingest salary parses, not just the insert", () => {
    // The reader and the guard are both correct and unconnected unless the call
    // sites pass the field — whole expressions are pinned, against
    // comment-stripped code, so a docblock naming the field cannot satisfy it.
    //
    // TWO SITES, AND THE SECOND ONE IS THE IMPORTANT ONE. Ingest inserts new
    // rows; a separate correction pass patches the pay text of rows we ALREADY
    // hold, whose salary is null today, so it is the path most of this vendor's
    // gain arrives through. It re-parses the corrected text, and that parse
    // reading a different context from the insert parse is the shape where one
    // path refuses a part-time annualisation and the other publishes it.
    const CODE = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    expect(CODE).toContain("description: lightDescs ? null : (descs.get(j.id) ?? null), employmentType: scheduleWordsById.get(j.id) ?? null }");
    expect(CODE).toContain("description: lightDescs ? null : (descs.get(id) ?? null), employmentType: scheduleWordsById.get(id) ?? null }");
    // One source for both, so they cannot drift to two different expressions.
    expect(CODE.match(/scheduleWordsById\.get\(/g)?.length).toBe(2);
    expect(CODE).toContain("if (j.employmentTypeText) scheduleWordsById.set(j.id, j.employmentTypeText);");
  });

  it("sets those words on one vendor only, so no other vendor's annuals move", () => {
    // Personio is the only feed that states a schedule beside a pay figure.
    // Two occurrences in code: the interface member and the Personio arm.
    const NORM = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/normalize.ts"), "utf8"));
    expect(NORM.match(/employmentTypeText/g)?.length).toBe(2);
    expect(NORM).toContain("employmentTypeText: schedule || null");
  });

  it("does not record our own reformatting as an employer changing the pay", () => {
    // MEASURED, AND IT IS WHY THIS PREDICATE EXISTS. Of 26 live Personio rows
    // that already state pay, 16 carry the newly-read vendor block and all 16
    // texts differ while naming the same money — the miner's verbatim prose
    // against the vendor's structured figures. Logged as pay changes, that is
    // 16 employers recorded as editing their posting on a day none of them did,
    // in the one log here that cannot be re-derived.
    const mined = "€63,000–€95,000";                        // live, ilias-solutions
    const vendor = "EUR 63,000.00 – 95,000.00 per year";    // the same row's feed block
    expect(statesTheSameMoney(vendor, mined, null)).toBe(true);
    // THE PERIOD IS EXCUSED ONLY WHERE ONE SIDE STATES NONE, and that distinction
    // is the whole of it. The measured case is a mined prose range that parses to
    // no period at all against the vendor's "per year": the vendor has filled a
    // blank, not contradicted an answer.
    expect(parseSalaryStructured(mined, null, null)?.period).toBeNull();
    expect(parseSalaryStructured(vendor, null, null)?.period).toBe("year");
    // AND A PERIOD BOTH SIDES STATE IS THE LARGEST PAY EDIT THERE IS. An earlier
    // version ignored the period outright, so these three pairs were "the same
    // money" and the change went into the row and not into the log — which is the
    // one thing here that cannot be re-derived. The first is 52x.
    expect(statesTheSameMoney("$15,000.00 per week", "$15,000 per year", null)).toBe(false);
    expect(parseSalaryStructured("$15,000.00 per week", null, null)?.annualMin).toBe(780000);
    expect(parseSalaryStructured("$15,000 per year", null, null)?.annualMin).toBe(15000);
    expect(statesTheSameMoney("USD 5,000.00 per week", "$5,000 per month", null)).toBe(false);
    expect(statesTheSameMoney("USD 600.00 per day", "$600 per week", null)).toBe(false);
    // Same period on both sides and the same money is still excused, so the
    // reformatting case the predicate exists for is untouched.
    expect(statesTheSameMoney("EUR 63,000.00 – 95,000.00 per year", "€63,000 – €95,000 per year", null)).toBe(true);
    // A REAL pay change moves the money and is not excused.
    expect(statesTheSameMoney("EUR 64,000.00 – 95,000.00 per year", mined, null)).toBe(false);
    expect(statesTheSameMoney("EUR 63,000.00 – 99,000.00 per year", mined, null)).toBe(false);
    expect(statesTheSameMoney("USD 63,000.00 – 95,000.00 per year", "$63,000–$95,000", null)).toBe(true);
    expect(statesTheSameMoney("GBP 63,000.00 – 95,000.00 per year", mined, null)).toBe(false);
    // Nothing to decide about an unchanged string, or about silence.
    expect(statesTheSameMoney(mined, mined, null)).toBe(false);
    expect(statesTheSameMoney(null, mined, null)).toBe(false);
    expect(statesTheSameMoney(vendor, null, null)).toBe(false);
    // And the correction path has to ask it, or the log fills with fiction.
    const CODE = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    expect(CODE).toContain("const sameMoney = statesTheSameMoney(nextPay, curPay, payCountry);");
    expect(CODE).toContain('if (sameMoney || firstVendorRead) patch.salary = nextPay;\n          else put("salary", row.salary, prev.salary, false);');
  });

  it("does not record the FIRST figure a newly-read vendor field gives us as an employer edit either", () => {
    // THE 44x CASE THE REFORMATTING PREDICATE DOES NOT COVER. statesTheSameMoney
    // needs two texts, and it returns false whenever either side is null — so the
    // 16 reformattings are excused and the ~700 rows going from no pay at all to
    // the employer's own range are not. Those ~700 are every bit as fictional as
    // an employer edit: nothing about the posting changed, we started reading an
    // element that has been in the feed all along. Live scale: 4,252 Personio
    // rows, 21 of them stating pay today, against a measured 17.35% of served rows
    // carrying the block.
    expect(statesTheSameMoney("EUR 63,000.00 – 95,000.00 per year", null, null)).toBe(false);
    expect(statesTheSameMoney(null, "€63,000–€95,000", null)).toBe(false);
    // So the suppression is a one-shot list keyed to the source AND the field, it
    // covers ONLY the null -> value transition, and the guarded expression is
    // pinned whole against comment-stripped code.
    const CODE = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    expect(CODE).toContain('const VENDOR_FIELD_FIRST_READ = new Set(["personio:salary"]);');
    expect(CODE).toContain("const firstVendorRead = curPay === null && nextPay !== null && VENDOR_FIELD_FIRST_READ.has(`${s.source}:salary`);");
    // A LIST THAT CANNOT GROW SILENTLY. It is a one-rotation measure and the next
    // bundle to touch this file is to delete it; an entry for a second field or a
    // second vendor is a decision someone has to make here, not a set someone can
    // append to. (Emptied, this assertion is the one that says so.)
    const list = CODE.slice(CODE.indexOf("const VENDOR_FIELD_FIRST_READ"));
    expect(list.slice(0, list.indexOf(";") + 1).match(/"/g)?.length).toBe(2);
  });

  it("leaves a position that states nothing silent", () => {
    // 86.1% of feed positions carry no compensation block at all. Silence is
    // the honest answer and must stay the cheap path.
    const quiet = byId("1320952");
    expect(quiet.salary).toBeNull();
    expect(ROWS.filter((r) => r.salary === null).length).toBeGreaterThan(0);
  });
});
