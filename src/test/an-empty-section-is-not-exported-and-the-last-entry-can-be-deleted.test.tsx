/**
 * AN EMPTY SECTION IS NOT EXPORTED, AND THE LAST ENTRY CAN BE DELETED
 * (S14X-035: M-S14-036, C-S14-044).
 *
 * WHAT WAS WRONG. A new résumé starts with one blank job and one blank
 * school, and every import that finds none keeps a blank one. The exports
 * printed a section's heading whenever the section had an entry, filled or
 * not, so a graduate with no work history sent employers a PDF with an
 * EXPERIENCE heading over nothing (and the Word file and the rescan text did
 * the same). The editors would not delete the last entry (the delete button
 * showed only when there were two), so the blank one could not be removed.
 *
 * WHAT HOLDS NOW. Both exports, the preview and the rescan text keep only
 * entries with something filled in, and print a heading only over what is
 * left. Every entry, the last one included, has a delete button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import JSZip from "jszip";
import { Packer } from "docx";
import i18n from "@/i18n";
import type { BuilderEducationEntry, BuilderExperienceEntry, BuilderResume } from "@/types/resume-builder";

const drawn: string[] = [];
vi.mock("jspdf", async (importOriginal) => {
  const m = await importOriginal<typeof import("jspdf")>();
  function Recording(...args: unknown[]) {
    const pdf = new (m.jsPDF as unknown as new (...a: unknown[]) => InstanceType<typeof m.jsPDF>)(...args);
    const text = pdf.text.bind(pdf) as (...a: unknown[]) => unknown;
    (pdf as unknown as { text: (...a: unknown[]) => unknown }).text = (s: unknown, ...rest: unknown[]) => {
      for (const line of Array.isArray(s) ? s : [String(s)]) drawn.push(String(line));
      return text(s, ...rest);
    };
    return pdf;
  }
  return { ...m, default: Recording, jsPDF: Recording };
});

import { buildResumeDocxDocument, buildResumePdf } from "@/lib/resume-builder-export";
import { builderResumeToText, educationEntryHasContent, experienceEntryHasContent } from "@/lib/builder-import";
import { ExperienceEditor } from "@/components/builder/ExperienceEditor";
import { EducationEditor } from "@/components/builder/EducationEditor";
import { ResumePreview } from "@/components/builder/ResumePreview";

const blankJob = (): BuilderExperienceEntry => ({ id: "x", company: "", title: "", location: "", startDate: "", endDate: "", bullets: [""] });
const blankSchool = (): BuilderEducationEntry => ({ id: "y", school: "", degree: "", field: "", startDate: "", endDate: "", details: "" });

const graduate = (): BuilderResume => ({
  contact: { fullName: "Jordan Probe", title: "Graduate", email: "jordan@example.com", phone: "", location: "", linkedIn: "", website: "" },
  summary: "A graduate looking for a first role in the team.",
  experience: [blankJob()],
  education: [blankSchool()],
  skills: ["SQL"],
  certifications: [],
});

afterEach(() => cleanup());

describe("what counts as an entry", () => {
  it("a blank job and a blank school have no content; one filled field is enough", () => {
    expect(experienceEntryHasContent(blankJob())).toBe(false);
    expect(experienceEntryHasContent({ ...blankJob(), bullets: ["  "] })).toBe(false);
    expect(experienceEntryHasContent({ ...blankJob(), bullets: ["Ran the report"] })).toBe(true);
    expect(educationEntryHasContent(blankSchool())).toBe(false);
    expect(educationEntryHasContent({ ...blankSchool(), endDate: "2019" })).toBe(true);
  });
});

describe("no heading over an empty section", () => {
  it("the PDF draws no EXPERIENCE or EDUCATION heading", async () => {
    drawn.length = 0;
    await buildResumePdf(graduate());
    expect(drawn).toContain("SUMMARY");
    expect(drawn).toContain("SKILLS");
    expect(drawn).not.toContain("EXPERIENCE");
    expect(drawn).not.toContain("EDUCATION");
  });

  it("the Word file has neither heading", async () => {
    const blob = await Packer.toBlob(await buildResumeDocxDocument(graduate()));
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file("word/document.xml")!.async("string");
    expect(xml).toContain(">SKILLS<");
    expect(xml).not.toContain(">EXPERIENCE<");
    expect(xml).not.toContain(">EDUCATION<");
  });

  it("the rescan text has no EXPERIENCE or EDUCATION line", () => {
    const lines = builderResumeToText(graduate()).split("\n");
    expect(lines).toContain("SUMMARY");
    expect(lines).not.toContain("EXPERIENCE");
    expect(lines).not.toContain("EDUCATION");
  });

  it("a filled entry beside a blank one is exported alone", async () => {
    const r = graduate();
    r.experience = [blankJob(), { ...blankJob(), id: "z", title: "Intern", company: "Acme" }];
    drawn.length = 0;
    await buildResumePdf(r);
    expect(drawn).toContain("EXPERIENCE");
    expect(drawn.filter((s) => s === "Intern")).toHaveLength(1);
    expect(builderResumeToText(r)).toContain("Intern, Acme");
  });

  it("the preview shows neither heading", () => {
    render(<ResumePreview resume={graduate()} />);
    expect(screen.getByRole("heading", { name: "Summary" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Experience" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Education" })).toBeNull();
  });
});

describe("the last entry can be deleted", () => {
  it("one job has a delete button, and pressing it leaves no job", () => {
    const onChange = vi.fn();
    render(<ExperienceEditor entries={[blankJob()]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("builderPage.removeEntry") }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("one school has a delete button, and pressing it leaves no school", () => {
    const onChange = vi.fn();
    render(<EducationEditor entries={[blankSchool()]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("builderPage.removeEntry") }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
