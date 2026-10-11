/**
 * THE CO-PILOT PROMISED A COVER LETTER FOR EACH SAVED JOB AND WROTE NONE
 * (S11-038; owner decision 2026-10-11: make the promise true).
 *
 * The Pro application co-pilot said, in all nine languages, that it tailors
 * a résumé and a cover letter to each saved posting. prepAll called only
 * generate-apply-package, whose answer has no letter, so every kit lacked it,
 * while the kit's own checklist told the member to attach one. Each job now
 * gets its letter from generate-cover-letter (the figure check, the contact
 * guard, and the model spend gate); a kit already made without one is given
 * its letter alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const h = vi.hoisted(() => ({ invoke: vi.fn(), saved: [] as Array<Record<string, unknown>> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ update: (row: Record<string, unknown>) => ({ eq: () => { h.saved.push(row); return Promise.resolve({ error: null }); } }) }),
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
  },
}));
vi.mock("@/components/ApplyAssistantResults", () => ({ ApplyAssistantResults: () => <div data-testid="kit-render" /> }));
vi.mock("@/types/resume-builder", () => ({ normalizeBuilderResume: (x: unknown) => x }));

import { ApplyCopilotPanel, type CopilotApp } from "../components/account/ApplyCopilotPanel";

vi.setConfig(MOUNT_TEST_BUDGET);

const KIT = { success: true, tailoredResume: { contact: {} }, jobMetadata: { company: "Acme", roleTitle: "Engineer", applyMethodHint: "" }, skillGaps: [], checklist: ["Attach the cover letter"] };
const app = (over: Partial<CopilotApp> = {}): CopilotApp => ({
  id: "app-1", company: "Acme", role: "Engineer", status: "saved", job_posting: "Acme is hiring an engineer to build payments. ".repeat(5), apply_url: "https://acme.example/apply", ...over,
});
const resumeFor = () => "Senior engineer who built payments platforms in TypeScript. ".repeat(5);

beforeEach(() => {
  h.invoke.mockReset();
  h.saved.length = 0;
  h.invoke.mockImplementation(async (fn: string) => {
    if (fn === "generate-apply-package") return { data: KIT, error: null };
    if (fn === "generate-cover-letter") return { data: { success: true, data: { coverLetter: "Dear Acme team, ..." } }, error: null };
    return { data: null, error: null };
  });
});
afterEach(() => cleanup());

const fns = () => h.invoke.mock.calls.map(([f]) => f);

describe("the co-pilot's batch prep", () => {
  it("writes each saved job a cover letter beside its tailored résumé, and keeps it with the kit", async () => {
    const onKit = vi.fn();
    render(<MemoryRouter><ApplyCopilotPanel apps={[app()]} resumeFor={resumeFor} proActive onKit={onKit} onStatus={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /prep 1 tailored application/i }));
    await waitFor(() => expect(onKit).toHaveBeenCalled(), SLOW);
    expect(fns(), "no cover letter was asked for").toEqual(["generate-apply-package", "generate-cover-letter"]);
    const letterBody = (h.invoke.mock.calls[1][1] as { body: Record<string, unknown> }).body;
    expect(letterBody).toMatchObject({ jobTitle: "Engineer", jobCompany: "Acme" });
    expect(String(letterBody.jobDescription)).toContain("Acme is hiring");
    expect(onKit.mock.calls[0][1], "the kit was kept without its letter").toMatchObject({ coverLetter: "Dear Acme team, ..." });
    expect(h.saved[0].kit).toMatchObject({ coverLetter: "Dear Acme team, ..." });
  });

  it("a kit made without a letter is given its letter alone, not made again", async () => {
    const onKit = vi.fn();
    render(<MemoryRouter><ApplyCopilotPanel apps={[app({ kit: { ...KIT } })]} resumeFor={resumeFor} proActive onKit={onKit} onStatus={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /prep 1 tailored application/i }));
    await waitFor(() => expect(onKit).toHaveBeenCalled(), SLOW);
    expect(fns()).toEqual(["generate-cover-letter"]);
    expect(onKit.mock.calls[0][1]).toMatchObject({ coverLetter: "Dear Acme team, ...", checklist: ["Attach the cover letter"] });
  });
});
