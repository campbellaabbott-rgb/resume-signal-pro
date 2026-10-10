/**
 * A MONTHLY WAGE LOST ITS MONTH, A LEVER RANGE WAS ROUNDED, AND A PLACE WAS
 * FILED IN THE WRONG COUNTRY (register L7-04, L7-05, L7-14, L7-15).
 *
 * L7-04. Recruitee sends {min, max, period, currency}; the normaliser read
 * salary.type, which it does not send, so "EUR 1350 - 1575" lost its month: a
 * monthly figure under 20k got no annual value, and 20k+ was read as annual at
 * a twelfth (nts CZK 35,000/month stored 35,000 a year).
 * L7-05. leverSalary rounded each end to the nearest thousand: azul's
 * GBP 3,700/month became "£4k–4k" (annual 48,000 against 44,400), and
 * assist-world's $1,200-1,300 became "$1k–1k".
 * L7-14. detectCountry read a trailing ISO code as a US state and a country
 * word ahead of a state code: "Bangalore, IN" and "Berlin, DE" were US,
 * "Mexico, MO" MX, "Lake Wales, FL" GB.
 * L7-15. iCIMS' country_code overrode the location: Smoothie King's stores at
 * "KCMO, MO" were filed FR.
 */
import { describe, expect, it } from "vitest";
import { detectCountry, icimsCountry, leverSalary, normalizeRecruitee } from "../../supabase/functions/job-board/normalize";
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

const recruitee = (salary: Record<string, unknown>) =>
  normalizeRecruitee({ offers: [{ id: 1, title: "Receptionist", careers_url: "https://x.recruitee.com/o/1", location: "Amsterdam", country: "NL", created_at: "2026-10-01T00:00:00Z", salary } as never] }, "Hotel", "hotel")[0].salary ?? null;

describe("L7-04: Recruitee's period is read", () => {
  it("a monthly range keeps its month and annualises by twelve", () => {
    const text = recruitee({ min: 1350, max: 1575, period: "month", currency: "EUR" });
    const p = parseSalaryStructured(text, "NL");
    expect(p?.period, `stored "${text}" lost its month`).toBe("month");
    expect(p?.annualMin).toBe(16200);
    expect(p?.annualMax).toBe(18900);
  });
  it("a monthly figure of 20k+ is not read as a yearly one", () => {
    const p = parseSalaryStructured(recruitee({ min: 35000, max: 40000, period: "month", currency: "CZK" }), "CZ");
    expect(p?.period).toBe("month");
    expect(p?.annualMin === null || (p?.annualMin ?? 0) > 35000, "CZK 35,000 a month was stored as 35,000 a year").toBe(true);
  });
  it("positive control: a payload with no period stays as the employer wrote it", () => {
    expect(recruitee({ min: 50000, max: 60000, currency: "EUR" })).toBe("EUR 50000 - 60000");
  });
});

describe("L7-05: Lever's pay keeps its exact figures", () => {
  it("monthly figures are printed and annualised exactly", () => {
    const a = leverSalary({ min: 3700, max: 3700, currency: "GBP", interval: "per-month-salary" });
    expect(parseSalaryStructured(a, "GB")?.annualMin, `stored "${a}"`).toBe(44400);
    const b = leverSalary({ min: 1200, max: 1300, currency: "USD", interval: "per-month-salary" });
    const pb = parseSalaryStructured(b, "US");
    expect([pb?.annualMin, pb?.annualMax], `stored "${b}"`).toEqual([14400, 15600]);
  });
  it("a one-time payment is not a rate of pay", () => {
    expect(leverSalary({ min: 5000, max: 5000, currency: "USD", interval: "one-time" })).toBeNull();
  });
  it("positive control: a yearly range still reads as one", () => {
    expect(parseSalaryStructured(leverSalary({ min: 136000, max: 227000, currency: "USD", interval: "per-year-salary" }), "US")?.annualMin).toBe(136000);
  });
});

describe("L7-14, L7-15: the place a posting names decides its country", () => {
  it("a trailing code that is the city's own country is that country", () => {
    expect(detectCountry("Bangalore, IN")).toBe("IN");
    expect(detectCountry("Berlin, DE")).toBe("DE");
    expect(detectCountry("Jakarta, ID")).toBe("ID");
    expect(detectCountry("Bogota, CO")).toBe("CO");
    expect(detectCountry("Toronto, ON, CA")).toBe("CA");
  });
  it("an upper-case US state code at the end beats a country word earlier in the string", () => {
    expect(detectCountry("Mexico, MO")).toBe("US");
    expect(detectCountry("Lake Wales, FL")).toBe("US");
    expect(detectCountry("43 New Scotland Avenue Albany, NY")).toBe("US");
  });
  it("positive control: US towns named like foreign cities, and spelled-out countries, read as before", () => {
    expect(detectCountry("Moscow, ID")).toBe("US");
    expect(detectCountry("London, KY")).toBe("US");
    expect(detectCountry("London, ON")).toBe("CA");
    expect(detectCountry("Paris, France")).toBe("FR");
    expect(detectCountry("Austin, TX 78701")).toBe("US");
  });
  it("iCIMS' own country code gives way to a location that plainly says otherwise", () => {
    expect(icimsCountry("FR", "KCMO, MO")).toBe("US");
    expect(icimsCountry("FR", "Indian Land, SC")).toBe("US");
    expect(icimsCountry("FR", "Paris")).toBe("FR");
    expect(icimsCountry(null, "Austin, TX")).toBe("US");
  });
});
