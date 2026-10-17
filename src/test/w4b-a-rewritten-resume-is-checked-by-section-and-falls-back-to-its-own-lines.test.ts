/**
 * A REWRITTEN RÉSUMÉ IS CHECKED BY SECTION, READS "120K" AS 120,000, AND
 * FALLS BACK TO ITS OWN LINES.
 *
 * Critical path CP-018 (2026-10-12), the shared half: the figure check kept a
 * magnitude suffix, so "$120K" against a résumé's "$120,000" (or "1.2M"
 * against "1,200,000") was refused as invented in every writer that imports
 * it (cover letter, tailored résumé, apply kit, screening answers, the past
 * buyers' package). A skills section filled with the posting's keywords was
 * refused for the posting's own numbers. And a draft still inventing after
 * its repair had no last resort but a refusal.
 */
import { describe, expect, it } from "vitest";
import {
  restoreUnsupportedLines,
  rewrittenResumeFigureIssues,
  skillsLineMask,
  unsupportedNumericClaims,
} from "../../supabase/functions/_shared/resume-grounding";

describe("a figure with a magnitude suffix is the same figure written in full", () => {
  it("reads 120K, $120K and 1.2M as 120,000, $120,000 and 1,200,000, both ways round", () => {
    expect(unsupportedNumericClaims("Cut spend by $120,000 a year", "Cut spend by $120K a year")).toEqual([]);
    expect(unsupportedNumericClaims("Cut spend by $120K a year", "Cut spend by $120,000 a year")).toEqual([]);
    expect(unsupportedNumericClaims("Grew revenue to 1,200,000 euros", "Grew revenue to 1.2M euros")).toEqual([]);
    expect(unsupportedNumericClaims("Grew revenue to €1.2M", "Grew revenue to €1,200,000")).toEqual([]);
    expect(unsupportedNumericClaims("Served 2.5B requests", "Served 2,500,000,000 requests")).toEqual([]);
  });

  it("still refuses a different figure", () => {
    expect(unsupportedNumericClaims("Cut spend by $120,000 a year", "Cut spend by $150K a year")).toEqual(["$150K"]);
    expect(unsupportedNumericClaims("Grew revenue to 1,200,000 euros", "Grew revenue to 1.5M euros")).toEqual(["1.5M"]);
  });
});

describe("the skills section of a rewritten résumé", () => {
  const SOURCE = "Jane Doe\nEXPERIENCE\n- Built 40 Airflow pipelines\nSKILLS\nPython, Airflow";
  const POSTING = "ISO 27001 experience is a plus.";

  it("is the lines under a skills heading up to the next heading, or a one-line Skills:", () => {
    const text = ["Jane Doe", "EXPERIENCE", "- Built 40 Airflow pipelines", "## Core Skills", "Python", "Airflow, ISO 27001", "Education", "BSc, 2016", "Technical Skills: SQL, SOC 2"].join("\n");
    expect(skillsLineMask(text)).toEqual([false, false, false, false, true, true, false, false, true]);
  });

  it("may name the posting's own number; a bullet may not", () => {
    expect(rewrittenResumeFigureIssues(SOURCE, "EXPERIENCE\n- Built 40 Airflow pipelines\nSKILLS\nPython, Airflow, ISO 27001", POSTING)).toEqual([]);
    expect(rewrittenResumeFigureIssues(SOURCE, "EXPERIENCE\n- Built 40 Airflow pipelines to ISO 27001\nSKILLS\nPython", POSTING).join(" ")).toMatch(/27001/);
  });
});

describe("the last resort after a repair", () => {
  const SOURCE = [
    "Jane Doe",
    "- Built 40 Airflow pipelines moving 2TB a day",
    "- Cut warehouse spend by $120,000 a year",
  ].join("\n");

  it("puts each line that invents a figure back to the résumé line most like it, keeping the draft's bullet mark", () => {
    const draft = "Jane Doe\n• Built 40 Airflow pipelines serving 10,000 users\n• Cut warehouse spend by $250,000 a year\n• Partnered with analysts";
    const out = restoreUnsupportedLines(SOURCE, draft);
    expect(out.text).toBe("Jane Doe\n• Built 40 Airflow pipelines moving 2TB a day\n• Cut warehouse spend by $120,000 a year\n• Partnered with analysts");
    expect(out.restored).toHaveLength(2);
    expect(out.dropped).toEqual([]);
    expect(rewrittenResumeFigureIssues(SOURCE, out.text)).toEqual([]);
  });

  it("leaves out a line the résumé has nothing like, and uses each résumé line once", () => {
    const draft = "- Mentored 25 junior analysts across offices\n- Cut warehouse spend by $250,000 a year\n- Cut warehouse costs by $300,000";
    const out = restoreUnsupportedLines(SOURCE, draft);
    expect(out.dropped).toContain("- Mentored 25 junior analysts across offices");
    expect(out.text.match(/\$120,000/g)).toHaveLength(1);
    expect(rewrittenResumeFigureIssues(SOURCE, out.text)).toEqual([]);
  });

  it("keeps a skills line that names the posting's number when the posting is given", () => {
    const out = restoreUnsupportedLines(SOURCE, "SKILLS\nPython, ISO 27001", "ISO 27001 experience is a plus.");
    expect(out.text).toBe("SKILLS\nPython, ISO 27001");
  });
});
