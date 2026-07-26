// The acronym fix must be conservative: it exists to stop "Verified direct from
// Nshs", not to restyle every employer on the board. These tests pin both
// halves — the shapes it fixes AND the much larger set it must leave alone.
import { describe, it, expect } from "vitest";
import { companyDisplayName } from "@/lib/company-display";

describe("companyDisplayName", () => {
  it("uppercases a title-cased initialism that lost its capitals", () => {
    expect(companyDisplayName("Nshs")).toBe("NSHS");
    expect(companyDisplayName("Hcsc")).toBe("HCSC");
    expect(companyDisplayName("Nshs Health")).toBe("NSHS Health");
  });

  it("leaves ordinary employer names untouched", () => {
    for (const name of [
      "AccentCare", "84 Lumber", "Chevron Stations", "Blue Cross & Blue Shield of Rhode Island",
      "Alto Pharmacy", "JCPenney", "Johns Hopkins Applied Physics Laboratory", "REI",
      "Garmin", "Easterseals Northern California", "M.C. Dean", "AXA",
    ]) {
      expect(companyDisplayName(name)).toBe(name);
    }
  });

  it("never touches names the feed already styled deliberately", () => {
    expect(companyDisplayName("IBM")).toBe("IBM");
    expect(companyDisplayName("eBay")).toBe("eBay");
    expect(companyDisplayName("PwC")).toBe("PwC");
    expect(companyDisplayName("3M")).toBe("3M");
  });

  it("does not shout real vowel-less words", () => {
    expect(companyDisplayName("Nth Degree")).toBe("Nth Degree");
  });

  it("is idempotent — running it twice changes nothing further", () => {
    for (const name of ["Nshs", "AccentCare", "Nth Degree", "84 Lumber"]) {
      const once = companyDisplayName(name);
      expect(companyDisplayName(once)).toBe(once);
    }
  });

  it("handles empty and missing input without throwing", () => {
    expect(companyDisplayName("")).toBe("");
    expect(companyDisplayName(null)).toBe("");
    expect(companyDisplayName(undefined)).toBe("");
  });
});
