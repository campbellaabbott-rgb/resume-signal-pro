/**
 * A PAST BUYER KEEPS WHAT THE SUCCESS PAGE PROMISED.
 *
 *  - RC-S12-042. The Coach's and the Career Path's saved copy (the one mailed
 *    at payment) was never shown: the page mounted the widget on the tab's
 *    résumé, which made a new one, or offered the form. The widget is now
 *    handed the saved copy.
 *  - RC-S12-043. The cover letter could be copied but not downloaded, as the
 *    product page promises: a plain-text file now.
 *  - RC-S12-110. "Open in builder" overwrote the scanned résumé every other
 *    tool reads (rb_resume_text) with the rewrite. It hands the builder a
 *    one-shot seed instead and leaves the scan as it was.
 *  - S14X-180. The recovery upload was a div with onClick around a hidden
 *    input: no label, out of reach of Tab and of a screen reader.
 *  - S14X-111. An order closed with no saved copy was told it was still
 *    being made, or made again from the tab. The buyer is told it closed and
 *    given the form.
 *
 * Mounted for real, with only the backend and the two widgets faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import pastBuyers from "../i18n/shards/past-buyers/en.json";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackButtonClick: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({ ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()), useFunnelTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
vi.mock("@/components/InterviewCoach", () => ({
  InterviewCoach: ({ savedCopy }: { savedCopy?: unknown }) => <div data-testid="widget">{JSON.stringify(savedCopy ?? null)}</div>,
}));
vi.mock("@/components/CareerPathSimulator", () => ({
  CareerPathSimulator: ({ savedCopy }: { savedCopy?: unknown }) => <div data-testid="widget">{JSON.stringify(savedCopy ?? null)}</div>,
}));

import ProductSuccess from "../pages/ProductSuccess";

vi.setConfig(MOUNT_TEST_BUDGET);

const TAB_RESUME = "A résumé held by this tab, long enough to build a report from. ".repeat(4);
const generatorCalls = () => invoke.mock.calls.filter(([f]) => String(f).startsWith("generate-"));
const answerVerify = (data: Record<string, unknown>) =>
  invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
    ? { data: { verified: true, isFirstUse: false, customerEmail: "b@example.com", ...data }, error: null }
    : { data: { success: true, text: "parsed résumé text ".repeat(10) }, error: null });
const mount = (product: string, sid = `cs_test_pastbuyer_${product}`) =>
  render(<MemoryRouter initialEntries={[`/product-success?session_id=${sid}&product=${product}`]}><ProductSuccess /></MemoryRouter>);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  invoke.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the Coach's and the Career Path's saved copy (RC-S12-042)", () => {
  it.each([
    ["interviewCoach", { questions: [{ question: "Tell me about the churn dashboard." }] }],
    ["careerPathSimulator", { paths: [{ id: "p1", title: "Analytics lead" }] }],
  ])("%s: the copy saved at payment is handed to the widget, and nothing is made again", async (product, copy) => {
    sessionStorage.setItem("rb_resume_text", TAB_RESUME);
    answerVerify({ generatedContent: copy });
    mount(product);
    const widget = await screen.findByTestId("widget", {}, SLOW);
    expect(JSON.parse(widget.textContent || "null"), "the saved copy never reached the widget").toEqual(copy);
    expect(generatorCalls()).toEqual([]);
  });

  it("the saved copy is shown even when this tab holds no résumé", async () => {
    answerVerify({ generatedContent: { questions: [{ question: "Why this team?" }] } });
    mount("interviewCoach", "cs_test_pastbuyer_coach_notab");
    expect(JSON.parse((await screen.findByTestId("widget", {}, SLOW)).textContent || "null")).toEqual({ questions: [{ question: "Why this team?" }] });
  });
});

describe("the cover letter (RC-S12-043)", () => {
  it("downloads as a plain-text file named cover-letter.txt holding the letter", async () => {
    const letter = "Dear Hiring Manager,\n\nI rebuilt the churn dashboard.\n\nPriya";
    answerVerify({ generatedContent: { coverLetter: letter, openingLine: "", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "", alternateOpenings: [] } });
    const blobs: Blob[] = [];
    const clicked: Array<{ download: string; href: string }> = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (b: Blob) => { blobs.push(b); return "blob:letter"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.getAttribute("href") ?? "" });
    });
    mount("coverLetter");
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(pastBuyers.pastBuyers.downloadLetter) }, SLOW));
    expect(clicked).toEqual([{ download: "cover-letter.txt", href: "blob:letter" }]);
    expect(blobs[0].type).toBe("text/plain;charset=utf-8");
    expect(await blobs[0].text()).toBe(letter);
  });
});

describe("Open in builder (RC-S12-110)", () => {
  it("hands the builder the rewrite as a one-shot seed and leaves the scanned résumé as it was", async () => {
    sessionStorage.setItem("rb_resume_text", TAB_RESUME);
    const rewrite = "PRIYA RAMAN\nData Analyst, Northwind Traders";
    answerVerify({
      generatedContent: {
        resume: { rewrittenResume: rewrite, professionalSummary: "", keyChanges: [], addedKeywords: [], atsScore: { before: 0, after: 0, improvement: "" }, highlights: [] },
        coverLetter: { coverLetter: "Dear team", openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" },
        originalResume: "", jobDetails: { title: "Analyst", company: "" },
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined); // jsdom cannot navigate
    mount("premiumPackage");
    fireEvent.click(await screen.findByRole("button", { name: /Open in builder/ }, SLOW));
    expect(sessionStorage.getItem("rb_builder_seed")).toBe(rewrite);
    expect(sessionStorage.getItem("rb_resume_text"), "the scanned résumé was overwritten").toBe(TAB_RESUME);
  });
});

describe("the recovery upload (S14X-180)", () => {
  it("is a labelled file input a keyboard reaches, and a file chosen there is read", async () => {
    answerVerify({ generatedContent: null, inProgress: false, hasResumeData: false });
    mount("careerSnapshot");
    const input = await screen.findByLabelText(new RegExp(en.productSuccess.recovery.yourResume), { selector: "input" }, SLOW) as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.className).not.toMatch(/\bhidden\b/);
    expect(input.tabIndex).toBeGreaterThanOrEqual(0);
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(invoke.mock.calls.map(([f]) => f)).toContain("parse-pdf"), SLOW);
  });
});

describe("an order closed with no saved copy (S14X-111)", () => {
  it("is told it closed and given the form, never that it is still being made, and nothing is made from the tab", async () => {
    sessionStorage.setItem("rb_resume_text", TAB_RESUME);
    answerVerify({ generatedContent: null, inProgress: false, hasResumeData: false, closedNoCopy: true });
    mount("careerSnapshot");
    expect((await screen.findByTestId("closed-no-copy", {}, SLOW)).textContent).toBe(pastBuyers.pastBuyers.closedNoCopy);
    expect(screen.getByLabelText(new RegExp(en.productSuccess.recovery.yourResume), { selector: "input" })).toBeInTheDocument();
    expect(screen.queryByTestId("still-being-made")).toBeNull();
    expect(generatorCalls(), "a closed order was made again from the tab").toEqual([]);
  });

  it("an older verifier that says nothing of it is answered as before", async () => {
    answerVerify({ generatedContent: null, inProgress: true, hasResumeData: false });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount("careerSnapshot", "cs_test_pastbuyer_older");
      await waitFor(() => expect(invoke.mock.calls.filter(([f]) => f === "verify-product-purchase").length).toBeGreaterThan(0), SLOW);
      expect(screen.queryByTestId("closed-no-copy")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
