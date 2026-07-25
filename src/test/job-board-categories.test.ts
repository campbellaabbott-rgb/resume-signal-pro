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

// ── v5: rules from a fresh 3,000-row sample of the remaining "other" pile ──
// After v4 the pile was still 178,972 rows (31.4% of the board). The sample's
// top single word was "technician" (431) and its top bigram "cdl drivers"
// (136) — trucking and field service, not exotic roles.
describe("categorize v5 — real titles from the remaining uncategorised pile", () => {
  it("routes trucking to operations (plural 'drivers' could never match before)", () => {
    // The v4 rule listed `driver`, which inside \b(...)\b cannot match "Drivers".
    // The largest single cluster in the pile was invisible to it.
    for (const t of [
      "CDL-A Drivers needed for yard driver home DAILY! $28 HOURLY",
      "CDL A Truck Driver - Home Weekly",
      "Owner Operator - Flatbed",
      "OTR Drivers Needed",
      "Dispatcher",
    ]) {
      expect(categorize(t), t).toBe("operations");
    }
  });

  it("routes field/service technicians to operations", () => {
    expect(categorize("Service Technician")).toBe("operations");
    expect(categorize("Auto Body Technician")).toBe("operations");
    expect(categorize("Brand Enhancement Technician")).toBe("operations");
  });

  it("does NOT steal technicians that already had a home", () => {
    // The bare-technician rule sits after healthcare, engineering and security
    // on purpose — this is the regression it could have caused.
    expect(categorize("IT Technician")).toBe("engineering");
    expect(categorize("Network Technician")).toBe("engineering");
    expect(categorize("Pharmacy Technician")).toBe("healthcare");
    expect(categorize("Patient Care Technician")).toBe("healthcare");
    expect(categorize("Behavior Technician")).toBe("healthcare");
  });

  it("routes community and behavioural care to healthcare", () => {
    for (const t of [
      "Case Manager",
      "Direct Support Professional",
      "Mental Health Associate",
      "Hospice Aide",
      "Caregiver",
      "Home Health Aide",
    ]) {
      expect(categorize(t), t).toBe("healthcare");
    }
  });

  it("routes construction leadership to operations", () => {
    expect(categorize("Construction Superintendent")).toBe("operations");
    expect(categorize("Construction Manager")).toBe("operations");
    expect(categorize("Superintendent")).toBe("operations");
  });

  it("routes a bare adjuster to finance", () => {
    // "Independent Property Field Adjuster" never contains the word "claims",
    // so the claims-prefixed v4 rule could not reach it.
    expect(categorize("Independent Property Field Adjuster")).toBe("finance");
    expect(categorize("Field Adjuster")).toBe("finance");
  });

  it("keeps every v4 precedence intact", () => {
    expect(categorize("Data Scientist")).toBe("data_ai");
    expect(categorize("Security Engineer")).toBe("engineering");
    expect(categorize("SOC Analyst")).toBe("security");
    expect(categorize("Barista")).toBe("hospitality_retail");
    expect(categorize("Product Manager")).toBe("product");
    expect(categorize("Technical Program Manager")).toBe("product");
    expect(categorize("Zorbleflarg Wrangler")).toBe("other");
  });
});
