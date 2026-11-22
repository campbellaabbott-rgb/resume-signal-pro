/**
 * EVERY BUILDER AND UPLOADER INPUT HAS A NAME (register NB-45, the inputs the
 * builder's own pass left out).
 *
 * The builder's skills and certifications inputs (TagListEditor) had only a
 * placeholder, "e.g. Python, Project Management", so a screen reader named
 * them by sample text, and each tag's remove button was a bare cross. The
 * uploader's Google Sheets link input had a placeholder and nothing else.
 * Each tag input is now named by the heading of the section it sits under,
 * each remove button by the tag it removes, and the Sheets input by its tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { computeAccessibleName } from "dom-accessibility-api";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { createEmptyResume } from "@/types/resume-builder";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";
import { ResumeUploader } from "@/components/ResumeUploader";
import { TagListEditor } from "@/components/builder/TagListEditor";

vi.setConfig(MOUNT_TEST_BUDGET);

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  const r = createEmptyResume();
  localStorage.setItem("resumeBuilderDraft", JSON.stringify({
    ...r, contact: { ...r.contact, fullName: "Named Person" }, skills: ["Python", "SQL"], certifications: ["CPA"],
  }));
});
afterEach(() => cleanup());

describe("the builder's tag lists", () => {
  it("each input is named by its section's heading, never by its sample text", () => {
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    const skills = screen.getByPlaceholderText(t("resumeBuilder.placeholder.skill"));
    const certs = screen.getByPlaceholderText(t("resumeBuilder.placeholder.certification"));
    expect(skills.getAttribute("aria-label")).toBe(t("resumeBuilder.section.skills"));
    expect(certs.getAttribute("aria-label")).toBe(t("resumeBuilder.section.certifications"));
    for (const el of [skills, certs]) expect(computeAccessibleName(el)).not.toBe(el.getAttribute("placeholder"));
  });

  it("each tag's remove button names the tag it removes", () => {
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    for (const tag of ["Python", "SQL", "CPA"]) {
      expect(screen.getByRole("button", { name: t("builderPage.removeTag", { tag }) })).toBeTruthy();
    }
  });

  it("the editor on its own: the label it is given is the input's name", () => {
    render(<TagListEditor tags={["React"]} onChange={vi.fn()} label="Skills" />);
    expect(screen.getByRole("textbox", { name: "Skills" })).toBeTruthy();
    const remove = screen.getByRole("button", { name: t("builderPage.removeTag", { tag: "React" }) });
    expect(remove.getAttribute("type")).toBe("button");
  });
});

describe("the uploader's Google Sheets link", () => {
  it("is named by its tab", () => {
    render(
      <MemoryRouter>
        <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} isLoading={false} hasContent resumeText="Jane Doe\nAnalyst" />
      </MemoryRouter>,
    );
    const toggle = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-expanded"))!;
    if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("tab", { name: t("uploader.modeTabs.googleSheets") }));
    const input = screen.getByPlaceholderText(t("uploader.gsheetsUrlPlaceholder"));
    expect(input.getAttribute("aria-label")).toBe(t("uploader.modeTabs.googleSheets"));
    expect(screen.getByRole("textbox", { name: t("uploader.modeTabs.googleSheets") })).toBe(input);
  });
});
