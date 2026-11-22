/**
 * A KEYWORD IS MARKED COVERED ONLY WHEN THE TAILORED TEXT HOLDS IT (S10-138).
 *
 * The tailoring card coloured every keyword the posting asks for green unless
 * the writer's own short list of gaps (at most five) named it. The tailored
 * text was never read: a keyword the writer forgot to list showed as covered
 * though the summary, the skills and the bullets did not hold it, and a
 * seeker who trusted the card sent a résumé without it. The card also printed
 * the writer's guess of a "+N%" better match, which nothing measured.
 *
 * Now a keyword is found only when the tailored summary, skills or bullets
 * hold it as a word of its own (the scanner's presence test: "Java" is not in
 * "JavaScript"), whatever the writer's gap list says, and no "+N%" is shown.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn(), dismiss() {}, toasts: [] }), toast: vi.fn() }));

import { TailoredResumeModal, type TailoredResumeContent } from "@/components/TailoredResumeModal";

afterEach(() => cleanup());

const CONTENT: TailoredResumeContent = {
  professionalSummary: "Platform engineer who builds Python services and JavaScript dashboards for payment teams.",
  keySkills: ["Terraform", "SQL", "Server management"],
  experienceHighlights: [
    { original: "Ran the build system.", tailored: "Moved forty services to GitHub Actions and cut deploy time by half.", keywordsInjected: ["GitHub Actions"] },
  ],
  // The writer listed no gaps at all, and one it did list is in the text.
  keywordsRequired: ["Kubernetes", "Terraform", "Python", "Java", "SQL Server", "GitHub Actions"],
  keywordGaps: ["Terraform"],
  matchScoreDelta: 25,
  suggestedJobTitle: "Senior Platform Engineer",
  coverLetterOpening: "Dear team,",
  applicationTips: [],
  jobTitle: "Senior Platform Engineer",
  jobCompany: "Northwind",
};

/** The first keyword chip on the card that names `keyword` (the coverage card sits above the skills). */
function chip(keyword: string): HTMLElement {
  const el = Array.from(document.body.querySelectorAll<HTMLElement>(".rounded-full")).find(
    (e) => (e.textContent ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() === keyword,
  );
  if (!el) throw new Error(`no chip for ${keyword}`);
  return el;
}
const shownAsCovered = (keyword: string) => /\bbg-green-50\b/.test(chip(keyword).className);

describe("the tailoring card's keyword coverage", () => {
  it("marks a keyword the text does not hold as not covered, though the writer listed no gap for it", () => {
    render(<TailoredResumeModal isOpen onClose={() => {}} content={CONTENT} />);
    expect(shownAsCovered("Kubernetes"), "Kubernetes is nowhere in the tailored text and was shown as covered").toBe(false);
    expect(shownAsCovered("Java"), "Java was read out of JavaScript").toBe(false);
    expect(shownAsCovered("SQL Server"), "SQL Server was read across two separate skills").toBe(false);
  });

  it("marks a keyword the text holds as covered, even one the writer listed as a gap", () => {
    render(<TailoredResumeModal isOpen onClose={() => {}} content={CONTENT} />);
    expect(shownAsCovered("Python")).toBe(true);
    expect(shownAsCovered("GitHub Actions")).toBe(true);
    expect(shownAsCovered("Terraform"), "a keyword in the skills was shown as missing because the writer said so").toBe(true);
  });

  it("counts from the text and shows no guessed match gain", () => {
    render(<TailoredResumeModal isOpen onClose={() => {}} content={CONTENT} />);
    expect(screen.queryByText(/\+25%/), "the writer's unmeasured +N% was shown").toBeNull();
    expect(screen.getByText(/3 of 6 keywords from the posting/)).toBeTruthy();
    expect(screen.getByText(/Not in the tailored text: 3\./)).toBeTruthy();
  });

  it("says each chip's state in words as well as colour", () => {
    render(<TailoredResumeModal isOpen onClose={() => {}} content={CONTENT} />);
    expect(chip("Kubernetes").textContent).toMatch(/Not in the text/);
    expect(chip("Python").textContent).toMatch(/In the text/);
  });
});
