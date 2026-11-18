/**
 * THE ANSWERS PANEL SAYS WHICH QUESTIONS TO DRAFT AGAIN (S14X-119), AND DOES
 * NOT KEEP A DRAFT THAT STILL HAS THEM.
 *
 * A chunk whose model call failed came back as undrafted, which the panel
 * words as left for the person, and the draft was kept, so a reopen showed
 * the same gap and never asked again. Now the server names them retryable,
 * the panel shows them under their own heading with "Draft again", and a
 * reopen asks for a new draft.
 *
 * Mounted for real, with only the backend and the toast observed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ApplicationAnswers, forgetKeptDrafts } from "@/components/apply/ApplicationAnswers";

afterEach(() => { cleanup(); invoke.mockReset(); forgetKeptDrafts(); });

const RESUME = "Sam Park — Software Engineer, Initech, 2019-2024: built billing services in Go and Postgres.";
const PANEL = { resumeText: RESUME, jobTitle: "Engineer", jobCompany: "Globex", jobDescription: "We hire engineers." };

describe("a draft with a chunk that failed", () => {
  it("shows those questions as ones to draft again, never as left for the person, and a reopen asks again", async () => {
    invoke.mockResolvedValue({ data: { answers: [{ question: "Q1", answer: "A1", supported: true, note: "" }], skipped: [], inferred: false, retryable: ["Q9", "Q10"] }, error: null });
    const first = render(<ApplicationAnswers {...PANEL} autoStart />);
    const box = await screen.findByTestId("answers-retryable");
    expect(box.textContent).toContain("Q9");
    expect(box.textContent).toContain("Q10");
    expect(screen.queryByTestId("answers-undrafted")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);

    first.unmount();
    render(<ApplicationAnswers {...PANEL} autoStart />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("a draft where every chunk failed but one still offers Draft again beside the questions", async () => {
    invoke.mockResolvedValue({ data: { answers: [], skipped: [], inferred: false, retryable: ["Q1", "Q2"] }, error: null });
    render(<ApplicationAnswers {...PANEL} />);
    fireEvent.click(screen.getByRole("button", { name: /Draft this application's questions/ }));
    const box = await screen.findByTestId("answers-retryable");
    expect(box.textContent).toContain("Q1");
    fireEvent.click(screen.getByRole("button", { name: /Draft again/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });
});

describe("positive control: a complete draft is kept", () => {
  it("a reopen shows it without asking again", async () => {
    invoke.mockResolvedValue({ data: { answers: [{ question: "Q1", answer: "A1", supported: true, note: "" }], skipped: [], inferred: false }, error: null });
    const first = render(<ApplicationAnswers {...PANEL} autoStart />);
    await screen.findByText("A1");
    first.unmount();
    render(<ApplicationAnswers {...PANEL} autoStart />);
    await screen.findByText("A1");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
