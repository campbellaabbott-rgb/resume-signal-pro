/**
 * The pane's employer context prints money in the reader's notation (company
 * pages audit CP19: "$14.5B" was hard-coded in every locale), compact only
 * from 10,000 up, and in the filing's own currency.
 */
import { describe, expect, it } from "vitest";
import { fmtMoney } from "./EmployerContext";

describe("fmtMoney", () => {
  it("is compact from 10,000 and whole below it", () => {
    expect(fmtMoney(14_500_000_000, "USD", "en")).toBe("$14.5B");
    expect(fmtMoney(145_000, "USD", "en")).toBe("$145K");
    expect(fmtMoney(9_500, "USD", "en")).toBe("$9,500");
  });
  it("speaks the reader's language and the filing's currency", () => {
    const de = fmtMoney(14_500_000_000, "USD", "de");
    expect(de).toMatch(/14,5/);
    expect(de).toMatch(/\$/);
    expect(fmtMoney(2_000_000_000, "EUR", "en")).toBe("€2B");
    expect(fmtMoney(2_000_000_000, null, "en"), "an unstated filing currency is the SEC's own, US dollars").toBe("$2B");
    expect(fmtMoney(2_000_000_000, "dollars", "en")).toBe("$2B");
  });
});
