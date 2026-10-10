/**
 * A TAIWAN SALARY RANKED AS DOLLARS, AND A PAY CEILING READ AS ITS FLOOR
 * (register L13-19, L7-06, L7-07).
 *
 * L13-19. "NT$2,000,000 per year" (Taiwan, about US$62k) was stored as USD
 * 2,000,000 and topped the pay order; a bare "$1,200,000" in Argentina the
 * same; "$80.3M" in Colombia was read as an hourly rate and annualised to
 * 167,024.
 * L7-06. "Pay Range: Up to $38/hr" was mined as "$38/hr" and ADP's
 * "Up to 95000.00 (USD) Annually" passed straight through, both stored as a
 * pay FLOOR (annualMin 79,040 and 95,000): the floor filter and the pay order
 * counted a maximum as a minimum.
 * L7-07. "$17.00/hr - $38.00/hr" was mined as "$17.00/hr": a period after
 * the first figure stopped the range, and the card printed the low end alone.
 */
import { describe, expect, it } from "vitest";
import { extractSalary, parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

describe("L13-19: a dollar sign is not always the US dollar", () => {
  it("NT$ is TWD, and a bare $ in Taiwan, Argentina, Chile, Colombia, the Dominican Republic or Uruguay is that country's currency", () => {
    expect(parseSalaryStructured("NT$2,000,000 per year", "TW")?.currency).toBe("TWD");
    expect(parseSalaryStructured("NT$2,000,000 per year", null)?.currency).toBe("TWD");
    expect(parseSalaryStructured("$1,200,000", "AR")?.currency).toBe("ARS");
    expect(parseSalaryStructured("$3,500,000 per month", "CL")?.currency).toBe("CLP");
    expect(parseSalaryStructured("COL$4,000,000 per month", null)?.currency).toBe("COP");
  });
  it("a figure in millions is never a wage", () => {
    expect(parseSalaryStructured("$80.3M", "CO"), "a company figure was annualised as an hourly rate").toBeNull();
    expect(parseSalaryStructured("$1.2 million", "US")).toBeNull();
  });
  it("positive control: US and Canadian dollars are read as before", () => {
    expect(parseSalaryStructured("$120,000 - $150,000", "US")?.currency).toBe("USD");
    expect(parseSalaryStructured("$120,000 - $150,000", "CA")?.currency).toBe("CAD");
    expect(parseSalaryStructured("$95,000 per year", null)?.annualMin).toBe(95000);
  });
});

describe("L7-06: a ceiling is not a floor", () => {
  it("the miner keeps the qualifier, and a ceiling alone sets no floor", () => {
    expect(extractSalary("Pay Range: Up to $38/hr, depending on experience")).toBe("Up to $38/hr");
    expect(parseSalaryStructured("Up to $38/hr", "US"), "a maximum entered the floor filter as a minimum").toBeNull();
    expect(parseSalaryStructured("Up to 95000.00 (USD) Annually", "US")).toBeNull();
  });
  it("positive control: a real range that mentions a maximum still parses", () => {
    expect(parseSalaryStructured("$80,000 to $100,000 per year", "US")?.annualMin).toBe(80000);
  });
});

describe("L7-07: each figure may carry its own period", () => {
  it("the whole range is mined and parsed", () => {
    expect(extractSalary("Compensation: $17.00/hr - $38.00/hr based on location")).toBe("$17.00/hr - $38.00/hr");
    expect(extractSalary("$25 per hour - $30 per hour")).toBe("$25 per hour - $30 per hour");
    const p = parseSalaryStructured("$17.00/hr - $38.00/hr", "US");
    expect(p?.min).toBe(17);
    expect(p?.max, "the top of the range was dropped").toBe(38);
    expect(p?.period).toBe("hour");
    expect(parseSalaryStructured("$50,000/yr - $60,000/yr", "US")?.annualMax).toBe(60000);
  });
});
