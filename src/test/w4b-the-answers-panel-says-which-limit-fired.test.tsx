/**
 * THE ANSWERS PANEL SAYS WHICH LIMIT FIRED (S12-051), SENDS THE READER'S
 * LANGUAGE (S12-026), AND NAMES THE QUESTIONS IT DID NOT DRAFT (S12-148).
 *
 * Every 429 read "Busy — try again shortly", so an hour-long allowance
 * (Retry-After: 3600) told the person to retry in a moment, and the panel
 * was English only. The server's code and Retry-After now pick the sentence;
 * the writing tools' account refusals (sign_in_required, daily_limit with
 * resetsAt) are worded too; every string has a key.
 *
 * Mounted for real, with only the backend and the toast observed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard: vi.fn(async () => ({ data: null, error: null })) }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import { ApplicationAnswers, answersFailureMessage } from "@/components/apply/ApplicationAnswers";

const t = (_k: string, fallback: string, opts?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts?.[k] ?? ""));

afterEach(() => { cleanup(); invoke.mockReset(); toastError.mockReset(); });

describe("answersFailureMessage", () => {
  it("an hour-long allowance says about an hour, not 'in a moment'", () => {
    const m = answersFailureMessage(429, { code: "rate_limited_function" }, 3600, t);
    expect(m).toMatch(/about 60 minutes/);
    expect(m).not.toMatch(/shortly|moment/i);
  });

  it("a day-long allowance says hours", () => {
    expect(answersFailureMessage(429, { code: "rate_limited_session" }, 86400, t)).toMatch(/about 24 hours/);
  });

  it("a busy model is a minute", () => {
    expect(answersFailureMessage(429, { code: "model_busy" }, 60, t)).toMatch(/in a minute/);
  });

  it("the account refusals use the server's own sentence, or a worded fallback", () => {
    expect(answersFailureMessage(401, { error: "sign_in_required", message: "Sign in to use the writing tools." }, null, t)).toBe("Sign in to use the writing tools.");
    expect(answersFailureMessage(401, { error: "sign_in_required" }, null, t)).toMatch(/Sign in/);
    expect(answersFailureMessage(429, { error: "daily_limit", resetsAt: "2026-10-13T00:00:00Z" }, 3600, t)).toMatch(/after/);
  });

  it("an unavailable limiter is a minute, anything else a plain failure", () => {
    expect(answersFailureMessage(503, { code: "limiter_unavailable" }, 60, t)).toMatch(/unavailable/);
    expect(answersFailureMessage(500, null, null, t)).toMatch(/Couldn't draft/);
  });
});

const RESUME = "Sam Park — Software Engineer, Initech, 2019-2024: built billing services in Go and Postgres.";

describe("the panel, mounted", () => {
  it("a 429 with Retry-After 3600 is worded as an hour", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "non-2xx", context: new Response(JSON.stringify({ code: "rate_limited_function" }), { status: 429, headers: { "retry-after": "3600" } }) },
    });
    render(<ApplicationAnswers resumeText={RESUME} jobTitle="Engineer" jobCompany="Globex" jobDescription="We hire engineers." />);
    fireEvent.click(screen.getByRole("button", { name: /Draft this application's questions/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/about 60 minutes/);
  });

  it("sends the reader's language, and lists the questions it did not draft", async () => {
    invoke.mockResolvedValue({ data: { answers: [{ question: "Q1", answer: "A1", supported: true, note: "" }], skipped: [], inferred: false, undrafted: ["Q21", "Q22"] }, error: null });
    render(<ApplicationAnswers resumeText={RESUME} jobTitle="Engineer" jobCompany="Globex" jobDescription="We hire engineers." />);
    fireEvent.click(screen.getByRole("button", { name: /Draft this application's questions/ }));
    const list = await screen.findByTestId("answers-undrafted");
    expect(list.textContent).toContain("Q21");
    expect(list.textContent).toContain("Q22");
    expect(typeof invoke.mock.calls[0][1].body.language).toBe("string");
  });
});
