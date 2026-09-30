// Salary mining must be conservative: report only what the posting's own text
// clearly states as compensation (a range, or a figure tied to a pay period),
// verbatim — and never mistake a bonus/stipend/benefit figure for pay.
import { describe, it, expect } from "vitest";
import { extractSalary, parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

describe("extractSalary", () => {
  it("extracts a US annual range with commas", () => {
    const s = extractSalary("The base salary range for this role is $120,000 - $150,000 per year depending on experience.");
    expect(s).toContain("$120,000");
    expect(s).toContain("$150,000");
  });

  it("extracts k-style ranges", () => {
    expect(extractSalary("Compensation: $95k–$120k plus equity.")).toContain("$95k");
  });

  it("extracts hourly ranges with decimals", () => {
    const s = extractSalary("Pay: $27.50 - $33.25 per hour, weekly pay.");
    expect(s).toContain("$27.50");
    expect(s).toContain("per hour");
  });

  it("extracts European formats", () => {
    expect(extractSalary("Gehalt: €50.000 – €65.000 annually.")).toContain("€50.000");
    expect(extractSalary("Salary £45,000 to £55,000 per annum.")).toContain("£45,000");
  });

  it("extracts a single figure only when tied to a pay period", () => {
    expect(extractSalary("This position pays $95,000 per year.")).toContain("$95,000");
    // A bare dollar figure with no period wording is NOT a salary claim.
    expect(extractSalary("You may expense up to $500 for equipment.")).toBeNull();
  });

  it("never reports bonuses/stipends/benefits as pay", () => {
    expect(extractSalary("We offer a $5,000 sign-on bonus for this role.")).toBeNull();
    expect(extractSalary("Includes a $1,200 annual wellness stipend plus 401(k) match.")).toBeNull();
  });

  it("rejects implausible magnitudes and spreads", () => {
    expect(extractSalary("Earn $2 - $3 per hour in tips.")).toBeNull(); // below wage floor
    expect(extractSalary("Projects range from $1,000 to $200,000 per year in budget.")).toBeNull(); // 200x spread
  });

  it("returns null for text with no pay information", () => {
    expect(extractSalary("We are looking for a senior engineer with React experience.")).toBeNull();
    expect(extractSalary(null)).toBeNull();
    expect(extractSalary("")).toBeNull();
  });
});

// Structured parsing feeds the salary-floor filter + benchmarks. Fixtures are
// REAL stored salary strings observed in production on 2026-07-15.
describe("parseSalaryStructured", () => {
  it("parses lever's per-year-salary format", () => {
    const p = parseSalaryStructured("$136k–227k/per-year-salary");
    expect(p?.min).toBe(136000);
    expect(p?.max).toBe(227000);
    expect(p?.period).toBe("year");
    expect(p?.annualMin).toBe(136000);
  });

  it("parses lever's per-hour-wage format and annualizes at 2080h", () => {
    const p = parseSalaryStructured("$22.5–22.5/per-hour-wage");
    expect(p?.period).toBe("hour");
    expect(p?.annualMin).toBe(22.5 * 2080);
  });

  it("parses ashby's K range with equity suffix (unlabeled → annual by magnitude)", () => {
    const p = parseSalaryStructured("$135K – $180K • Offers Equity");
    expect(p?.min).toBe(135000);
    expect(p?.annualMin).toBe(135000);
  });

  it("parses single hourly values", () => {
    expect(parseSalaryStructured("$75 per hour")?.annualMin).toBe(75 * 2080);
  });

  it("parses mined prose ranges", () => {
    const p = parseSalaryStructured("$120,000 - $150,000 per year");
    expect(p?.annualMin).toBe(120000);
  });

  it("refuses to annualize ambiguous small numbers", () => {
    // "4000 - 6000" with no period: could be monthly — never guess.
    expect(parseSalaryStructured("USD 4000 - 6000")?.annualMin).toBeNull();
    // but an explicit monthly label annualizes honestly
    expect(parseSalaryStructured("USD 4,000 - 6,000 monthly")?.annualMin).toBe(48000);
  });

  it("rejects garbage magnitudes", () => {
    expect(parseSalaryStructured("$3 per hour")?.annualMin ?? null).toBeNull();
    expect(parseSalaryStructured(null)).toBeNull();
    expect(parseSalaryStructured("Competitive")).toBeNull();
  });

  it("captures the stated currency — never guesses across symbols", () => {
    expect(parseSalaryStructured("$136k–227k/per-year-salary")?.currency).toBe("USD");
    expect(parseSalaryStructured("€50.000 – €65.000 annually")?.currency).toBe("EUR");
    expect(parseSalaryStructured("£45,000 to £55,000 per annum")?.currency).toBe("GBP");
    // explicit ISO code beats the bare symbol; CA$/A$ beat plain $
    expect(parseSalaryStructured("CAD 90,000 - 110,000 per year")?.currency).toBe("CAD");
    expect(parseSalaryStructured("CA$90,000 per year")?.currency).toBe("CAD");
    expect(parseSalaryStructured("A$120,000 per year")?.currency).toBe("AUD");
    // no currency stated -> null, so aggregates can exclude it honestly
    expect(parseSalaryStructured("120,000 - 150,000 per year")?.currency).toBeNull();
  });

  it("recognizes high-nominal currencies so salary ranking can normalize them", () => {
    expect(parseSalaryStructured("PHP 1,600,000 per year")?.currency).toBe("PHP");
    expect(parseSalaryStructured("₱1,538,062 per year")?.currency).toBe("PHP");
    expect(parseSalaryStructured("₹1,500,000 - 2,000,000 per year")?.currency).toBe("INR");
    expect(parseSalaryStructured("15,000 zł per month")?.currency).toBe("PLN");
    // ¥ stays null: JPY vs CNY is ~20x — a wrong guess would misrank badly
    expect(parseSalaryStructured("¥8,000,000 per year")?.currency).toBeNull();
  });

  it("never labels a non-US dollar sign as USD (live incident: MX$ ranked as $1.15M)", () => {
    expect(parseSalaryStructured("MX$1,152,000 – MX$1,440,000 per year")?.currency).toBe("MXN");
    expect(parseSalaryStructured("R$180,000 per year")?.currency).toBe("BRL");
    expect(parseSalaryStructured("HK$720,000 per year")?.currency).toBe("HKD");
    expect(parseSalaryStructured("NZ$110,000 per year")?.currency).toBe("NZD");
    expect(parseSalaryStructured("S$96,000 per year")?.currency).toBe("SGD");
    expect(parseSalaryStructured("US$150,000 per year")?.currency).toBe("USD");
  });

  it("refuses to annualize implausible parity-currency monthlies (mislabeled annuals)", () => {
    // "$90,000 Monthly" is an annual salary someone mislabeled — annualizing
    // ×12 would crown the posting's own typo the board's top job.
    expect(parseSalaryStructured("$90,000-$110,000 Monthly")?.annualMin ?? null).toBeNull();
    // a genuinely high USD monthly under the cap still annualizes
    expect(parseSalaryStructured("$20,000 per month")?.annualMin).toBe(240_000);
    // high-nominal currencies keep the wide cap: ₱90,000/month is a normal wage
    expect(parseSalaryStructured("₱90,000 per month")?.annualMin).toBe(1_080_000);
  });
});

describe("a workday pay range is a salary even when nobody says the word hour", () => {
  // Measured 2026-08-24: 17,641 servable workday rows carried vendor-stated
  // salary TEXT with no structured parse. Two parser gaps, both fixed:
  // "an hour" is Workday's own phrasing and was absent from the period
  // vocabulary; and bare ranges like "$22.00 - $24.00" have no period word
  // at all, but for parity currencies [7, 200) sits inside ONLY the hourly
  // sanity window — the inference is arithmetic, not a guess. $200-500
  // stays unlabeled (ambiguous with weekly/daily), non-parity currencies
  // skip the inference (their windows overlap).
  it("annualizes Workday's own phrasings", () => {
    expect(parseSalaryStructured("$29.20 an hour", "US")?.annualMin).toBe(60736);
    expect(parseSalaryStructured("$65,000 a year", "US")?.annualMin).toBe(65000);
  });
  it("annualizes an unlabeled range that can only be hourly", () => {
    const p = parseSalaryStructured("$51.05 - $76.60", "US");
    expect(p?.annualMin).toBe(106184);
    expect(p?.annualMax).toBe(159328);
    expect(p?.period, "the inference sets no stated period — it was not stated").toBeNull();
  });
  it("leaves the ambiguous band and non-parity currencies unlabeled", () => {
    expect(parseSalaryStructured("$300 - $400", "US")?.annualMin, "could be weekly or daily").toBeNull();
    expect(parseSalaryStructured("MX$80 - MX$120", "MX")?.annualMin, "MXN windows overlap at this magnitude").toBeNull();
  });
  it("rounds annualized values to whole dollars", () => {
    expect(parseSalaryStructured("$92.24 - $138.36", "US")?.annualMin).toBe(191859);
    expect(parseSalaryStructured("$92.24 - $138.36", "US")?.annualMax).toBe(287789);
  });
});

describe("an entity-encoded dash is still a pay range", () => {
  // Greenhouse's pay-transparency footer shipped "&mdash;" literally because
  // the old entity decoder handled numeric forms only. 17/200 sampled
  // null-salary greenhouse rows carried an entity-encoded pay block — every
  // one unparseable. The ingest decoder is fixed for new rows; the miner
  // decodes defensively for the immutable stored ones (0.5% → 9.0% measured
  // recall on the sample).
  it("mines and parses through &mdash;", () => {
    const mined = extractSalary("We are an equal opportunity employer. Pay Range $22 &mdash; $24 USD");
    expect(mined).toBe("$22 — $24");
    expect(parseSalaryStructured(mined, "US")?.annualMin).toBe(45760);
  });
  it("parses a stored salary column that carries the entity", () => {
    expect(parseSalaryStructured("$115,000 &mdash; $125,000", "US")?.annualMin).toBe(115000);
  });
});

describe("a three-decimal rate is not a thousands group", () => {
  // Saskatchewan Health Authority publishes union pay bands as HOURLY rates
  // carried to three decimals. Its own requisition fields say it —
  // `"RequisitionType": "Hourly"` beside `"Salary or Pay Band: Pay Band 12
  // $23.170 to $24.840 (3 step range)"` (tenant CX API, 2026-09-26) — and
  // P_MONEY's thousands alternative read "$38.580" as 38,580, so a $38.58/hour
  // RN band was served as a $38,580 ANNUAL salary: under Saskatchewan's
  // minimum wage for full-time work, and ~48% of the real ~$80,246.
  //
  // Measured live 2026-09-26 over 176,575 rows: 1,404 affected rows on FIVE boards
  // and two vendors (oracle HealthCareersInSask.ca 1,294, oracle DPS 96,
  // workday Scarborough Health Network 11, workday Richmond University Medical
  // Center 2, oracle Northwell 1). Every salary floor, ceiling and the pay sort
  // compare against salary_rank_usd, generated from salary_min_annual, so all
  // of them filtered and sorted at roughly half their true pay.
  it("reads the live Saskatchewan band as an hourly rate", () => {
    const p = parseSalaryStructured("$38.580 to $50.070", "CA");
    expect(p?.min).toBe(38.58);
    expect(p?.max).toBe(50.07);
    expect(p?.currency).toBe("CAD");
    expect(p?.annualMultiplier, "annualized as an hourly rate, not taken as annual").toBe(2080);
    expect(p?.annualMin).toBe(Math.round(38.58 * 2080)); // 80,246
    expect(p?.annualMax).toBe(Math.round(50.07 * 2080));
  });

  // READS THE RATE. Whether that rate becomes an annual figure is a SEPARATE
  // decision, taken by the part-time guard, and these calls pass NO context —
  // so they isolate the reading and say nothing about what any one requisition
  // ends up storing. The distinction is not academic: verified live 2026-09-30
  // after this shipped, two of the three bands below resolve to NULL in
  // production, and that is the correct answer. The employer states the load in
  // the same payload that states the rate:
  //   96440  Nurse A         "Type: Full-time temporary"  FTE: 1     -> 80,246
  //   136415 LPN             "Type: Part-time temporary"  FTE: 0.71  -> NULL
  //   136435 Pharmacy Tech   "Type: Part-time regular"    FTE: 0.57  -> NULL
  // An earlier version of this file called that "fixing" those rows and quoted
  // 75,213 and 69,555 as their true pay. Both figures were rate x 2080 with the
  // stated FTE ignored — the guard refused them, and the guard was right. The
  // band is not the row: a DIFFERENT, full-time LPN requisition carrying the
  // identical "$36.160 to $38.720" IS stored at 75,213 (measured the same day).
  it("reads the rate in the other measured bands", () => {
    expect(parseSalaryStructured("$36.160 to $38.720", "CA")?.min).toBe(36.16);
    expect(parseSalaryStructured("$36.160 to $38.720", "CA")?.annualMin).toBe(Math.round(36.16 * 2080));
    expect(parseSalaryStructured("$33.440 to $35.830", "CA")?.annualMin).toBe(Math.round(33.44 * 2080));
    expect(parseSalaryStructured("$23.170 to $24.840", "CA")?.annualMin).toBe(Math.round(23.17 * 2080));
    // the other four boards
    expect(parseSalaryStructured("$23.178 to $27.698", "US")?.annualMin).toBe(Math.round(23.178 * 2080));
    expect(parseSalaryStructured("$46.762 - $54.209", "CA")?.annualMin).toBe(Math.round(46.762 * 2080));
    expect(parseSalaryStructured("$25.835-$27.162", "US")?.annualMin).toBe(Math.round(25.835 * 2080));
    expect(parseSalaryStructured("$54.051 - $93.846", "US")?.annualMin).toBe(Math.round(54.051 * 2080));
  });

  // The stated load decides the annual figure, and the descriptions here are the
  // employers' own wording from the requisitions named above. This case exists
  // because the comment it replaces got this backwards once already.
  it("leaves annualising to the part-time guard, which reads the stated FTE", () => {
    const ft = parseSalaryStructured("$38.580 to $50.070", "CA", {
      title: "Nurse A - Registered Nurse General Duty Nurse",
      description: "Department: Chronic Resident Unit Type: Full-time temporary Expected Up to Date: September 10, 2027 FTE: 1 Shift Information: Days, Nights, Weekends",
    });
    expect(ft?.annualMin, "a stated full-time load annualises at 2080").toBe(Math.round(38.58 * 2080));
    expect(ft?.partTimeSignal).toBeNull();

    const pt = parseSalaryStructured("$36.160 to $38.720", "CA", {
      title: "Licensed Practical Nurse",
      description: "Department: LTC Nursing Unit - Unit 3-6 Type: Part-time temporary Expected Up to Date: August 28, 2027 FTE: 0.71 Shift Information: Days, Nights, Evenings, Weekends, Stats",
    });
    expect(pt?.min, "the rate is still read, and still displayed").toBe(36.16);
    expect(pt?.annualMin, "0.71 FTE — a 2080-hour year is not what this posting offers").toBeNull();
    expect(pt?.partTimeSignal).toBe("part-time");
  });

  // Below the 20k unlabeled-annual floor the OLD thousands reading stored NULL,
  // not a wrong number: "$18.890" read as 18,890 clears neither that floor nor
  // the <200 hourly window. 81 of the 1,404 affected rows were this shape, so
  // the fix GIVES them a figure rather than correcting one. ("$23.170" is NOT
  // one of them — 23,170 clears the floor, so that row stored 23,170.)
  it("gives a figure to the rows the thousands reading left NULL", () => {
    // oracle:emqk~ca3~CX_1, "Entrance Attendant" — stored annual was NULL
    const p = parseSalaryStructured("$18.890 to $20.240", "CA");
    expect(p?.min).toBe(18.89);
    expect(p?.annualMin).toBe(Math.round(18.89 * 2080));
  });

  it("KEEPS the European thousands reading — the separator alone decides nothing", () => {
    // parseMoney's documented behaviour ("50.000" = 50000) must survive. These
    // are real measured rows in the same band; 285 EUR rows matched the shape
    // and every one of them is a genuine annual salary.
    expect(parseSalaryStructured("€ 45.000 - €65.000", "IT")?.annualMin).toBe(45000);
    expect(parseSalaryStructured("€68.000 - €87.000", "IT")?.annualMin).toBe(68000);
    expect(parseSalaryStructured("€32.232 to € 34.000", "IT")?.annualMin).toBe(32232);
    expect(parseSalaryStructured("€54.000 to €60.000", "NL")?.annualMin).toBe(54000);
    expect(parseSalaryStructured("€50.000 – €65.000 annually")?.annualMin).toBe(50000);
    // a continental-formatted GBP row: the comma-decimal tail settles it
    expect(parseSalaryStructured("£28.766,77 per year", "GB")?.annualMin).toBe(28767);
  });

  it("leaves a dot-as-thousands TYPO in a dot-decimal locale alone", () => {
    // A round annual figure is the signature of the typo, and all of these are
    // genuinely annual. Reading them as rates would inflate them 2080x.
    expect(parseSalaryStructured("$110.400 TO $184.000", "US")?.annualMin).toBe(110400);
    expect(parseSalaryStructured("$50.000-$100.000", "US")?.annualMin).toBe(50000);
    expect(parseSalaryStructured("$103.600-$145.000", "CA")?.annualMin).toBe(103600);
    expect(parseSalaryStructured("$65.000 to $85.000", "US")?.annualMin).toBe(65000);
    expect(parseSalaryStructured("$110.000 - $117.000", "US")?.annualMin).toBe(110000);
  });

  it("a comma elsewhere in the string proves the dot is a thousands separator", () => {
    // "$85,000-$105.000" (lever/Sait) and "$66,788 - $92.788" (paylocity) are
    // annual ranges whose second figure is mistyped — reading it as $105.00 an
    // hour would both invent a rate and break the range.
    const p = parseSalaryStructured("$85,000-$105.000", "CA");
    expect(p?.annualMin).toBe(85000);
    expect(p?.annualMax).toBe(105000);
    expect(parseSalaryStructured("$66,788 - $92.788", "US")?.annualMin).toBe(66788);
    expect(parseSalaryStructured("$100,000-$140.000", "US")?.annualMin).toBe(100000);
  });

  it("takes the employer's word when they state an annual basis", () => {
    // bamboohr/BibliU: both figures are bare dot-3 and the locale is USD, but
    // "per annum" is the employer naming the period.
    expect(parseSalaryStructured("$30.000 - $35.000 per annum", "US")?.annualMin).toBe(30000);
    // a stated "per hour" CONFIRMS the rate reading — and without the re-read
    // 23,170 fails the $500/hour sanity ceiling and annualizes to nothing
    expect(parseSalaryStructured("$23.170 per hour", "CA")?.annualMin).toBe(Math.round(23.17 * 2080));
  });

  it("refuses the re-read when nothing narrows it", () => {
    // no locale stated at all -> keep today's thousands reading
    expect(parseSalaryStructured("38.580 to 50.070")?.annualMin).toBe(38580);
    // decimal reading outside the hourly window -> the thousands reading is
    // kept rather than dropping a value
    expect(parseSalaryStructured("$250.750 - $300.500", "US")?.annualMin).toBe(250750);
    // the part-time guard still governs the rate it now reads correctly
    expect(
      parseSalaryStructured("$38.580 to $50.070", "CA", { title: "Registered Nurse - Part Time" })?.annualMin,
    ).toBeNull();
  });
});
