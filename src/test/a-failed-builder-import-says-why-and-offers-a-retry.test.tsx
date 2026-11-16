/**
 * A FAILED BUILDER IMPORT SAYS WHY, AND OFFERS A RETRY (S14X-070: C-S14-040).
 *
 * WHAT WAS WRONG. /builder imports the scanned résumé through
 * parse-resume-structured. When that call failed (the day's limit, a busy
 * model, credits out, a timeout) the page wrote a line to the console and
 * stopped: the "Importing" banner went away and the person was left with an
 * empty builder and no word of what happened or what to do.
 *
 * WHAT HOLDS NOW. A failure shows a banner in the reader's language saying
 * why (the 15-a-day limit, busy, paused, too long, or something else), with a
 * Try again button that runs the same import. When the report's fixes were
 * waiting on the import, the banner says they will apply once it works, and
 * the hand-off is kept for the retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/lib/resume-builder-export", async (importOriginal) => ({ ...(await importOriginal<object>()), exportResumeBuilderPDF: async () => undefined, exportResumeBuilderDocx: async () => undefined }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const SCAN = "Jordan Probe\nProduct analyst at Acme. ".padEnd(160, "A");
const parsed = { data: { success: true, contact: { fullName: "Imported Person" }, experience: [{ title: "Analyst", company: "Acme", bullets: ["Ran the weekly report"] }], education: [], skills: [] }, error: null };
const refused = (status: number, body: Record<string, unknown>) =>
  ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) });

const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  sessionStorage.setItem("rb_resume_text", SCAN);
});
afterEach(() => cleanup());

describe("each failure is named in the reader's language", () => {
  it.each([
    ["the day's limit (429 from the spend gate)", 429, { error: "You've reached the limit for this tool for now. Please try again later.", code: "rate_limited_function", limit: 15 }, "dailyLimit"],
    ["a busy model (429 with no gate code)", 429, { error: "AI service is temporarily busy. Please try again in a few moments.", retryable: true }, "busy"],
    ["a busy gate (503)", 503, { error: "This tool is temporarily unavailable. Please try again in a minute.", code: "limiter_unavailable" }, "busy"],
    ["credits out (402)", 402, { error: "AI service credits depleted. Please try again later.", retryable: false }, "paused"],
    ["a timeout (504)", 504, { error: "The AI took too long to respond. Please try again.", retryable: true }, "tooLong"],
    ["a reply cut off (422)", 422, { error: "The parser returned a malformed draft. Please try again.", retryable: true }, "tooLong"],
    ["anything else (500)", 500, { error: "Failed to parse resume. Please try again." }, "generic"],
  ])("%s", async (_what, status, body, kind) => {
    invoke.mockResolvedValueOnce(refused(status as number, body as Record<string, unknown>));
    mount();
    expect(await screen.findByText(i18n.t(`builderPage.importFailed.${kind}`))).toBeTruthy();
    expect(screen.getByText(i18n.t("builderPage.importFailed.title"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("resumeBuilder.importing"))).toBeNull();
  });

  it("a network failure that throws is named too", async () => {
    invoke.mockRejectedValueOnce(new FunctionsFetchError(new TypeError("Failed to fetch")));
    mount();
    expect(await screen.findByText(i18n.t("builderPage.importFailed.generic"))).toBeTruthy();
  });

  it("a 200 that says it did not succeed is a failure, not an empty import", async () => {
    invoke.mockResolvedValueOnce({ data: { success: false, error: "x" }, error: null });
    mount();
    expect(await screen.findByText(i18n.t("builderPage.importFailed.generic"))).toBeTruthy();
  });
});

describe("Try again", () => {
  it("runs the same import, and the résumé lands", async () => {
    invoke.mockResolvedValueOnce(refused(504, { error: "The AI took too long to respond. Please try again." }));
    mount();
    const retry = await screen.findByRole("button", { name: i18n.t("builderPage.importFailed.retry") });
    invoke.mockResolvedValueOnce(parsed);
    fireEvent.click(retry);
    expect(await screen.findByDisplayValue("Imported Person")).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]).toEqual(invoke.mock.calls[0]);
    expect(invoke.mock.calls[1][1]).toEqual({ body: { resumeText: SCAN } });
    await waitFor(() => expect(screen.queryByText(i18n.t("builderPage.importFailed.title"))).toBeNull());
  });

  it("says the report's fixes are waiting, keeps them for the retry, and applies them when it works", async () => {
    sessionStorage.setItem("rb_scan_fixes", JSON.stringify({ rewrites: [{ before: "Ran the weekly report", after: "Owned the weekly report for four teams" }], keywords: ["Tableau"], reportId: null }));
    invoke.mockResolvedValueOnce(refused(429, { error: "AI service is temporarily busy. Please try again in a few moments." }));
    mount();
    expect(await screen.findByText(i18n.t("builderPage.importFailed.fixesWaiting"))).toBeTruthy();
    expect(sessionStorage.getItem("rb_scan_fixes"), "the hand-off was dropped by the failure").not.toBeNull();
    invoke.mockResolvedValueOnce(parsed);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("builderPage.importFailed.retry") }));
    expect(await screen.findByDisplayValue("Owned the weekly report for four teams")).toBeTruthy();
    expect(screen.getByText("Tableau")).toBeTruthy();
    expect(sessionStorage.getItem("rb_scan_fixes")).toBeNull();
  });
});
