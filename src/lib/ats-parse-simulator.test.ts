import { describe, it, expect } from "vitest";
import { simulateAtsParse } from "./ats-parse-simulator";

const GOOD_RESUME = `
Jane Doe
jane@example.com | (555) 123-4567 | linkedin.com/in/janedoe

Summary
Senior engineer with 8 years of experience.

Experience
Senior Software Engineer, Acme Corp
Jan 2020 - Present
- Led a team of 5 engineers.

Software Engineer, Other Co
Jun 2017 - Dec 2019
- Built things.

Education
B.S. Computer Science, State University
2013 - 2017

Skills
JavaScript, TypeScript, React
`;

describe("simulateAtsParse", () => {
  it("scores a well-structured resume highly with all checks passing", () => {
    const result = simulateAtsParse(GOOD_RESUME, { multiColumnDetected: false });
    expect(result.overallConfidence).toBe(100);
    expect(result.checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("flags missing section headers", () => {
    const result = simulateAtsParse("Just some random text with no structure at all.");
    const sectionsCheck = result.checks.find((c) => c.id === "sections");
    expect(sectionsCheck?.status).toBe("fail");
  });

  it("flags missing contact info", () => {
    const result = simulateAtsParse("Experience\nEducation\nSkills\nNo contact details here.");
    const contactCheck = result.checks.find((c) => c.id === "contact");
    expect(contactCheck?.status).toBe("fail");
  });

  it("extracts email and phone when present", () => {
    const result = simulateAtsParse("Contact me at jane@example.com or (555) 123-4567.");
    const contactCheck = result.checks.find((c) => c.id === "contact");
    expect(contactCheck?.status).toBe("pass");
  });

  it("flags resumes with no parseable dates", () => {
    const result = simulateAtsParse("Experience\nSoftware Engineer at Acme.\nEducation\nSkills");
    const datesCheck = result.checks.find((c) => c.id === "dates");
    expect(datesCheck?.status).toBe("fail");
  });

  it("detects broken character encoding from replacement characters", () => {
    const result = simulateAtsParse("Experience\nSoftware Engineer � Acme Corp\nJan 2020 - Present");
    const encodingCheck = result.checks.find((c) => c.id === "encoding");
    expect(encodingCheck?.status).toBe("fail");
  });

  it("omits the layout check entirely when multiColumnDetected is not provided", () => {
    const result = simulateAtsParse(GOOD_RESUME);
    expect(result.checks.find((c) => c.id === "layout")).toBeUndefined();
  });

  it("flags a detected multi-column layout", () => {
    const result = simulateAtsParse(GOOD_RESUME, { multiColumnDetected: true });
    const layoutCheck = result.checks.find((c) => c.id === "layout");
    expect(layoutCheck?.status).toBe("fail");
  });

  it("gives a low confidence score for completely unstructured text", () => {
    const result = simulateAtsParse("asdf qwerty", { multiColumnDetected: true });
    // sections, contact, dates, and layout all fail; only encoding passes (no
    // broken characters) — confidence should reflect that, not be near 100.
    expect(result.overallConfidence).toBeLessThanOrEqual(20);
  });
});
