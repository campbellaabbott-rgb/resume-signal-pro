// Salary mining must be conservative: report only what the posting's own text
// clearly states as compensation (a range, or a figure tied to a pay period),
// verbatim — and never mistake a bonus/stipend/benefit figure for pay.
import { describe, it, expect } from "vitest";
import { extractSalary } from "../../supabase/functions/_shared/salary-extract";

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
