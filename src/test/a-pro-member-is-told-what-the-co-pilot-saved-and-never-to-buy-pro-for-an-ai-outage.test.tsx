/**
 * A PRO MEMBER IS TOLD WHAT THE CO-PILOT SAVED, AND NEVER TO BUY PRO FOR AN
 * AI OUTAGE (S13-084).
 *
 * 1. A kit generate-apply-package made and the panel saved, whose letter
 *    generate-cover-letter could not write (a 422 figure or contact guard, a
 *    5xx), was not counted (`full !== kit`), so with nothing else counted the
 *    member read "Nothing new to prep — the saved postings couldn't be
 *    tailored" while those kits appeared under prepped.
 * 2. generate-apply-package answers 402 when the AI gateway is out of credits
 *    ({ retryable: false }) as well as when there is no plan
 *    ({ requiresPurchase: true }). Every 402 read "Batch prep needs Pro".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const h = vi.hoisted(() => ({ invoke: vi.fn(), toasts: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
  },
}));
vi.mock("sonner", () => {
  const toast = (m: string) => { h.toasts.push(String(m)); };
  toast.success = (m: string) => { h.toasts.push(String(m)); };
  toast.error = (m: string) => { h.toasts.push(String(m)); };
  return { toast };
});
vi.mock("@/components/ApplyAssistantResults", () => ({ ApplyAssistantResults: () => <div data-testid="kit-render" /> }));
vi.mock("@/types/resume-builder", () => ({ normalizeBuilderResume: (x: unknown) => x }));

import { ApplyCopilotPanel, type CopilotApp } from "../components/account/ApplyCopilotPanel";

vi.setConfig(MOUNT_TEST_BUDGET);

const KIT = { success: true, tailoredResume: { contact: {} }, jobMetadata: { company: "Acme", roleTitle: "Engineer", applyMethodHint: "" }, skillGaps: [], checklist: [] };
const app = (id: string): CopilotApp => ({
  id, company: `Acme ${id}`, role: "Engineer", status: "saved", job_posting: "Acme is hiring an engineer to build payments. ".repeat(5), apply_url: "https://acme.example/apply",
});
const resumeFor = () => "Senior engineer who built payments platforms in TypeScript. ".repeat(5);
const httpError = (status: number, body: unknown) => ({ context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) });

beforeEach(() => { h.invoke.mockReset(); h.toasts.length = 0; });
afterEach(() => cleanup());

const prep = async (apps: CopilotApp[], onKit = vi.fn()) => {
  render(<MemoryRouter><ApplyCopilotPanel apps={apps} resumeFor={resumeFor} proActive onKit={onKit} onStatus={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /prep \d+ tailored application/i }));
  return onKit;
};

describe("kits saved without their letters are counted as saved", () => {
  it("says the résumés were saved and the letters are still owed, never 'nothing new to prep'", async () => {
    h.invoke.mockImplementation(async (fn: string) => {
      if (fn === "generate-apply-package") return { data: KIT, error: null };
      return { data: null, error: httpError(422, { error: "figure_check" }) };
    });
    const onKit = await prep([app("1")]);
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0), SLOW);
    expect(onKit).toHaveBeenCalledTimes(1);
    expect(h.toasts.join(" | ")).not.toMatch(/Nothing new to prep/);
    expect(h.toasts.join(" | ")).toMatch(/Tailored résumés saved: 1\. Their cover letters couldn't be written/);
  });
});

describe("a 402 says Pro only when the server asked for a purchase", () => {
  it("the gateway's credits running out is an outage, not an upsell", async () => {
    h.invoke.mockImplementation(async () => ({ data: null, error: httpError(402, { error: "AI service credits depleted. Please try again later.", retryable: false }) }));
    await prep([app("1"), app("2")]);
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0), SLOW);
    expect(h.toasts.join(" | ")).not.toMatch(/needs Pro/);
    expect(h.toasts[0]).toMatch(/AI service can't take requests right now/);
    // The batch stopped once, and the stop is not followed by "nothing new".
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.toasts.join(" | ")).not.toMatch(/Nothing new to prep/);
  });

  it("a real purchase refusal still says Pro", async () => {
    h.invoke.mockImplementation(async () => ({ data: null, error: httpError(402, { error: "This is a paid tool.", requiresPurchase: true }) }));
    await prep([app("1")]);
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0), SLOW);
    expect(h.toasts[0]).toMatch(/Batch prep needs Pro/);
  });
});
