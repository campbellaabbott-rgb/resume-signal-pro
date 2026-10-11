/**
 * A REMOTE DOLLAR JOB IN LATIN AMERICA WAS LABELLED IN PESOS (review of
 * register L13-19, 2026-10-10).
 *
 * The L13-19 fix read every bare "$" in Colombia, Argentina, Chile, Uruguay
 * and the Dominican Republic as the local peso. On the live board most
 * bare-$ pay placed there is a remote job paid in US dollars: re-parsing the
 * stated-pay rows of 2026-10-10 (anon list, country + hasStatedPay) moved 20
 * of 34 Colombian rows and 27 of 32 Argentine rows from USD to a peso, among
 * them LawnStarter "$75,000–$100,000" in Bogotá and Double "$90K – $160K" in
 * Argentina. Those currencies have no salary_rank_usd arm, so the rows left
 * every pay filter and the pay order, and the card printed "(COP)" beside a
 * dollar figure.
 *
 * A bare $ there is now the peso only when, read as dollars, the figure would
 * pay a million a year or more. Taiwan keeps the plain local reading, and the
 * explicit prefixes (NT$, AR$, CL$, COL$, RD$, $U) stay what they say.
 */
import { describe, expect, it } from "vitest";
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

describe("a bare $ in the peso countries", () => {
  it("is US dollars at a dollar magnitude, shaped like the live rows", () => {
    const rows: Array<[string, string]> = [
      ["$75,000–$100,000", "CO"],
      ["$54,000 - $60,000", "CO"],
      ["$3K per month", "CO"],
      ["$12–$16", "CO"],
      ["$90K – $160K", "AR"],
      ["$50K – $70K • 0.5%", "AR"],
      ["$2.5K – $4K per month • Multiple Ranges", "AR"],
      ["$60/hr", "CL"],
      ["$45 – $80 per hour", "UY"],
    ];
    for (const [text, country] of rows) {
      expect(parseSalaryStructured(text, country)?.currency, `${country} ${text} was labelled in the local peso`).toBe("USD");
    }
    expect(parseSalaryStructured("$75,000–$100,000", "CO")?.annualMin).toBe(75000);
    expect(parseSalaryStructured("$12–$16", "CO")?.annualMin, "an unlabelled hourly dollar range lost its annual figure").toBe(24960);
  });

  it("is the local peso when, read as dollars, it would pay a million a year or more", () => {
    expect(parseSalaryStructured("$1,200,000", "AR")?.currency).toBe("ARS");
    expect(parseSalaryStructured("$900,000 - $1,000,000", "AR")?.currency).toBe("ARS");
    expect(parseSalaryStructured("$3,500,000 per month", "CL")?.currency).toBe("CLP");
    expect(parseSalaryStructured("$4.500.000 per month", "CO")?.currency).toBe("COP");
  });

  it("positive control: Taiwan and the explicit prefixes keep their currencies", () => {
    expect(parseSalaryStructured("$1,500,000 to $1,900,000", "TW")?.currency).toBe("TWD");
    expect(parseSalaryStructured("NT$2,000,000 – NT$2,450,000", "TW")?.currency).toBe("TWD");
    expect(parseSalaryStructured("COL$4,000,000 per month", null)?.currency).toBe("COP");
    expect(parseSalaryStructured("AR$ 90,000 per month", "AR")?.currency).toBe("ARS");
    expect(parseSalaryStructured("US$ 1,200,000", "AR")?.currency).toBe("USD");
    expect(parseSalaryStructured("$120,000 - $150,000", "CA")?.currency).toBe("CAD");
  });
});
