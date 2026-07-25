// Categoriser coverage (CATEGORIZE_VERSION 4).
//
// Live audit 2026-07-24: 199,667 of 570,663 postings (35%) sat in "other",
// which silently hides a third of the board from the category filter. A
// 1,250-row sample of that pile produced the rules below — every "now routed"
// case here is a REAL title taken from it, not an invented example.
//
// The regression half matters as much: the new trades tier sits ahead of
// hospitality_retail, so it is exactly the kind of change that can quietly
// re-route unrelated roles.
import { describe, it, expect } from "vitest";
import { categorize } from "../../supabase/functions/job-board/categories";

describe("categorize — real titles that used to fall through to 'other'", () => {
  it("routes retail banking to finance", () => {
    expect(categorize("Universal Teller I (Part Time)")).toBe("finance");
    expect(categorize("Lead CSR/Teller - Solon, OH - Full Time")).toBe("finance");
    expect(categorize("Personal Banker")).toBe("finance");
    expect(categorize("Mortgage Loan Officer")).toBe("finance");
  });

  it("routes insurance claims and collections to finance", () => {
    expect(categorize("Subrogation Claims Adjuster")).toBe("finance");
    expect(categorize("Claims Field Consultant")).toBe("finance");
    expect(categorize("Claims Officer")).toBe("finance");
    expect(categorize("North America Indirect Collections Manager")).toBe("finance");
  });

  it("routes skilled trades and field services to operations", () => {
    for (const t of [
      "Construction Laborer",
      "Journeyperson Electrician",
      "Electrician IV",
      "Foreman",
      "Concrete Restoration Crew Member",
      "Installer - Construction General Laborer",
      "Body Shop Manager",
      "Part-Time Oil Change Team Member - Shop#189",
    ]) {
      expect(categorize(t), t).toBe("operations");
    }
  });

  it("routes project delivery to operations (program manager stays product)", () => {
    expect(categorize("Technical Project Manager")).toBe("operations");
    expect(categorize("Commissioning Project Manager")).toBe("operations");
    expect(categorize("Seasonal Project Coordinator")).toBe("operations");
    // The pre-existing product rule must still win for programme roles.
    expect(categorize("Technical Program Manager")).toBe("product");
    expect(categorize("Product Manager")).toBe("product");
  });
});

describe("categorize — regressions the new trades tier could have caused", () => {
  it("keeps hospitality where it belongs", () => {
    expect(categorize("Hourly Coffee Shop Manger (Keyholder)")).toBe("hospitality_retail");
    expect(categorize("Barista")).toBe("hospitality_retail");
    expect(categorize("Restaurant Server")).toBe("hospitality_retail");
    expect(categorize("Store Manager")).toBe("hospitality_retail");
  });

  it("keeps the pre-existing precedence intact", () => {
    expect(categorize("Security Engineer")).toBe("engineering");
    expect(categorize("SOC Analyst")).toBe("security");
    expect(categorize("Clinical Research Nurse")).toBe("healthcare");
    expect(categorize("Behavior Technician")).toBe("healthcare");
    expect(categorize("Data Scientist")).toBe("data_ai");
    expect(categorize("IT Technician")).toBe("engineering");
  });

  it("does not let 'teller' leak out of whole words", () => {
    // \bteller\b must not fire inside "storyteller".
    expect(categorize("Brand Storyteller")).not.toBe("finance");
  });

  it("still returns 'other' when nothing genuinely matches", () => {
    expect(categorize("Zorbleflarg Wrangler")).toBe("other");
  });

  it("prefers the curated department over the title", () => {
    expect(categorize("Senior Technical Character Artist", "Art")).toBe("design");
    expect(categorize("Operator Robot", "Production")).toBe("operations");
  });
});
