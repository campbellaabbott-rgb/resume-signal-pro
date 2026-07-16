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
