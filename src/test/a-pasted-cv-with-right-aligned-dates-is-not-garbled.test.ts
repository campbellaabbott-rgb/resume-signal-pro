/**
 * A PASTED CV WITH RIGHT-ALIGNED DATES IS NOT GARBLED (bug audit NB-20).
 *
 * The parse check counted any run of six identical characters as an
 * extraction artefact. A plain-text CV pasted from an editor right-aligns its
 * dates with spaces and underlines its headings with dashes or equals signs,
 * so a clean one was flagged "garbled characters detected". The run test now
 * skips whitespace and the rule and leader characters a person types.
 */
import { describe, expect, it } from "vitest";
import { computeParseQuality } from "../../supabase/functions/free-keyword-scan/resume-structure";

const PASTED = [
  "JORDAN LEE                                              jordan.lee@example.com",
  "=========================================================================",
  "SUMMARY",
  "-------",
  "Logistics planner with eight years in freight forwarding, customs paperwork and carrier negotiation for retail importers.",
  "",
  "EXPERIENCE",
  "----------",
  "Senior Logistics Planner, Harbor Imports                        Jan 2021 - Present",
  "  * Cut container dwell time by 2 days by re-sequencing drayage bookings",
  "  * Negotiated annual rates with 6 carriers, saving $310,000",
  "  * Built the weekly landed-cost report used by the buying team",
  "Logistics Coordinator, Bayline Forwarding                        Mar 2017 - Dec 2020",
  "  * Prepared customs entries for 120 shipments a month with no penalties",
  "  * Tracked 300 open purchase orders and flagged late vendors to buyers",
  "  * Trained 4 new coordinators on the booking system and filing rules",
  "",
  "EDUCATION",
  "_________",
  "BA Supply Chain Management, Portland State University ............... 2016",
  "",
  "SKILLS",
  "~~~~~~",
  "Freight forwarding, customs entries, carrier negotiation, landed cost, Excel, SAP",
  "Languages ........................................ English, Spanish",
  "References ....................................... available on request",
].join("\n");

describe("the typed layout of a plain-text CV is not an extraction artefact", () => {
  it("right-aligned dates, underlined headings and dot leaders leave a clean CV good", () => {
    const q = computeParseQuality(PASTED, "en");
    expect(q.issueCodes).not.toContain("garbled_characters");
    expect(q.verdict).toBe("good");
  });

  it("control: a run of a repeated letter or symbol a person does not type is still counted", () => {
    const broken = `${PASTED}\n${Array.from({ length: 6 }, () => "ÿÿÿÿÿÿÿÿ ####### ").join("\n")}`;
    expect(computeParseQuality(broken, "en").issueCodes).toContain("garbled_characters");
  });
});
