/**
 * EVERY BUILDER FIELD IS NAMED BY ITS LABEL, NOT ITS SAMPLE (NB-45, the builder's part).
 *
 * WHAT WAS WRONG. Each field on /builder sat under a visible label, but no
 * label was tied to its field (no htmlFor, no id), so a screen reader named
 * each field by its placeholder: the sample data. Tabbing through the form
 * read "Jane Doe, edit text", "Senior Product Designer, edit text",
 * "(555) 123-4567, edit text". The summary and the bullets had no label at
 * all, and the delete buttons were bare icons.
 *
 * WHAT HOLDS NOW. Every label is tied to its field, the summary is named by
 * its section heading, each bullet by its number, and every icon button by
 * what it does. No field is named by sample data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { computeAccessibleName } from "dom-accessibility-api";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { createEmptyResume } from "@/types/resume-builder";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  const r = createEmptyResume();
  r.experience[0].bullets = ["", ""];
  localStorage.setItem("resumeBuilderDraft", JSON.stringify({ ...r, contact: { ...r.contact, fullName: "Named Person" } }));
});
afterEach(() => cleanup());

describe("the builder's fields", () => {
  it("each is named by its label", () => {
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    const labelled = [
      "resumeBuilder.contact.fullName", "resumeBuilder.contact.title", "resumeBuilder.contact.email", "resumeBuilder.contact.phone",
      "resumeBuilder.contact.location", "resumeBuilder.contact.linkedIn", "resumeBuilder.contact.website",
      "resumeBuilder.experience.jobTitle", "resumeBuilder.experience.company", "resumeBuilder.experience.location",
      "resumeBuilder.experience.startDate", "resumeBuilder.experience.endDate",
      "resumeBuilder.education.school", "resumeBuilder.education.degree", "resumeBuilder.education.fieldOfStudy",
      "resumeBuilder.education.startDate", "resumeBuilder.education.endDate", "resumeBuilder.education.additionalDetails",
    ];
    for (const k of labelled) {
      // Experience and education share the words "Location", "Start Date" and "End Date": each is named at least once.
      expect(screen.getAllByRole("textbox", { name: t(k) }).length, `${k}: no field is named "${t(k)}"`).toBeGreaterThan(0);
    }
    expect(screen.getByRole("textbox", { name: t("resumeBuilder.section.summary") })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: t("builderPage.bullet", { num: 1 }) })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: t("builderPage.bullet", { num: 2 }) })).toBeTruthy();
  });

  it("every field has a name of its own, never its sample text", () => {
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    // The skills and certifications inputs (TagListEditor, a file of no lane in
    // this round) carry an instruction as placeholder, not sample data.
    const tagInputs = new Set([t("resumeBuilder.placeholder.skill"), t("resumeBuilder.placeholder.certification")]);
    const fields = screen.getAllByRole("textbox").filter((el) => !tagInputs.has(el.getAttribute("placeholder") ?? ""));
    expect(fields.length).toBeGreaterThan(15);
    const bad = fields
      .map((el) => ({ name: computeAccessibleName(el), placeholder: el.getAttribute("placeholder") ?? "" }))
      .filter((f) => !f.name.trim() || f.name === f.placeholder);
    expect(bad, "fields named by nothing, or by their sample text").toEqual([]);
  });

  it("every icon button says what it does", () => {
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    const unnamed = screen.getAllByRole("button").filter((b) => !(b.getAttribute("aria-label") || b.textContent?.trim()));
    expect(unnamed.map((b) => b.outerHTML.slice(0, 120))).toEqual([]);
    expect(screen.getAllByRole("button", { name: t("builderPage.removeBullet") })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: t("builderPage.removeEntry") })).toHaveLength(2);
  });
});
