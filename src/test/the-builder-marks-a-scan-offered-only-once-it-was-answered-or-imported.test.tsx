/**
 * THE BUILDER MARKS A SCAN OFFERED ONLY ONCE IT WAS ANSWERED OR IMPORTED
 * (S14X-127: C-S14-041, M-S14-101).
 *
 * WHAT WAS WRONG. Over a saved draft, the builder asks once whether to
 * replace it with the tab's newer scan, and remembers the scan (a fingerprint
 * in resumeBuilderImportedFrom) so it never asks twice. It wrote that mark
 * BEFORE asking: a "yes, replace" whose import then failed left the scan
 * marked, so it was never offered again and could never be imported. And a
 * successful import wrote the mark when it landed but saved the draft only
 * from a render effect, which never runs once the page has been left: leaving
 * mid-import marked the scan imported with no draft saved.
 *
 * WHAT HOLDS NOW. The mark is written on a "no", or together with the draft
 * when the import lands, mounted or not: both or neither. A failure writes
 * nothing. And an "Import my latest scan" button lets anyone whose browser
 * the old order already locked import the scan again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import i18n from "@/i18n";
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

const SCAN = "Jordan Probe\nSenior product analyst at Acme. ".padEnd(160, "B");
const MARK = "resumeBuilderImportedFrom";
const DRAFT = "resumeBuilderDraft";
const parsed = { data: { success: true, contact: { fullName: "Imported Person" }, experience: [], education: [], skills: [] }, error: null };
const oldDraft = () => {
  const r = createEmptyResume();
  r.contact.fullName = "Old Draft";
  return JSON.stringify(r);
};
const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
let confirm: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  sessionStorage.setItem("rb_resume_text", SCAN);
});
afterEach(() => {
  cleanup();
  confirm.mockRestore();
});

describe("C-S14-041: a 'yes, replace' whose import failed", () => {
  it("leaves the scan offerable, and the draft as it was", async () => {
    localStorage.setItem(DRAFT, oldDraft());
    invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ error: "The AI took too long to respond. Please try again." }), { status: 504 })) });
    mount();
    expect(confirm).toHaveBeenCalledTimes(1);
    await screen.findByText(i18n.t("builderPage.importFailed.tooLong"));
    expect(localStorage.getItem(MARK), "the failed import marked the scan as offered").not.toBe(textFingerprint(SCAN));
    expect(screen.getByDisplayValue("Old Draft")).toBeTruthy();
    cleanup();
    confirm.mockClear();
    invoke.mockResolvedValueOnce(parsed);
    mount();
    expect(confirm, "the next visit did not offer the scan again").toHaveBeenCalledTimes(1);
    expect(await screen.findByDisplayValue("Imported Person")).toBeTruthy();
  });

  it("a 'no' is still remembered", () => {
    localStorage.setItem(DRAFT, oldDraft());
    confirm.mockReturnValue(false);
    mount();
    expect(localStorage.getItem(MARK)).toBe(textFingerprint(SCAN));
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("M-S14-101: leaving mid-import", () => {
  it("never marks the scan imported without saving its draft", async () => {
    let land!: (v: unknown) => void;
    invoke.mockReturnValueOnce(new Promise((r) => { land = r; }));
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    cleanup();
    await act(async () => { land(parsed); });
    const marked = localStorage.getItem(MARK) === textFingerprint(SCAN);
    const saved = (localStorage.getItem(DRAFT) ?? "").includes("Imported Person");
    expect({ marked, saved }, "the mark and the draft are written together, or neither is").toEqual({ marked: saved, saved });
    expect(saved, "the import that landed after leaving was thrown away").toBe(true);
  });

  it("a failure after leaving writes nothing", async () => {
    let land!: (v: unknown) => void;
    invoke.mockReturnValueOnce(new Promise((r) => { land = r; }));
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    cleanup();
    await act(async () => { land({ data: null, error: new FunctionsHttpError(new Response("{}", { status: 500 })) }); });
    expect(localStorage.getItem(MARK)).toBeNull();
    expect(localStorage.getItem(DRAFT)).toBeNull();
  });

  it("an import that lands after a sign-out writes nothing", async () => {
    let land!: (v: unknown) => void;
    invoke.mockReturnValueOnce(new Promise((r) => { land = r; }));
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    cleanup();
    localStorage.setItem("rb_signed_out_at", String(Date.now() + 1));
    await act(async () => { land(parsed); });
    expect(localStorage.getItem(DRAFT)).toBeNull();
    expect(localStorage.getItem(MARK)).toBeNull();
  });
});

describe("Import my latest scan", () => {
  it("imports a scan the old order had already marked as offered", async () => {
    localStorage.setItem(DRAFT, oldDraft());
    localStorage.setItem(MARK, textFingerprint(SCAN));
    mount();
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce(parsed);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("builderPage.importLatest") }));
    expect(confirm).toHaveBeenCalledWith(i18n.t("resumeBuilder.replaceWithLatestScan"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("parse-resume-structured", { body: { resumeText: SCAN } }));
    expect(await screen.findByDisplayValue("Imported Person")).toBeTruthy();
  });

  it("is not offered when the tab holds no scan", () => {
    sessionStorage.clear();
    mount();
    expect(screen.queryByRole("button", { name: i18n.t("builderPage.importLatest") })).toBeNull();
  });
});
