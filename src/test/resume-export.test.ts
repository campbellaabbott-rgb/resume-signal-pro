// Resume export: locks the formatting pipeline against crashes and gross
// regressions. jsPDF runs headless in Node, so we render real documents and
// assert structure. The pixel-level correctness (no title/date overlap, clean
// wraps) was verified visually when these fixes landed; this guards the wiring.
import { describe, it, expect } from "vitest";
import { sanitizeFilename, buildResumePdf, type ResumeTemplate } from "../lib/resume-builder-export";
import { normalizeBuilderResume } from "../types/resume-builder";

const templates: ResumeTemplate[] = ["modern", "classic", "compact"];

const realistic = normalizeBuilderResume({
  contact: { fullName: "Alexandra Chen", title: "Senior Product Manager", email: "a@e.com", phone: "555", location: "SF", linkedIn: "", website: "" },
  summary: "Product leader.",
  experience: [{ company: "Datadog", title: "Senior Product Manager", location: "SF", startDate: "2021", endDate: "Present", bullets: ["Shipped a thing that made money."] }],
  education: [{ school: "Berkeley", degree: "B.S.", field: "EECS", startDate: "2010", endDate: "2014", details: "" }],
  skills: ["SQL", "Figma", "Roadmapping"],
  certifications: ["PMC-VI"],
});

// Long title + long degree that previously overprinted the right-aligned date.
const collisions = normalizeBuilderResume({
  contact: { fullName: "Bartholomew Alexander Fitzgerald-Montgomery III", title: "", email: "b@e.com", phone: "", location: "", linkedIn: "", website: "" },
  summary: "",
  experience: [{ company: "A Very Long Company Name Incorporated", title: "Senior Staff Software Engineer, Platform Infrastructure & Reliability", location: "SF", startDate: "January 2021", endDate: "Present", bullets: ["Did distributed systems at scale across many regions and teams."] }],
  education: [{ school: "MIT", degree: "Master of Science", field: "Electrical Engineering and Computer Science, Distributed Systems Concentration", startDate: "2015", endDate: "2017", details: "" }],
  skills: [], certifications: [],
});

const longResume = normalizeBuilderResume({
  contact: { fullName: "Jordan Rivera", title: "Engineering Manager", email: "j@e.com", phone: "", location: "", linkedIn: "", website: "" },
  summary: "Leader.",
  experience: Array.from({ length: 8 }, (_, i) => ({ company: `Co ${i}`, title: `Engineering Manager ${i}`, location: "TX", startDate: `${2010 + i}`, endDate: `${2011 + i}`, bullets: ["A bullet that is reasonably long so the whole thing spills onto a second page eventually.", "Another one.", "A third."] })),
  education: [{ school: "UT", degree: "B.S.", field: "CS", startDate: "2006", endDate: "2010", details: "" }],
  skills: ["Go"], certifications: [],
});

const sparse = normalizeBuilderResume({
  contact: { fullName: "Sam Lee", title: "", email: "s@e.com", phone: "", location: "", linkedIn: "", website: "" },
  summary: "",
  experience: [{ company: "Acme", title: "Analyst", location: "", startDate: "2022", endDate: "", bullets: ["Did analysis."] }],
  education: [], skills: ["Excel"], certifications: [],
});

describe("sanitizeFilename", () => {
  it("strips filesystem-invalid characters and collapses underscores", () => {
    expect(sanitizeFilename("Mary/Jane O'Brien")).toBe("MaryJane_O'Brien");
    expect(sanitizeFilename("  /  ")).toBe("resume");
    expect(sanitizeFilename("")).toBe("resume");
    expect(sanitizeFilename("A: B * C")).toBe("A_B_C");
  });
});

describe("buildResumePdf renders every fixture × template without throwing", () => {
  for (const template of templates) {
    for (const [name, resume] of Object.entries({ realistic, collisions, longResume, sparse })) {
      it(`${name} / ${template}`, async () => {
        const pdf = await buildResumePdf(resume, { template });
        const bytes = pdf.output("arraybuffer");
        expect(bytes.byteLength).toBeGreaterThan(1500); // real content, not an empty page
      });
    }
  }

  it("a long resume paginates to more than one page", async () => {
    const pdf = await buildResumePdf(longResume, { template: "modern" });
    // jsPDF keeps a 1-indexed pages array (index 0 is a placeholder).
    const pageCount = (pdf.internal as unknown as { pages: unknown[] }).pages.length - 1;
    expect(pageCount).toBeGreaterThanOrEqual(2);
  });

  it("a sparse resume stays on a single page", async () => {
    const pdf = await buildResumePdf(sparse, { template: "compact" });
    const pageCount = (pdf.internal as unknown as { pages: unknown[] }).pages.length - 1;
    expect(pageCount).toBe(1);
  });
});
