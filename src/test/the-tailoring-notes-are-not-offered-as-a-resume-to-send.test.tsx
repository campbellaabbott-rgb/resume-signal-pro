/**
 * THE TAILORING NOTES ARE NOT OFFERED AS A RÉSUMÉ TO SEND (S10-063, owner
 * decision 13 of 2026-11-21).
 *
 * The homepage's tailoring writer returns a summary, skills and rewritten
 * bullets for one posting, plus a cover-letter opening and application tips.
 * The page offered it as a résumé to send: the file was headed with a
 * placeholder name (the page never passed the scan's name), had no contact
 * details or work history, carried the private opening and tips, and the
 * button and the toast said to download it and apply with it.
 *
 * WHAT HOLDS NOW, on the whole homepage with its real uploader and report and
 * only the backend and the PDF library faked: the file is headed with the
 * scan's name, holds neither the opening nor the tips, is named as notes,
 * and nothing on the way to it says to send or apply with it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clickWhenEnabled } from "./helpers/click-when-enabled";
import shard from "@/i18n/shards/home-scan/en.json";

vi.setConfig(MOUNT_TEST_BUDGET);

const SCAN = {
  success: true,
  cached: false,
  industry: "healthcare",
  atsScoreEstimate: 62,
  formatGrade: "C",
  formatIssue: "Two-column layout",
  experienceLevel: "mid",
  candidateName: "Jane Doe",
  currentRole: "Nurse",
  topStrength: "Ward ownership",
  redFlags: [],
  keywords: [{ keyword: "triage", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }],
  quickWins: [{ fix: "Add ward numbers", timeEstimate: "10 min", impact: "high", scoreImpact: 6, category: "quantification" }],
  improvementPotential: 20,
  jobMatchScore: 61,
  jobMatchGrade: "C",
  matchingSkills: ["triage"],
  missingSkills: ["epic"],
};
const WRITTEN = {
  success: true,
  professionalSummary: "Charge nurse who runs triage for a thirty-bed ward.",
  keySkills: ["triage", "rota planning"],
  experienceHighlights: [{ original: "Ran triage.", tailored: "Ran triage for a thirty-bed ward for three years.", keywordsInjected: ["triage"] }],
  keywordsRequired: ["triage"],
  keywordGaps: [],
  suggestedJobTitle: "Charge Nurse",
  coverLetterOpening: "Dear Northside team, OPENING-FOR-THE-LETTER-ONLY",
  applicationTips: ["TIP-FOR-THE-APPLICANT-ONLY: mention the rota"],
  jobTitle: "Charge Nurse",
  jobCompany: "Northside Hospital",
};

const pdf = vi.hoisted(() => ({ text: [] as string[], saved: [] as string[] }));
vi.mock("jspdf", () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 210 } };
    setFontSize() {} setFont() {} setTextColor() {} setDrawColor() {} setLineWidth() {} line() {} addPage() {}
    splitTextToSize(t: string) { return [t]; }
    text(t: string | string[]) { pdf.text.push(...(Array.isArray(t) ? t : [t])); }
    save(name: string) { pdf.saved.push(name); }
  },
}));

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  for (const k of ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gte", "lte", "gt", "lt", "insert", "upsert", "update", "delete", "match", "filter"]) chain[k] = q;
  Object.assign(chain, {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: (fn: string, opts: unknown) => invoke(fn, opts) },
      auth: {
        getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }),
        getUser: async () => ({ data: { user: { id: "u1" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
// Signed in, so the report's tailoring card is the button and not the sign-in link.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "t", user: { id: "u1", email: "jane@example.com" } }, user: { id: "u1", email: "jane@example.com" }, loading: false }),
  safeNextPath: (s: string) => s,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

// No request leaves the test: the checked-in .env names production, and a
// résumé of 100 characters or more starts the page's background scan.
beforeAll(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 503, headers: { "content-type": "application/json" } })));
});
afterAll(() => { vi.unstubAllGlobals(); });

import "@/components/FreeKeywordResults";
import Index from "@/pages/Index";
import { saveResumeToSession } from "@/hooks/use-session-resume";

const RESUME = "Jane Doe\nCharge Nurse\nRan triage for a thirty-bed ward for three years at St Mary's.\n".repeat(4);
const POSTING = "Charge nurse wanted at Northside Hospital. Run triage for a forty-bed ward, lead a team of twelve, and own the rota.";

beforeEach(() => {
  sessionStorage.clear();
  pdf.text.length = 0;
  pdf.saved.length = 0;
  toast.mockReset();
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "free-keyword-scan") return { data: SCAN, error: null };
    if (fn === "generate-tailored-resume") return { data: WRITTEN, error: null };
    return { data: null, error: null };
  });
  saveResumeToSession(RESUME);
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

const jdBox = () => (screen.getAllByRole("textbox") as HTMLTextAreaElement[]).find((t) => /job description you're applying to/i.test(t.placeholder ?? ""));
const scanButton = () => screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]')) as HTMLElement;

async function openTheNotes() {
  render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
  await screen.findAllByRole("button", {}, SLOW);
  fireEvent.change(jdBox()!, { target: { value: POSTING } });
  await clickWhenEnabled(scanButton);
  await screen.findByTestId("report-next-steps", {}, SLOW);
  fireEvent.click(screen.getByRole("button", { name: /Generate Tailored Resume/i }));
  const dialog = await screen.findByRole("dialog", {}, SLOW);
  // The notes are on screen once the writer's suggested title is.
  await within(dialog).findByText(WRITTEN.suggestedJobTitle, { selector: "p" }, SLOW);
  return dialog;
}
async function download(dialog: HTMLElement) {
  const buttons = within(dialog).getAllByRole("button", { name: /download/i });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(pdf.saved.length, "no file was made").toBe(1), SLOW);
}

describe("the homepage's tailoring notes", () => {
  it("are headed with the scan's name, not a placeholder", async () => {
    await download(await openTheNotes());
    expect(pdf.text, "the file is not headed with the name the scan read").toContain("Jane Doe");
    expect(pdf.text.join("\n")).not.toMatch(/Your Name/);
  });

  it("hold neither the cover-letter opening nor the application tips", async () => {
    await download(await openTheNotes());
    const text = pdf.text.join("\n");
    expect(text).toContain(WRITTEN.professionalSummary);
    expect(text, "the private cover-letter opening went into the file").not.toMatch(/OPENING-FOR-THE-LETTER-ONLY|Cover Letter Opening/i);
    expect(text, "the private application tips went into the file").not.toMatch(/TIP-FOR-THE-APPLICANT-ONLY|Application Tips/i);
    expect(pdf.saved[0]).toMatch(/^Tailoring_Notes_/);
  });

  it("are never offered as a file to send or to apply with", async () => {
    const dialog = await openTheNotes();
    const said = toast.mock.calls.map(([a]) => `${(a as { title?: string }).title ?? ""} ${(a as { description?: string }).description ?? ""}`).join("\n");
    expect(said, "the toast told the reader to download the file and apply with it").not.toMatch(/download[^.!]*\b(apply|send)\b/i);
    const labels = within(dialog).getAllByRole("button", { name: /download/i }).map((b) => b.textContent?.trim() ?? "");
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label, "a button offers the file to send").not.toMatch(/\bsend\b/i);
    for (const label of labels) expect(label).toBe(shard.homeScan.tailoringNotes.download);
    expect(said).toContain(shard.homeScan.tailoringNotes.readyTitle);
    await download(dialog);
    const after = toast.mock.calls.map(([a]) => (a as { title?: string }).title ?? "");
    expect(after).toContain(shard.homeScan.tailoringNotes.downloadedTitle);
  });
});
