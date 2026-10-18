/**
 * THE ACCOUNT PANELS SAY WHEN THE WRITING ALLOWANCE COMES BACK (owner
 * decision 2026-10-12; wave 4 round 2, account-compliance).
 *
 * The writing tools are now counted by account on the server: signed out,
 * none (401 sign_in_required); a free account one of each a day; Pro five
 * packages a day and sixty a month (429 daily_limit | monthly_limit, with
 * resetsAt). The account tracker's application kit read every refusal as
 * "Generation failed — try again." (supabase.functions.invoke hands a non-2xx
 * back as an error with the Response on `context` and data null), sending a
 * person to retry what cannot work until tomorrow; the co-pilot's batch said
 * "try the rest tomorrow" for a monthly limit too.
 *
 * Against the mounted panels with invoke faked:
 *   - the kit's 429 daily_limit says the allowance is used and when it comes
 *     back, and never "try again";
 *   - a monthly_limit says this month's allowance, not tomorrow;
 *   - a 401 sign_in_required says to sign in;
 *   - any other failure still reads as a failure (the old message);
 *   - the co-pilot stops its batch on the cover letter's monthly limit and
 *     says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
const toastError = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));
vi.mock("@/components/ApplyAssistantResults", () => ({ ApplyAssistantResults: () => <div data-testid="kit-render" /> }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => <div data-testid="preview" /> }));
vi.mock("@/types/resume-builder", () => ({ normalizeBuilderResume: (x: unknown) => x }));

import { ApplyKitPanel } from "@/components/account/ApplyKitPanel";
import { ApplyCopilotPanel } from "@/components/account/ApplyCopilotPanel";
import { writingRefusalOf } from "@/lib/writing-refusal";

const RESUME = "r".repeat(200);
const POSTING = "p".repeat(200);
const refused = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  }),
});

beforeEach(() => { invoke.mockReset(); toastError.mockReset(); });
afterEach(() => vi.useRealTimers());

async function runKit() {
  render(<MemoryRouter><ApplyKitPanel jobPosting={POSTING} resumeText={RESUME} proActive /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /Application kit/i }));
  fireEvent.click(await screen.findByRole("button", { name: /Generate kit/i }));
  await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  return String(toastError.mock.calls[0][0]);
}

describe("the application kit on the tracker", () => {
  it("a day's limit says the allowance is used and when it comes back, never try again", async () => {
    invoke.mockResolvedValueOnce(refused(429, { error: "daily_limit", code: "daily_limit", tool: "apply_package", tier: "pro", limit: 5, resetsAt: "2026-10-18T00:00:00Z", message: "x" }));
    const said = await runKit();
    expect(said).toMatch(/today's writing allowance/);
    expect(said).toMatch(/after /);
    expect(said).not.toMatch(/try again/i);
  });

  it("a month's limit says this month, not tomorrow", async () => {
    invoke.mockResolvedValueOnce(refused(429, { error: "monthly_limit", resetsAt: "2026-11-01T00:00:00Z" }));
    const said = await runKit();
    expect(said).toMatch(/this month's writing allowance/);
    expect(said).not.toMatch(/tomorrow/i);
  });

  it("an ended session is told to sign in", async () => {
    invoke.mockResolvedValueOnce(refused(401, { error: "sign_in_required" }));
    expect(await runKit()).toMatch(/^Sign in to use the writing tools/);
  });

  it("any other failure is still a failure to retry", async () => {
    invoke.mockResolvedValueOnce(refused(500, { error: "Unexpected error" }));
    expect(await runKit()).toMatch(/Generation failed/);
  });
});

describe("the co-pilot's batch", () => {
  it("stops on the cover letter's monthly limit and says this month", async () => {
    invoke
      .mockResolvedValueOnce({ data: { success: true, tailoredResume: { name: "Jo" } }, error: null })
      .mockResolvedValueOnce(refused(429, { error: "monthly_limit", resetsAt: "2026-11-01T00:00:00Z" }));
    const apps = [
      { id: "1", company: "Acme", role: "Engineer", status: "saved", job_posting: POSTING },
      { id: "2", company: "Beta", role: "Engineer", status: "saved", job_posting: POSTING },
    ];
    render(<MemoryRouter><ApplyCopilotPanel apps={apps} resumeFor={() => RESUME} proActive onKit={() => {}} onStatus={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Prep 2 tailored applications/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/this month's writing allowance/);
    // The batch stopped: the second job was never sent to a writer.
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 1100));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("the reader", () => {
  it("reads only the three refusals, each with its own status", async () => {
    expect(await writingRefusalOf(refused(429, { error: "daily_limit" }).error)).toEqual({ code: "daily_limit", resetsAt: null });
    expect(await writingRefusalOf(refused(401, { error: "daily_limit" }).error)).toBeNull();
    expect(await writingRefusalOf(refused(429, { error: "sign_in_required" }).error)).toBeNull();
    expect(await writingRefusalOf(refused(429, { error: "Too many requests" }).error)).toBeNull();
    expect(await writingRefusalOf(new Error("network"))).toBeNull();
    expect(await writingRefusalOf(null)).toBeNull();
  });
});
