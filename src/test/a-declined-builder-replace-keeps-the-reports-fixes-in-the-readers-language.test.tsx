/**
 * A DECLINED BUILDER REPLACE KEEPS THE REPORT'S FIXES, IN THE READER'S
 * LANGUAGE (registers S13-126 and S13-127).
 *
 * S13-126. "Open in builder with fixes applied" over a saved draft asked
 * whether to replace the draft. On No the builder deleted the hand-off and
 * returned: every rewrite and the missing-keyword strip were gone, with no
 * word, and the button's promise ("fixes applied") was broken. Now No keeps
 * the draft and merges: each rewrite whose bullet is in the draft replaces
 * it (the same once-only matching an import uses), the keyword strip shows,
 * and a toast says how many landed, including none.
 *
 * S13-127. /builder's heading, buttons, banners, section labels,
 * placeholders, toasts, the Start Over confirm and the SEO title were English
 * in every locale. They are read from resumeBuilder.* now.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import { createEmptyResume, type BuilderResume } from "@/types/resume-builder";

const de = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/de.json"), "utf8"));

const { invoke, toast, seo, exportPdf } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  seo: vi.fn(),
  exportPdf: vi.fn(async (): Promise<undefined> => undefined),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }), toast: (...a: unknown[]) => toast(...a) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: (p: unknown) => { seo(p); return null; } }));
vi.mock("@/lib/resume-builder-export", () => ({ exportResumeBuilderPDF: () => exportPdf(), exportResumeBuilderDocx: async () => undefined }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const SCAN = "Jordan Probe\nSenior product analyst. ".padEnd(140, "B");
const LONG = "Managed budget of $2M across 3 regions and cut vendor spend by 12%";
const REWRITE = "Owned a $2M budget across three regions, cutting vendor spend 12% in a year";

const draft = (bullets: string[]): BuilderResume => {
  const r = createEmptyResume();
  r.contact.fullName = "Old Draft";
  r.experience = [{ ...r.experience[0], title: "Analyst", company: "Acme", bullets }];
  return r;
};
const handoff = (rewrites: Array<{ before: string; after: string }>, keywords: string[]) =>
  sessionStorage.setItem("rb_scan_fixes", JSON.stringify({ rewrites, keywords, reportId: "RB7Q2K9X" }));
const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
const savedBullets = () => (JSON.parse(localStorage.getItem("resumeBuilderDraft") ?? "{}") as BuilderResume).experience?.[0]?.bullets;

let confirm: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  toast.mockReset();
  seo.mockReset();
  exportPdf.mockReset();
  confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(async () => {
  cleanup();
  confirm.mockRestore();
  await i18n.changeLanguage("en");
});

describe("S13-126: No keeps the draft and the report's fixes", () => {
  it("merges the rewrites that match the draft's bullets and shows the keywords", async () => {
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draft(["Ran the weekly report", LONG])));
    sessionStorage.setItem("rb_resume_text", SCAN);
    handoff([{ before: LONG, after: REWRITE }, { before: "A bullet not in this draft at all", after: "Rewritten elsewhere" }], ["SQL", "Tableau"]);
    mount();
    expect(confirm).toHaveBeenCalledWith(en.resumeBuilder.replaceWithFixes);
    expect(invoke, "a declined replace still parsed the scan").not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Old Draft")).toBeTruthy();
    await waitFor(() => expect(savedBullets()).toEqual(["Ran the weekly report", REWRITE]));
    expect(screen.getByText("SQL")).toBeTruthy();
    expect(screen.getByText("Tableau")).toBeTruthy();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t("resumeBuilder.toast.mergedTitle", { count: 1 }) }));
    expect(sessionStorage.getItem("rb_scan_fixes"), "the handoff was left to apply twice").toBeNull();
  });

  it("says so when none of the rewrites match the draft, and still shows the keywords", async () => {
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draft(["Ran the weekly report"])));
    sessionStorage.setItem("rb_resume_text", SCAN);
    handoff([{ before: LONG, after: REWRITE }], ["SQL"]);
    mount();
    expect(screen.getByText("SQL")).toBeTruthy();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: en.resumeBuilder.toast.mergedNoneTitle })));
    expect(savedBullets()).toEqual(["Ran the weekly report"]);
  });

  it("does not ask again on the next visit", async () => {
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draft([LONG])));
    sessionStorage.setItem("rb_resume_text", SCAN);
    handoff([{ before: LONG, after: REWRITE }], []);
    mount();
    await waitFor(() => expect(savedBullets()).toEqual([REWRITE]));
    cleanup();
    mount();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("S13-127: the builder in German", () => {
  const ENGLISH = [
    "Resume Builder", "Start Over", "Export DOCX", "Export PDF", "Contact", "Summary", "Experience",
    "Education", "Skills", "Certifications", "Preview", "Full Name", "Title / Headline", "Add Work Experience", "Add Education", "Add Bullet",
    "Keywords your scan found missing", "We never auto-insert keywords",
  ];

  it("names nothing in English on the page, the placeholders or the SEO title", async () => {
    i18n.addResourceBundle("de", "translation", de, true, true);
    await i18n.changeLanguage("de");
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draft([LONG])));
    sessionStorage.setItem("rb_resume_text", SCAN);
    handoff([], ["SQL"]);
    const { container } = mount();
    expect(screen.getAllByRole("heading", { level: 1 })[0].textContent).toBe(de.resumeBuilder.title);
    const text = container.textContent ?? "";
    for (const s of ENGLISH) expect(text.includes(s), `"${s}" on the German page`).toBe(false);
    const placeholders = [...container.querySelectorAll("[placeholder]")].map((e) => e.getAttribute("placeholder"));
    for (const p of ["Add a skill and press Enter", "Add a certification and press Enter"]) expect(placeholders).not.toContain(p);
    expect(placeholders.some((p) => p?.startsWith("A brief 2-4 sentence"))).toBe(false);
    expect(seo).toHaveBeenCalledWith(expect.objectContaining({ title: de.resumeBuilder.seo.title, description: de.resumeBuilder.seo.description }));
    expect(de.resumeBuilder.seo.title).not.toBe(en.resumeBuilder.seo.title);
  });

  it("asks before Start Over, and reports a failed export, in German", async () => {
    i18n.addResourceBundle("de", "translation", de, true, true);
    await i18n.changeLanguage("de");
    mount();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(de.resumeBuilder.startOver) }));
    expect(confirm).toHaveBeenCalledWith(de.resumeBuilder.confirmStartOver);
    exportPdf.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(de.resumeBuilder.exportPdf) }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: de.resumeBuilder.toast.exportFailedTitle, description: de.resumeBuilder.toast.exportPdfFailed })));
  });
});
