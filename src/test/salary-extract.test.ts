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
});
