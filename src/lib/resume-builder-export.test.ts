import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeFilename, exportResumeBuilderPDF, exportResumeBuilderDocx } from "./resume-builder-export";
import type { BuilderResume } from "@/types/resume-builder";

describe("sanitizeFilename", () => {
  it("replaces spaces with underscores", () => {
    expect(sanitizeFilename("Jane Doe")).toBe("Jane_Doe");
  });

  it("strips filesystem-invalid characters", () => {
    expect(sanitizeFilename('Mary/Jane "The Best" O\\Brien')).not.toMatch(/[/\\:*?"<>|]/);
  });

  it("does not produce doubled underscores from adjacent stripped characters", () => {
    // "/" and " " are adjacent here — stripping "/" then replacing the space
    // could otherwise leave "Mary__Jane" instead of "Mary_Jane".
    expect(sanitizeFilename("Mary/ Jane")).toBe("Mary_Jane");
  });

  it("trims leading/trailing underscores produced by stripped characters at the edges", () => {
    expect(sanitizeFilename("/Mary Jane/")).toBe("Mary_Jane");
  });

  it("falls back to 'resume' if the name is empty or entirely stripped", () => {
    expect(sanitizeFilename("")).toBe("resume");
    expect(sanitizeFilename("///")).toBe("resume");
  });

  it("preserves accented characters (not filesystem-invalid)", () => {
    expect(sanitizeFilename("François Müller")).toBe("François_Müller");
  });
});

function buildSampleResume(overrides?: Partial<BuilderResume>): BuilderResume {
  return {
    contact: {
      fullName: "Jane Doe",
      title: "Senior Software Engineer",
      email: "jane@example.com",
      phone: "(555) 123-4567",
      location: "San Francisco, CA",
      linkedIn: "linkedin.com/in/janedoe",
      website: "",
    },
    summary: "Experienced engineer with 8 years building scalable systems.",
    experience: [
      {
        id: "1",
        company: "Acme Corp",
        title: "Senior Software Engineer",
        location: "San Francisco, CA",
        startDate: "Jan 2020",
        endDate: "Present",
        bullets: ["Led a team of 5 engineers.", "Reduced costs by 30%."],
      },
    ],
    education: [
      {
        id: "1",
        school: "State University",
        degree: "B.S.",
        field: "Computer Science",
        startDate: "2013",
        endDate: "2017",
        details: "",
      },
    ],
    skills: ["JavaScript", "TypeScript", "React"],
    certifications: [],
    ...overrides,
  };
}

// jsPDF's .save() and the docx download trigger both rely on browser DOM APIs
// (creating an <a> element, clicking it) — mock just enough of that so the
// underlying document-generation logic actually runs end-to-end and any real
// regression there (a library call that throws) still fails this test.
beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("exportResumeBuilderPDF", () => {
  it("generates a PDF without throwing for a normal resume", async () => {
    await expect(exportResumeBuilderPDF(buildSampleResume())).resolves.not.toThrow();
  });

  it("handles a resume with empty optional sections without throwing", async () => {
    const resume = buildSampleResume({ experience: [], education: [], skills: [], certifications: [] });
    await expect(exportResumeBuilderPDF(resume)).resolves.not.toThrow();
  });

  it("handles a very long bullet list without throwing (pagination)", async () => {
    const longBullets = Array.from({ length: 40 }, (_, i) => `Achievement number ${i + 1} with a reasonably long description of impact and scope.`);
    const resume = buildSampleResume({
      experience: [{ id: "1", company: "Acme", title: "Engineer", location: "SF", startDate: "2018", endDate: "Present", bullets: longBullets }],
    });
    await expect(exportResumeBuilderPDF(resume)).resolves.not.toThrow();
  });
});

describe("exportResumeBuilderDocx", () => {
  it("generates a DOCX without throwing for a normal resume", async () => {
    await expect(exportResumeBuilderDocx(buildSampleResume())).resolves.not.toThrow();
  });

  it("handles a resume with empty optional sections without throwing", async () => {
    const resume = buildSampleResume({ experience: [], education: [], skills: [], certifications: [] });
    await expect(exportResumeBuilderDocx(resume)).resolves.not.toThrow();
  });
});
