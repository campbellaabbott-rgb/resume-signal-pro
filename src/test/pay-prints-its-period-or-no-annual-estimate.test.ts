/**
 * PAY PRINTS ITS PERIOD, OR NO ANNUAL ESTIMATE (job-listings audit JL5).
 *
 * One formatter for the card, the pane and the posting page
 * (src/lib/listing/pay.ts). What it must never do, each case pinned:
 *   - drop the cents off an hourly rate ("$29.92" read "$30");
 *   - abbreviate an amount under 10,000 to "k" ("$1,200–$1,600" read "1k–2k");
 *   - lose an end of a range to rounding ("$61.8k–$62.3k" read "62k–62k");
 *   - print an annual figure for pay whose period we do not know;
 *   - print a vendor's raw slug ("/per-month-salary").
 */
import { describe, expect, it } from "vitest";
import { displaySalary } from "@/lib/salary-display";
import { formatAmount, formatAmountRange, listingPay, payBasisToName, statedCurrencyCode } from "@/lib/listing/pay";

describe("the employer's text is tidied, never re-computed", () => {
  it("keeps the cents on an hourly rate", () => {
    const p = listingPay({ salary: "$29.92 - $38.07 per hour", salaryPeriod: "hour", salaryMinAnnual: 62_234, salaryMaxAnnual: 79_186, salaryCurrency: "USD" }, "en")!;
    expect(p.text).toBe("$29.92–$38.07 per hour");
    expect(p.raw).toBe("$29.92 - $38.07 per hour");
  });

  it("never prints a vendor slug, for any of the five periods, with or without its slash", () => {
    expect(displaySalary("$1,200-1,600 per-month-salary")).toBe("$1,200–1,600/month");
    expect(displaySalary("$160-160/per-day-wage")).toBe("$160–160/day");
    expect(displaySalary("$900/per-week-salary")).toBe("$900/week");
    expect(displaySalary("$22.50/per-hour-salary")).toBe("$22.50/hour");
    expect(displaySalary("$85,000/per-year-salary")).toBe("$85,000/year");
    for (const s of ["$1,200-1,600 per-month-salary", "$160-160/per-day-wage", "$900/per-week-salary"]) {
      expect(listingPay({ salary: s }, "en")!.text).not.toMatch(/per-(year|month|week|day|hour)-/);
    }
  });

  it("names the period beside the text only when the text does not already say it", () => {
    expect(payBasisToName("$4,000", "month")).toBe("month");
    expect(payBasisToName("$4,000 per month", "month")).toBeNull();
    expect(payBasisToName("$4,000", "fortnight")).toBeNull();
    expect(statedCurrencyCode("$120,000", "CAD")).toBe("CAD");
    expect(statedCurrencyCode("CAD 120,000", "CAD")).toBeNull();
    expect(statedCurrencyCode("$120,000", "dollars")).toBeNull();
  });
});

describe("our annual estimate", () => {
  it("exists only when the employer's period is known and is not a year", () => {
    const base = { salary: "$4,000 - $5,000", salaryMinAnnual: 48_000, salaryMaxAnnual: 60_000, salaryCurrency: "USD" };
    expect(listingPay({ ...base, salaryPeriod: "month" }, "en")!.annual).toBe("$48K–$60K");
    expect(listingPay({ ...base, salaryPeriod: null }, "en")!.annual, "no period, no annual figure").toBeNull();
    expect(listingPay({ ...base, salaryPeriod: "unknown" }, "en")!.annual).toBeNull();
    expect(listingPay({ ...base, salaryPeriod: "year" }, "en")!.annual, "a year is already the annual figure").toBeNull();
    expect(listingPay({ ...base, salaryPeriod: "month", salaryMinAnnual: null }, "en")!.annual).toBeNull();
  });

  it("never abbreviates an amount under 10,000 to k", () => {
    expect(formatAmount(1_200, "en", "USD")).toBe("$1,200");
    expect(formatAmount(9_999, "en", null)).toBe("9,999");
    expect(formatAmountRange(1_200, 1_600, "en", "USD")).toBe("$1,200–$1,600");
    expect(formatAmount(10_000, "en", "USD")).toBe("$10K");
  });

  it("keeps both ends of a range when rounding would print one number twice", () => {
    expect(formatAmountRange(61_800, 62_300, "en", "USD")).toBe("$61.8K–$62.3K");
    expect(formatAmountRange(60_000, 80_000, "en", "USD")).toBe("$60K–$80K");
    expect(formatAmountRange(60_000, 60_000, "en", "USD"), "a single figure stays single").toBe("$60K");
  });

  it("marks a currency only when the employer stated its code", () => {
    const p = listingPay({ salary: "$30 an hour", salaryPeriod: "hour", salaryMinAnnual: 62_400, salaryCurrency: null }, "en")!;
    expect(p.annual).toBe("62K");
    expect(p.annual).not.toMatch(/\$/);
  });

  it("speaks the reader's notation", () => {
    const de = listingPay({ salary: "4.000 €", salaryPeriod: "month", salaryMinAnnual: 48_000, salaryCurrency: "EUR" }, "de")!;
    expect(de.annual).toMatch(/48/);
    expect(de.annual).toMatch(/€/);
    expect(de.annual).not.toBe("€48K");
  });
});

describe("no pay we could read is no pay object", () => {
  it("returns null, so the caller prints our-reading copy rather than an employer statement", () => {
    expect(listingPay({ salary: null }, "en")).toBeNull();
    expect(listingPay({ salary: "   " }, "en")).toBeNull();
  });
});
