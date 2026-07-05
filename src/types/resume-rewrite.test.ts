import { describe, it, expect } from "vitest";
import { assembleFinalResume, findUnresolvedBrackets, normalizeRewriteData } from "./resume-rewrite";
import { extractResumeFields, resumeToPlainText } from "@/lib/ats-extraction";

const rawData = {
  contact: { fullName: "Jane Doe", title: "Engineer", email: "jane@x.com", phone: "", location: "", linkedIn: "", website: "" },
  summary: { before: "Old summary", after: "New summary with [X]% impact", reason: "stronger" },
  experience: [
    {
      company: "Acme", title: "Dev", location: "", startDate: "2020", endDate: "2023",
      bullets: [
        { before: "Responsible for builds", after: "Automated builds, cutting release time by [X]%", reason: "metric", reverted: false },
        { before: "Wrote tests", after: "Wrote tests", reason: "", reverted: false },
      ],
    },
  ],
  education: [], skills: ["CI/CD"], certifications: [], strategy: "",
  originalResumeText: "Jane Doe...", jobDetails: { title: "", company: "" },
  grounding: { droppedBullets: 0, revertedBullets: 0, droppedJobs: 0, droppedSkills: 0, notes: [] },
  bracketCount: 2, modelUsed: "test", generatedAt: "",
};

describe("resume-rewrite review model", () => {
  it("normalizes and assembles accepted changes; reverts declined ones", () => {
    const data = normalizeRewriteData(rawData as unknown as Record<string, unknown>);
    const resume = assembleFinalResume(data, true, "Filled summary", {
      "0-0": { text: "Automated builds, cutting release time by 40%", accepted: true },
      "0-1": { text: "Wrote tests", accepted: false },
    });
    expect(resume.summary).toBe("Filled summary");
    expect(resume.experience[0].bullets[0]).toContain("40%");
    expect(resume.experience[0].bullets[1]).toBe("Wrote tests");
  });

  it("flags unresolved [brackets] and clears once filled", () => {
    const data = normalizeRewriteData(rawData as unknown as Record<string, unknown>);
    const withBrackets = assembleFinalResume(data, true, data.summary.after, {
      "0-0": { text: "Automated builds, cutting release time by [X]%", accepted: true },
      "0-1": { text: "Wrote tests", accepted: true },
    });
    expect(findUnresolvedBrackets(withBrackets).length).toBe(2);

    const filled = assembleFinalResume(data, true, "New summary with 12% impact", {
      "0-0": { text: "Automated builds, cutting release time by 40%", accepted: true },
      "0-1": { text: "Wrote tests", accepted: true },
    });
    expect(findUnresolvedBrackets(filled)).toEqual([]);
  });
});

describe("independent ATS extraction (compromise)", () => {
  it("extracts contact, sections, dates and bullets from generated plain text", async () => {
    const data = normalizeRewriteData(rawData as unknown as Record<string, unknown>);
    const resume = assembleFinalResume(data, true, "Senior engineer with 4 years of experience.", {
      "0-0": { text: "Automated builds, cutting release time by 40%", accepted: true },
      "0-1": { text: "Wrote tests", accepted: true },
    });
    const text = resumeToPlainText(resume);
    const extraction = await extractResumeFields(text);
    expect(extraction.emails).toContain("jane@x.com");
    expect(extraction.sectionsDetected).toEqual(expect.arrayContaining(["Summary", "Experience", "Skills"]));
    expect(extraction.bulletCount).toBe(2);
    expect(extraction.quantifiedBullets).toBe(1);
  });
});
