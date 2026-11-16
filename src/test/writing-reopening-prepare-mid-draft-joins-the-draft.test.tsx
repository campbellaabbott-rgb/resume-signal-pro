/**
 * REOPENING PREPARE WHILE ITS ANSWERS ARE STILL DRAFTING JOINS THAT DRAFT
 * (RC-S12-052).
 *
 * A finished draft was kept for a reopen, but one still being written was
 * not: closing the board's Prepare dialog mid-draft and opening it again
 * mounted a fresh panel that asked for the same job's answers a second time,
 * spending the person's allowance twice. A reopen now waits for the running
 * draft and shows its answers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ApplicationAnswers, forgetKeptDrafts } from "@/components/apply/ApplicationAnswers";

afterEach(() => { cleanup(); invoke.mockReset(); forgetKeptDrafts(); });

const RESUME = "Sam Park — Software Engineer, Initech, 2019-2024: built billing services in Go and Postgres.";
const PANEL = { resumeText: RESUME, jobTitle: "Engineer", jobCompany: "Globex", jobDescription: "We hire engineers.", jobId: "lever:globex:1" };

describe("Prepare closed and reopened while the draft runs", () => {
  it("asks once, and the reopened panel shows the answers when they arrive", async () => {
    let resolve!: (v: unknown) => void;
    invoke.mockReturnValue(new Promise((r) => { resolve = r; }));
    const first = render(<ApplicationAnswers {...PANEL} autoStart />);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<ApplicationAnswers {...PANEL} autoStart />);
    expect(await screen.findByTestId("answers-joined-draft")).toBeTruthy();
    await act(async () => {
      resolve({ data: { answers: [{ question: "Why us?", answer: "I built billing services.", supported: true, note: "" }], skipped: [], inferred: true }, error: null });
    });
    expect(await screen.findByText("I built billing services.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("positive control: a different job asks for its own draft", async () => {
    invoke.mockReturnValue(new Promise(() => undefined));
    const first = render(<ApplicationAnswers {...PANEL} autoStart />);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    first.unmount();
    render(<ApplicationAnswers {...PANEL} jobId="lever:globex:2" autoStart />);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("answers-joined-draft")).toBeNull();
  });
});
