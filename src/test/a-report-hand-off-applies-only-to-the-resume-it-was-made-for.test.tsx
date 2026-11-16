/**
 * A REPORT'S HAND-OFF APPLIES ONLY TO THE RÉSUMÉ IT WAS MADE FOR (S14X-285: C-S14-136).
 *
 * WHAT WAS WRONG. "Open in builder with fixes applied" leaves the report's
 * rewrites and missing keywords in sessionStorage (rb_scan_fixes) for the
 * builder to apply after its import. Nothing tied that hand-off to the
 * résumé it was written for, and a failed import left it in place: the next
 * scan in the same tab, of a different résumé, opened in the builder with
 * the old report's keywords and rewrites applied to it.
 *
 * WHAT HOLDS NOW. A hand-off may carry the fingerprint of its résumé's text
 * (builder-import's textFingerprint; the free report and the gap report each
 * write it, in their own lanes). The builder drops a hand-off whose
 * fingerprint is not the text it is importing. One with no fingerprint (from
 * a page not yet updated) is used as before, so either side may publish
 * first, and when its import fails the builder binds it to that text, so it
 * waits for Try again and can never reach another résumé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
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

const A = "Jordan Probe\nThe résumé scanned in this tab now. ".padEnd(160, "A");
const B = "Someone Else\nA résumé scanned here earlier, a different text. ".padEnd(170, "B");
const parsed = { data: { success: true, contact: { fullName: "Imported Person" }, experience: [{ title: "Analyst", company: "Acme", bullets: ["Ran the weekly report"] }], education: [], skills: [] }, error: null };
const handoff = (fingerprint?: string) =>
  sessionStorage.setItem("rb_scan_fixes", JSON.stringify({ rewrites: [], keywords: ["stale-keyword-probe"], reportId: null, ...(fingerprint ? { fingerprint } : {}) }));
const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(parsed);
  sessionStorage.setItem("rb_resume_text", A);
});
afterEach(() => cleanup());

describe("the hand-off and the résumé it was made for", () => {
  it("one made for another résumé is dropped, not applied", async () => {
    handoff(textFingerprint(B));
    mount();
    await screen.findByDisplayValue("Imported Person");
    expect(screen.queryByText("stale-keyword-probe")).toBeNull();
    expect(sessionStorage.getItem("rb_scan_fixes")).toBeNull();
  });

  it("one made for this résumé is applied", async () => {
    handoff(textFingerprint(A));
    mount();
    await screen.findByDisplayValue("Imported Person");
    expect(screen.getByText("stale-keyword-probe")).toBeTruthy();
  });

  it("one with no fingerprint, from a page not yet updated, is applied as before", async () => {
    handoff();
    mount();
    await screen.findByDisplayValue("Imported Person");
    expect(screen.getByText("stale-keyword-probe")).toBeTruthy();
  });
});

describe("after a failed import", () => {
  it("the hand-off waits, bound to the text it failed on, and never reaches the next scan", async () => {
    handoff();
    invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(new Response("{}", { status: 500 })) });
    mount();
    await screen.findByText(i18n.t("builderPage.importFailed.generic"));
    const kept = JSON.parse(sessionStorage.getItem("rb_scan_fixes") ?? "null");
    expect(kept?.fingerprint, "the waiting hand-off is not bound to its résumé").toBe(textFingerprint(A));
    cleanup();
    // The person scans a different résumé in the same tab and opens the builder again.
    localStorage.clear();
    sessionStorage.setItem("rb_resume_text", B);
    mount();
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("parse-resume-structured", { body: { resumeText: B } }));
    await screen.findByDisplayValue("Imported Person");
    expect(screen.queryByText("stale-keyword-probe")).toBeNull();
  });
});
