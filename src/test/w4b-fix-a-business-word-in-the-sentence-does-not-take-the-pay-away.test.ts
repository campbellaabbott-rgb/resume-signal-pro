// @vitest-environment node
/**
 * A BUSINESS WORD IN THE SENTENCE DOES NOT TAKE THE PAY AWAY (wave 4 round 2
 * review, search lens; S12-019's fix narrowed).
 *
 * WHAT WAS WRONG. S12-019 refused a money range whenever its whole sentence
 * held any of a broad list of business words (cost, inventory, transactions,
 * volume, claims, loan, mortgage, equity, savings, deals, "customers with")
 * and the 40 characters before it were not clean; line breaks and list items
 * did not end a sentence. Retail, warehouse, insurance and lending postings
 * lost their stated pay, and SALARY_PARSE_VERSION 11's re-sweep would NULL the
 * correct pay already stored on them (minedSalaryRefused said "refused").
 *
 * WHAT HOLDS NOW:
 *   - every case the review ran keeps its pay, and the re-sweep leaves it;
 *   - the S12-019 cases stay refused (the-first-money-range-in-a-posting-is-
 *     not-its-pay.test.ts runs beside this one, unchanged).
 */
import { describe, expect, it } from "vitest";
import { extractSalary, minedSalaryRefused } from "../../supabase/functions/_shared/salary-extract";

const KEPT: Array<[string, string]> = [
  ["The salary range for this role, which reflects the cost of labor across several US markets, is $100,000 - $150,000 per year.", "$100,000 - $150,000 per year"],
  ["Mortgage Loan Officer pay range: $50,000 - $80,000 per year.", "$50,000 - $80,000 per year"],
  ["Claims Adjuster salary $55,000 - $65,000 annually.", "$55,000 - $65,000 annually"],
  ["Inventory Associate pay: $17.00 - $19.00 per hour.", "$17.00 - $19.00 per hour"],
  ["<ul><li>Process customer transactions accurately</li><li>Maintain inventory levels</li></ul><p>Pay Range: $17.00 - $19.00 per hour</p>", "$17.00 - $19.00 per hour"],
  ["Process customer transactions accurately\nMaintain inventory levels\nPay Range: $17.00 - $19.00 per hour", "$17.00 - $19.00 per hour"],
  ["Originate residential mortgages and refinance loans for our customers ... Base salary $60,000 - $80,000 annually", "$60,000 - $80,000 annually"],
  ["Work in a fast-paced, high volume restaurant\nStarting pay $14 - $16 per hour", "$14 - $16 per hour"],
  ["Base pay $120,000 - $140,000 per year plus equity and savings plans.", "$120,000 - $140,000 per year"],
];

describe("a business word away from the figure leaves the pay", () => {
  for (const [text, pay] of KEPT) {
    it(`${text.slice(0, 60)}...`, () => {
      expect(extractSalary(text)).toMatch(new RegExp(pay.replace(/[$.*+?()[\]{}|^]/g, "\\$&").replace(/ /g, "\\s*")));
      expect(minedSalaryRefused(text, pay), "the re-sweep must not NULL the stored pay").toBe(false);
    });
  }
});

describe("a business figure next to the range is still refused", () => {
  it("the S12-019 shapes", () => {
    expect(extractSalary("You will manage a portfolio of $500K - $2M in annual revenue accounts.")).toBeNull();
    expect(extractSalary("Oversee fleet costs of $500k - $900k across the region.")).toBeNull();
    expect(extractSalary("Responsible for a P&L of $500K - $1M and a team of six.")).toBeNull();
    expect(minedSalaryRefused("Support engineering projects worth £350K - £800K across the A350 programme. Salary: £24,500 per annum.", "£350K - £800K")).toBe(true);
  });
});
