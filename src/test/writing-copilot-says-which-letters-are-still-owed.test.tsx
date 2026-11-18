/**
 * THE CO-PILOT SAYS WHICH COVER LETTERS ARE STILL OWED (S14X-267), AND AN AI
 * OUTAGE ANSWERED 503 STOPS THE BATCH AS AN OUTAGE (S14X-109).
 *
 * 1. A saved job whose kit an earlier run made, and whose letter failed
 *    again this run, was counted nowhere, so the member read "Nothing new to
 *    prep: the saved postings couldn't be tailored" about a job that was
 *    tailored. It is now counted, and the toast says the letters are still
 *    owed.
 * 2. The writers now answer the AI gateway running out of credits as 503
 *    ai_unavailable (a 402 is kept for a purchase the caller lacks). The
 *    co-pilot reads that 503, from the kit or the letter writer, as the
 *    outage it is: it says so and stops the batch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import WRITING from "@/i18n/shards/writing-tools/en.json";

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
const app = (id: string, kit?: unknown): CopilotApp => ({
  id, company: `Acme ${id}`, role: "Engineer", status: "saved", job_posting: "Acme is hiring an engineer to build payments. ".repeat(5), apply_url: "https://acme.example/apply", kit,
});
const resumeFor = () => "Senior engineer who built payments platforms in TypeScript. ".repeat(5);
const httpError = (status: number, body: unknown) => ({ context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) });
const OUTAGE = { error: "The AI service can't take requests right now. Try again in a few minutes.", code: "ai_unavailable", retryable: true };
const owed = (count: number) => WRITING.writingTools.lettersStillOwed.replace("{{count}}", String(count));

beforeEach(() => { h.invoke.mockReset(); h.toasts.length = 0; });
afterEach(() => cleanup());

const prep = async (apps: CopilotApp[]) => {
  render(<MemoryRouter><ApplyCopilotPanel apps={apps} resumeFor={resumeFor} proActive onKit={vi.fn()} onStatus={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /prep \d+ tailored application/i }));
};

describe("a kit from an earlier run whose letter fails again", () => {
  it("is said as a letter still owed, never 'nothing new to prep'", async () => {
    h.invoke.mockImplementation(async (fn: string) => (fn === "generate-cover-letter"
      ? { data: null, error: httpError(500, { error: "boom" }) }
      : { data: KIT, error: null }));
    await prep([app("1", KIT)]);
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0), SLOW);
    expect(h.invoke.mock.calls.map(([fn]) => fn)).toEqual(["generate-cover-letter"]);
    expect(h.toasts).toEqual([owed(1)]);
  });
});

describe("an AI outage answered 503", () => {
  it("from the kit writer: the outage is said and the batch stops", async () => {
    h.invoke.mockImplementation(async () => ({ data: null, error: httpError(503, OUTAGE) }));
    await prep([app("1"), app("2")]);
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0), SLOW);
    expect(h.toasts[0]).toMatch(/AI service can't take requests right now/);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.toasts.join(" | ")).not.toMatch(/Nothing new to prep|needs Pro/);
  });

  it("from the letter writer: the outage is said and no further job is asked for", async () => {
    h.invoke.mockImplementation(async (fn: string) => (fn === "generate-cover-letter"
      ? { data: null, error: httpError(503, OUTAGE) }
      : { data: KIT, error: null }));
    await prep([app("1"), app("2")]);
    await waitFor(() => expect(h.toasts.some((m) => /can't take requests/.test(m))).toBe(true), SLOW);
    expect(h.invoke.mock.calls.map(([fn]) => fn)).toEqual(["generate-apply-package", "generate-cover-letter"]);
  });

  it("positive control: a plan that could not be read (503 limiter_unavailable) is busy, not an outage", async () => {
    h.invoke.mockImplementation(async () => ({ data: null, error: httpError(503, { error: "limiter_unavailable", code: "limiter_unavailable" }) }));
    await prep([app("1"), app("2")]);
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0), SLOW);
    expect(h.toasts[0]).not.toMatch(/can't take requests/);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
});
