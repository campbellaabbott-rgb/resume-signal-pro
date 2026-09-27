/**
 * A COMMA BEFORE TWO DIGITS IS A DECIMAL POINT — AND BEFORE THREE IT STILL IS NOT.
 *
 * WHAT THIS GUARDS. `parseSalaryStructured` must read "€14,61" as 14.61, and
 * must go on reading "€1.500" and "€1,500" as 1500. Those two are one property,
 * not two: what decides is the LENGTH OF THE TAIL, never the separator and
 * never the locale. A thousands group has exactly three digits, so a group of
 * two cannot be one — while a group of three genuinely can be either, which is
 * why parseMoney's European reading and `readsDotThreeAsRate` exist and must
 * survive every assertion in this file.
 *
 * WHY, and what it cost. `P_RANGE` is two money patterns with a dash between
 * them. On ouihelp's own greenhouse pay footer "€14,61 — €14,61" the grouped
 * alternative could not match (",61" is not a three-digit group), the plain
 * alternative matched the bare "14", no range separator followed it, and the
 * engine restarted INSIDE the number — matching the decimal tail "61" as the
 * low end of the range and the NEXT figure's "14" as the high end. A €14.61 an
 * hour rate parsed as a range from 61 down to 14. Two outcomes, both wrong:
 *
 *   - max below min, so annualisation refused and the columns stored NULL. The
 *     card printed the employer's rate while the posting could not be found by
 *     the pay filter or ordered by the pay sort — 643 of the 684 rows measured.
 *   - the two halves happened to ascend, and then the WRONG pair annualised
 *     cleanly: "€ 18,10 – € 19,51" (smartrecruiters/Securitas) stored
 *     10 x 2080 = 20,800 to 19 x 2080 = 39,520, and "$ 19,08 - $ 30,53"
 *     (workday/Assurant) stored a floor of 16,640 against a true 39,686 — 58%
 *     low, in a column the pay floor, the ceiling and the sort all read through
 *     the generated salary_rank_usd. 41 rows.
 *
 * The worst shape is neither: "€15,96 - €17,14 per hour" (smartrecruiters/Flink)
 * read min 96 WITH a stated hourly period, which annualises to 199,680 — a
 * €33k job published as a €200k one, at the top of the pay sort.
 *
 * MEASURED LIVE 2026-09-27, anon key: 684 rows carry the shape and 683 parse
 * differently after the fix (the 684th is a ",00" tail, where the decimal reading
 * lands on the same number). Nine boards: greenhouse ouihelp 550 / joya 114,
 * smartrecruiters Securitas 8 / Flink 5, workday Ia 2 / Assurant 2 / Enzazaden 1,
 * oracle CareOne 1 / IHG 1. Over 178,591 real stored salary strings pulled from
 * the live board, 683 change, 638 of them from NULL to a value, 45 from a wrong
 * value to a right one, and NOTHING goes from a value to NULL.
 *
 * NOT CONDITIONED ON THE LOCALE, deliberately, and that is measured too: 29 of
 * the 74 shape-carrying rows found by the country census sit on postings whose
 * `country` is NULL, so a locale-gated rule would have missed most of the
 * population. `readsDotThreeAsRate` needs a locale because its shape really is
 * ambiguous; this one does not, because two digits are never a thousands group.
 *
 * SHAPE OF THE ASSERTIONS. Every case below is behavioural — the module is
 * imported and real strings are walked — because a guard that pins the regex's
 * spelling passes while the reading is wrong, and this repo has shipped that
 * four times. The strings are stored rows, not invented ones, except where a
 * case is explicitly about a shape no row carries yet.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSalaryStructured, readsDotThreeAsRate } from "../../supabase/functions/_shared/salary-extract";
import { codeOf } from "./helpers/strip-comments";

describe("a comma before two digits is a decimal point", () => {
  it("reads the ouihelp footer as one rate instead of a range from 61 to 14", () => {
    // The regression case the audit named. Before the fix this returned
    // min 61 / max 14 / annualMin null.
    const p = parseSalaryStructured("€14,61 — €14,61", "FR");
    expect(p?.min).toBe(14.61);
    expect(p?.max).toBe(14.61);
    expect(p?.currency).toBe("EUR");
    // Annualisation is the existing audited path, not part of this change: the
    // unlabeled-hourly inference for a parity currency in [7, 200).
    expect(p?.annualMultiplier).toBe(2080);
    expect(p?.annualMin).toBe(Math.round(14.61 * 2080));
    expect(p?.annualMax).toBe(Math.round(14.61 * 2080));
  });

  it("gives every measured board its own stated rate back", () => {
    // One row per affected board, each the verbatim stored string.
    const cases: Array<[string, string | null, number, number]> = [
      ["€14,60 — €17,52", "FR", 14.6, 17.52],      // greenhouse/Ouihelp, 117 rows
      ["€12,31 — €12,31", "FR", 12.31, 12.31],     // greenhouse/Joya, 108 rows
      ["€ 18,10 – € 19,51", "BE", 18.1, 19.51],    // smartrecruiters/Securitas
      ["€15,96 - €17,14 per hour", "NL", 15.96, 17.14], // smartrecruiters/Flink
      ["$ 19,08 - $ 30,53", "US", 19.08, 30.53],   // workday/Assurant
      ["$27,50 to $30,50", "CA", 27.5, 30.5],      // workday/Ia
      ["$15.00 to $18,12", "US", 15, 18.12],       // oracle/IHG — a dot AND a comma decimal
      ["€10,00 - €13,00", "IT", 10, 13],           // workday/Enzazaden — parsed to nothing before
    ];
    for (const [text, country, min, max] of cases) {
      const p = parseSalaryStructured(text, country);
      expect(p?.min, text).toBe(min);
      expect(p?.max, text).toBe(max);
    }
  });

  it("annualises the Flink row at its own rate instead of 199,680", () => {
    // The only measured row whose wrong reading was BOTH non-null and stated:
    // "per hour" is in the text, so min 96 annualised at 2080 without tripping
    // any sanity window. A €33k job at the top of the pay sort.
    const p = parseSalaryStructured("€15,96 - €17,14 per hour", "NL");
    expect(p?.period).toBe("hour");
    expect(p?.annualMin).toBe(Math.round(15.96 * 2080)); // 33,197, not 199,680
    expect(p?.annualMax).toBe(Math.round(17.14 * 2080));
  });

  it("does not care which country the posting was placed in", () => {
    // 29 of 74 shape-carrying rows found by the country census have country
    // NULL, so the rule cannot be locale-gated. Same digits, same answer, from
    // a dot-decimal locale, a comma-decimal one, and none at all.
    for (const country of ["FR", "DE", "NL", "US", "CA", null, undefined]) {
      expect(parseSalaryStructured("€14,61 — €15,40", country)?.min, String(country)).toBe(14.61);
    }
  });
});

describe("a comma before three digits is still a thousands group", () => {
  it("keeps the ambiguous three-digit reading exactly as it was", () => {
    // "1.500" is genuinely 1.5 or 1500 and the file's long-standing answer is
    // 1500. Nothing in the two-digit rule may touch it — with or without a
    // symbol, with either separator, in either kind of locale.
    for (const [text, country] of [
      ["1.500", "FR"], ["€1.500", "FR"], ["€1.500", "DE"], ["€1.500", null],
      ["1,500", "US"], ["€1,500", "FR"], ["£1.500", "GB"],
    ] as Array<[string, string | null]>) {
      expect(parseSalaryStructured(text, country)?.min, `${text} [${country}]`).toBe(1500);
    }
  });

  it("splits the two conventions on the tail length alone — the case that decides the rule", () => {
    // Identical digits, identical locale, identical currency. The ONLY
    // difference is whether the group after the comma is three digits or two,
    // and that is the whole rule.
    expect(parseSalaryStructured("€14,610", "FR")?.min, "three-digit tail = thousands").toBe(14610);
    expect(parseSalaryStructured("€14,61", "FR")?.min, "two-digit tail = decimal").toBe(14.61);
    // …and the same for a period, where the three-digit case is the one
    // readsDotThreeAsRate arbitrates and the two-digit case was never ambiguous.
    expect(parseSalaryStructured("€14.610", "FR")?.min).toBe(14610);
    expect(parseSalaryStructured("€14.61", "FR")?.min).toBe(14.61);
  });

  it("leaves the European annual rows and the Saskatchewan rate rule alone", () => {
    // 1,715 rows in the live census carry a dot-three group. None of them
    // changed, and these are the two populations that would notice.
    expect(parseSalaryStructured("€ 45.000 - €65.000", "IT")?.annualMin).toBe(45000);
    expect(parseSalaryStructured("€54.000 to €60.000", "NL")?.annualMin).toBe(54000);
    expect(parseSalaryStructured("$23.170 to $24.840", "CA")?.min).toBe(23.17);
    expect(parseSalaryStructured("$110.400 TO $184.000", "US")?.annualMin).toBe(110400);
    expect(readsDotThreeAsRate("$23.170 to $24.840", "CAD", "CA")).toBe(true);
    expect(readsDotThreeAsRate("€ 45.000 - €65.000", "EUR", "IT")).toBe(false);
    // A grouped figure WITH a two-digit decimal tail was already right and
    // stays right: 120 live rows are of this shape.
    expect(parseSalaryStructured("£28.766,77 per year", "GB")?.annualMin).toBe(28767);
    expect(parseSalaryStructured("€3.500,00 – €4.000,00 per month", "DE")?.annualMin).toBe(42000);
  });

  it("reads a US two-digit thousands typo as a decimal, which is the chosen residual", () => {
    // THE ONE INPUT WHERE THIS RULE IS STRICTLY WORSE THAN THE OLD SILENCE, and
    // it is a decision rather than an oversight. "$55,00 - $65,00" is almost
    // certainly a US posting that typed its thousands separator wrong, and
    // because a two-digit tail is now ALWAYS a decimal it reads 55 and 65, which
    // the unlabeled-hourly inference then annualises. Separating it from the
    // Securitas row above ("€ 18,10 – € 19,51", the same shape and genuinely a
    // decimal) requires asking the locale, which this rule deliberately does not
    // do — 29 of 74 shape-carrying rows have no country at all.
    //
    // MEASURED ZERO, which is why the trade is acceptable: of 13,936 live stored
    // strings, no row in a dot-decimal locale carries this shape. The only two US
    // rows with a two-digit comma tail are CareOne "$50.00 - $65,00 Hourly"
    // (unchanged) and oracle/IHG "$15.00 to $18,12" (improved, ceiling 18 ->
    // 18.12). If such a row is ever found, the reading was chosen here.
    const p = parseSalaryStructured("$55,00 - $65,00", "US");
    expect(p?.min).toBe(55);
    expect(p?.max).toBe(65);
    expect(p?.annualMin).toBe(114400);
    expect(p?.annualMax).toBe(135200);
    // And the two live US rows, whose readings are the ones actually at stake.
    expect(parseSalaryStructured("$50.00 - $65,00 Hourly", "US")?.min).toBe(50);
    expect(parseSalaryStructured("$15.00 to $18,12", "US")?.max).toBe(18.12);
  });

  it("refuses the decimal reading when another separator follows it", () => {
    // ashby/Oscilar states "₹66,21,800 – ₹96,56,800". Indian grouping steps in
    // twos, so ",21" is a grouping group and 66.21 would be a fabrication. Found
    // in the independent 60,000-row offset sample; it is the reason the rule
    // carries a lookahead instead of just counting two digits.
    const p = parseSalaryStructured("₹66,21,800 – ₹96,56,800", "IN");
    expect(p?.min, "not 66.21").toBe(66);
    expect(p?.annualMin, "INR is not a parity currency — nothing is inferred").toBeNull();
    // A comma date inside a pay string is refused by the same lookahead.
    expect(parseSalaryStructured("$18.50 per hour from 01,01,2027", "US")?.min).toBe(18.5);
  });
});

describe("an ungrouped figure with a decimal tail is not read a hundredfold high", () => {
  /**
   * The reader behind P_MONEY had a three-digit cap on the integer part, so
   * once the pattern started capturing "2500,00" whole, that reader failed to
   * match it and fell through to a fallback that only strips commas — which
   * reads a €2,500.00 monthly salary as 250,000. No stored row carries this
   * shape today (0 of 178,591 measured), so this case is here because the
   * vendor formatters in flight can emit it and the failure is silent: a
   * hundredfold overstatement of a figure the employer typed.
   */
  it("reads an ungrouped monthly figure as the employer wrote it", () => {
    expect(parseSalaryStructured("€2500,50 per month", "DE")?.min).toBe(2500.5);
    expect(parseSalaryStructured("€2500,50 per month", "DE")?.annualMin).toBe(Math.round(2500.5 * 12));
    expect(parseSalaryStructured("€2500,00 per month", "DE")?.min).toBe(2500);
    // and the shapes that already worked keep their values
    expect(parseSalaryStructured("4000", "US")?.min, "a bare 4000 parses whole").toBe(4000);
    expect(parseSalaryStructured("$2500.50 per month", "US")?.min).toBe(2500.5);
    expect(parseSalaryStructured("$120,000 - $150,000 per year", "US")?.annualMin).toBe(120000);
  });
});

describe("the re-sweep version moves when the reading moves", () => {
  /**
   * Stored rows are insert-only, so a parser change reaches the 683 affected
   * rows only through the chained backfill-salary sweep, and that sweep fires
   * only when the version stamped in job_board_meta disagrees with the constant
   * in the bundle. A parse fix without a bump is a fix that never reaches a
   * stored row.
   *
   * Asserted as a FLOOR, not a pin: a later parser change must be free to bump
   * it again without this test turning red on correct work. Read from the
   * comment-stripped source, because the constant's own note names earlier
   * versions in prose.
   */
  it("carries a salary parse version past the one the comma fix needed", () => {
    const code = codeOf(
      readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8"),
    );
    const found = [...code.matchAll(/const SALARY_PARSE_VERSION\s*=\s*(\d+)/g)];
    expect(found.length, "the sweep's trigger must be a single constant").toBe(1);
    expect(
      Number(found[0][1]),
      "parseSalaryStructured now reads a two-digit comma tail as a decimal — bump SALARY_PARSE_VERSION so backfill-salary re-fills the stored columns",
    ).toBeGreaterThanOrEqual(9);
  });
});
