/**
 * A SITE-WIDE CEILING ON THE ANSWERS DRAFTER IS NOT THE READER'S OWN LIMIT
 * (S14X-205), AND AN ALLOWANCE'S RETURN IS SAID IN THE READER'S LANGUAGE
 * (S14X-255).
 *
 * The answers panel worded every spend-gate 429 as "You've reached the
 * drafting limit", including the all-callers and per-network ceilings other
 * people fill; the writing tools already say "This is not your own limit".
 * The panel also never sent the held board pass, so a signed-in caller was
 * counted by account where the other writers count the pass. And the time a
 * daily allowance comes back was formatted in the browser's locale, not the
 * page's language.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/board-pass", () => ({ heldBoardPass: () => "v1.held-board-pass" }));

import { ApplicationAnswers, answersFailureMessage, forgetKeptDrafts } from "@/components/apply/ApplicationAnswers";
import { dateTime } from "@/lib/format";

const t = (_k: string, fallback: string, opts?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts?.[k] ?? ""));

afterEach(() => { cleanup(); invoke.mockReset(); forgetKeptDrafts(); });

describe("answersFailureMessage", () => {
  it("everyone's hourly ceiling is not the reader's own limit", () => {
    const m = answersFailureMessage(429, { code: "rate_limited_global" }, 3600, t);
    expect(m).toMatch(/not your own limit/);
    expect(m).toMatch(/busy for everyone/);
    expect(m).not.toMatch(/You've reached/);
  });

  it("the network's ceiling is not the reader's own limit", () => {
    const m = answersFailureMessage(429, { code: "rate_limited_network" }, 3600, t);
    expect(m).toMatch(/busy for your network/);
    expect(m).not.toMatch(/You've reached/);
  });

  it("positive control: the reader's own hour is still theirs", () => {
    expect(answersFailureMessage(429, { code: "rate_limited_function" }, 3600, t)).toMatch(/You've reached the drafting limit/);
  });

  it("a spent day names its return in the reader's language", () => {
    const resetsAt = "2026-11-16T00:00:00Z";
    const de = answersFailureMessage(429, { error: "daily_limit", resetsAt }, 3600, t, "de");
    expect(de).toContain(dateTime(resetsAt, { lng: "de" }));
    expect(dateTime(resetsAt, { lng: "de" })).not.toBe(dateTime(resetsAt, { lng: "en-US" }));
  });

  it("the provider's outage is not a limit", () => {
    const m = answersFailureMessage(503, { code: "ai_unavailable" }, 300, t);
    expect(m).toMatch(/can't take requests/);
    expect(m).not.toMatch(/limit/);
  });
});

describe("the panel, mounted", () => {
  it("sends the held board pass with the request", async () => {
    invoke.mockResolvedValue({ data: { answers: [{ question: "Q1", answer: "A1", supported: true, note: "" }], skipped: [], inferred: false }, error: null });
    render(<ApplicationAnswers resumeText="Sam Park — Software Engineer, Initech, 2019-2024." jobTitle="Engineer" jobCompany="Globex" jobDescription="We hire engineers." />);
    fireEvent.click(screen.getByRole("button", { name: /Draft this application's questions/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0][1].body.boardPass).toBe("v1.held-board-pass");
  });
});
