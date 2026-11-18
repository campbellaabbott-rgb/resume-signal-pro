/**
 * A PAID REWRITE OPENS IN THE BUILDER WITHOUT REPLACING THE SCANNED RÉSUMÉ
 * (RC-S12-110, the builder's half).
 *
 * WHAT WAS WRONG. "Open in builder" after a paid rewrite wrote the rewrite
 * over rb_resume_text, the tab's copy of the person's own scanned résumé,
 * because that was the only key the builder read. Every page that reads the
 * scan from then on (the scanner, the board's fit, the next report) read the
 * rewrite as if it were the résumé the person uploaded.
 *
 * WHAT HOLDS NOW. The builder first reads a one-shot hand-off,
 * rb_builder_seed, removes it at once, and imports that text under the same
 * rules (ask over a draft, remember the answer). rb_resume_text is left as
 * the person's own scan. A page that still writes rb_resume_text is read as
 * before, so either side may publish first. (Past-buyers owns the writer.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { createEmptyResume } from "@/types/resume-builder";
import { textFingerprint } from "@/lib/builder-import";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const ORIGINAL = "Jordan Probe\nThe résumé the person uploaded and scanned. ".padEnd(160, "O");
const REWRITE = "Jordan Probe\nThe rewrite the paid product wrote for them. ".padEnd(170, "R");
const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
let confirm: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { success: true, contact: { fullName: "Rewritten Person" }, experience: [], education: [], skills: [] }, error: null });
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  confirm.mockRestore();
});

describe("the one-shot hand-off", () => {
  it("imports the rewrite, removes the hand-off, and leaves the scan alone", async () => {
    sessionStorage.setItem("rb_resume_text", ORIGINAL);
    sessionStorage.setItem("rb_builder_seed", REWRITE);
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("parse-resume-structured", { body: { resumeText: REWRITE } }));
    expect(await screen.findByDisplayValue("Rewritten Person")).toBeTruthy();
    expect(sessionStorage.getItem("rb_builder_seed"), "the hand-off was left to import again").toBeNull();
    expect(sessionStorage.getItem("rb_resume_text")).toBe(ORIGINAL);
    expect(localStorage.getItem("resumeBuilderImportedFrom")).toBe(textFingerprint(REWRITE));
  });

  it("asks before replacing a draft with it, and a no is remembered for that text", async () => {
    const draft = createEmptyResume();
    draft.contact.fullName = "Old Draft";
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draft));
    sessionStorage.setItem("rb_resume_text", ORIGINAL);
    sessionStorage.setItem("rb_builder_seed", REWRITE);
    confirm.mockReturnValue(false);
    mount();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Old Draft")).toBeTruthy();
    expect(sessionStorage.getItem("rb_builder_seed")).toBeNull();
    expect(localStorage.getItem("resumeBuilderImportedFrom")).toBe(textFingerprint(REWRITE));
  });

  it("without a hand-off, the tab's scan is imported as before", async () => {
    sessionStorage.setItem("rb_resume_text", ORIGINAL);
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("parse-resume-structured", { body: { resumeText: ORIGINAL } }));
  });
});
