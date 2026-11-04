/**
 * A TAILORED RÉSUMÉ IS AIMED AT A REAL POSTING OR IS NOT OFFERED (S13-124).
 *
 * With no job and no posting text, the homepage's handler made both up: the
 * title "<industry> Position" and the description "A <industry> role requiring
 * strong skills and experience." The writer tailored to that sentence, and the
 * modal showed the result as "Tailored for: Healthcare Position" with a PDF to
 * send and a cover-letter opening addressed to a job that does not exist. It
 * also spent the account's daily use.
 *
 * WHAT HOLDS NOW, on the whole homepage with its real uploader and report and
 * only the backend faked: with no posting the card is not there, and with one
 * the writer receives that posting's own title and text. The report's "check
 * against a posting" card is how a person with no posting gets one in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clickWhenEnabled } from "./helpers/click-when-enabled";

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
  // The job-match block is what holds the card. The model's reply can carry a
  // score with no posting behind it, and a page whose posting was emptied after
  // the scan is in the same state.
  jobMatchScore: 61,
  jobMatchGrade: "C",
  matchingSkills: ["triage"],
  missingSkills: ["epic"],
};
const WRITTEN = {
  success: true,
  professionalSummary: "Ward nurse.",
  keySkills: ["triage"],
  experienceHighlights: [],
  keywordsRequired: [],
  keywordGaps: [],
  suggestedJobTitle: "Charge Nurse",
  coverLetterOpening: "Dear team,",
  applicationTips: [],
};

const invoke = vi.hoisted(() => vi.fn());
const parseSpreadsheet = vi.hoisted(() => vi.fn());
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
// Signed in, so the card (when it is there) is the button and not the sign-in link.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "t", user: { id: "u1", email: "jane@example.com" } }, user: { id: "u1", email: "jane@example.com" }, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, parseSpreadsheet } };
});

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import "@/components/FreeKeywordResults";
import Index from "@/pages/Index";
import { saveResumeToSession } from "@/hooks/use-session-resume";

const RESUME = "Jane Doe\nCharge Nurse\nRan triage for a thirty-bed ward for three years at St Mary's.\n".repeat(4);
const POSTING = "Charge nurse wanted at Northside Hospital. Run triage for a forty-bed ward, lead a team of twelve, and own the rota.";

beforeEach(() => {
  sessionStorage.clear();
  invoke.mockReset();
  parseSpreadsheet.mockReset();
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "free-keyword-scan") return { data: SCAN, error: null };
    if (fn === "generate-tailored-resume") return { data: WRITTEN, error: null };
    return { data: null, error: null };
  });
  saveResumeToSession(RESUME);
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

const mount = () => render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
const jdBox = () => (screen.getAllByRole("textbox") as HTMLTextAreaElement[]).find((t) => /job description you're applying to/i.test(t.placeholder ?? ""));
const scanButton = () => screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]')) as HTMLElement;
async function scan() {
  await screen.findAllByRole("button", {}, SLOW);
  await clickWhenEnabled(scanButton);
  await screen.findByTestId("report-next-steps", {}, SLOW);
}
const tailorButton = () => screen.queryByRole("button", { name: /Generate Tailored Resume/i });
const writerCalls = () => invoke.mock.calls.filter(([fn]) => fn === "generate-tailored-resume");
const writerBody = () => (writerCalls()[0][1] as { body: Record<string, unknown> }).body;

describe("the report's tailored-résumé card", () => {
  it("with no posting on the page, is not offered, and nothing is written", async () => {
    mount();
    await scan();
    expect(screen.getByText("Job Match Analysis"), "the job-match block that holds the card did not render").toBeTruthy();
    expect(tailorButton(), "a résumé was offered as tailored with no job to tailor it to").toBeNull();
    expect(screen.queryByText(/Ready to Apply/i)).toBeNull();
    expect(writerCalls()).toEqual([]);
  });

  it("with a pasted posting, sends that posting, and no title or text is made up", async () => {
    mount();
    await screen.findAllByRole("button", {}, SLOW);
    fireEvent.change(jdBox()!, { target: { value: POSTING } });
    await scan();
    fireEvent.click(tailorButton()!);
    await waitFor(() => expect(writerCalls().length).toBe(1));
    expect(writerBody().jobDescription).toBe(POSTING);
    expect(writerBody().jobTitle).toBe("Target Role");
    expect(JSON.stringify(writerBody())).not.toMatch(/Position|requiring strong skills/);
  });

  it("with a job picked from a sheet, sends that job's own title, company and text", async () => {
    parseSpreadsheet.mockResolvedValue({ data: { success: true, jobs: [{ id: "1", title: "Charge Nurse", company: "Northside Hospital", location: "Leeds", description: POSTING }] }, error: null });
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: /^Google Sheets$/ }));
    fireEvent.change(screen.getByPlaceholderText(/docs\.google\.com/i), { target: { value: "https://docs.google.com/spreadsheets/d/abc/edit" } });
    fireEvent.click(screen.getByRole("button", { name: /Import from Google Sheets/i }));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await scan();
    fireEvent.click(tailorButton()!);
    await waitFor(() => expect(writerCalls().length).toBe(1));
    expect(writerBody()).toMatchObject({ jobTitle: "Charge Nurse", jobCompany: "Northside Hospital", jobDescription: POSTING });
  });
});
