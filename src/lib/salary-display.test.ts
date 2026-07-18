import { describe, it, expect } from "vitest";
import { displaySalary } from "./salary-display";

describe("displaySalary", () => {
  it("drops .00 cents and normalizes period wording", () => {
    expect(displaySalary("$85,000.00 per year")).toBe("$85,000 per year");
    expect(displaySalary("$1,370,000.00 per year")).toBe("$1,370,000 per year");
    expect(displaySalary("€60,000 per annum")).toBe("€60,000 per year");
    expect(displaySalary("$45 annually")).toBe("$45 per year");
  });
  it("tidies feed-specific suffixes without touching numbers", () => {
    expect(displaySalary("$562k–572k/per-year-salary")).toBe("$562k–572k/year");
    expect(displaySalary("$30/per-hour-rate")).toBe("$30/hour");
  });
  it("normalizes range separators and doubled currency markers", () => {
    expect(displaySalary("USD 105,000 - 135,000")).toBe("USD 105,000–135,000");
    expect(displaySalary("USD $85,000 to $95,000")).toBe("$85,000–$95,000");
  });
  it("leaves clean strings untouched", () => {
    expect(displaySalary("CAD 90,000–110,000 per year")).toBe("CAD 90,000–110,000 per year");
  });
});
