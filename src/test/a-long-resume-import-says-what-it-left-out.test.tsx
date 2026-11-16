/**
 * A LONG RÉSUMÉ IMPORT SAYS WHAT IT LEFT OUT (S14X-071: C-S14-042), the page.
 *
 * WHAT WAS WRONG. parse-resume-structured reads the first 20,000 characters
 * of the text it is sent; the scanner accepts 50,000. A longer résumé was cut
 * mid-line, and the builder opened with its later jobs, education and skills
 * simply missing, with nothing to say that anything was left out.
 *
 * WHAT HOLDS NOW. The function cuts at a line boundary and says so
 * (resumeTruncated, importedChars, totalChars; held by
 * a-long-resume-import-is-cut-at-a-line-and-says-so). The builder shows a
 * notice that stays: only the first N of M characters were imported, add the
 * rest below. Against a build of the function that predates those fields,
 * the page still knows the 20,000-character cap and says the same.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const structured = { success: true, contact: { fullName: "Imported Person" }, experience: [{ title: "Analyst", company: "Acme", bullets: ["Ran the weekly report"] }], education: [], skills: [] };
const lines = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i} of a long résumé with plenty of detail in it.`).join("\n");
const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("the notice", () => {
  it("names how much was imported out of how much, and stays", async () => {
    sessionStorage.setItem("rb_resume_text", lines(600));
    invoke.mockResolvedValueOnce({ data: { ...structured, resumeTruncated: true, importedChars: 19950, totalChars: 31000 }, error: null });
    mount();
    await screen.findByDisplayValue("Imported Person");
    expect(screen.getByText(i18n.t("builderPage.importTruncated", { imported: "19,950", total: "31,000" }))).toBeTruthy();
  });

  it("is said with the reader's own number format", async () => {
    await i18n.changeLanguage("de");
    sessionStorage.setItem("rb_resume_text", lines(600));
    invoke.mockResolvedValueOnce({ data: { ...structured, resumeTruncated: true, importedChars: 19950, totalChars: 31000 }, error: null });
    mount();
    await screen.findByDisplayValue("Imported Person");
    expect(document.body.textContent).toContain("19.950");
    expect(document.body.textContent).toContain("31.000");
  });

  it("does not show when the whole résumé was imported", async () => {
    sessionStorage.setItem("rb_resume_text", lines(100));
    invoke.mockResolvedValueOnce({ data: { ...structured, resumeTruncated: false, importedChars: 5600, totalChars: 5600 }, error: null });
    mount();
    await screen.findByDisplayValue("Imported Person");
    expect(screen.queryByText(/were imported\. Add the rest below/)).toBeNull();
  });

  it("an older function that says nothing still gets the notice for text past its cap", async () => {
    const text = lines(500);
    expect(text.length).toBeGreaterThan(20000);
    sessionStorage.setItem("rb_resume_text", text);
    invoke.mockResolvedValueOnce({ data: structured, error: null });
    mount();
    await screen.findByDisplayValue("Imported Person");
    expect(screen.getByText(i18n.t("builderPage.importTruncated", { imported: "20,000", total: text.length.toLocaleString("en") }))).toBeTruthy();
  });

  it("an older function and a short résumé: no notice", async () => {
    sessionStorage.setItem("rb_resume_text", lines(100));
    invoke.mockResolvedValueOnce({ data: structured, error: null });
    mount();
    await screen.findByDisplayValue("Imported Person");
    expect(screen.queryByText(/were imported\. Add the rest below/)).toBeNull();
  });
});
