/**
 * REOPENING PREPARE SHOWS THE ANSWERS ALREADY DRAFTED (S12-052, the answers
 * half).
 *
 * The board's Prepare dialog unmounts the answers panel on close and mounts
 * it with autoStart on every open, and the panel kept nothing but a per-mount
 * ref: every reopen called generate-application-answers again for the same
 * job, spending the daily writing allowance on answers the person already
 * had. The panel now keeps a draft per job, for the same résumé, posting and
 * language, while the page is open; "Draft again" asks for a new one. (The
 * letter and résumé half is reopening-prepare-opens-the-letter-and-resume-already-drafted.)
 *
 * Mounted for real; only the backend is faked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ApplicationAnswers, forgetKeptDrafts } from "@/components/apply/ApplicationAnswers";

const RESUME = "Sam Park — Software Engineer, Initech, 2019-2024: built billing services in Go and Postgres.";
const answer = (text: string) => ({ data: { answers: [{ question: "Why Globex?", answer: text, supported: true, note: "" }], skipped: [], inferred: true, undrafted: [] }, error: null });
const drafts = () => invoke.mock.calls.filter(([fn]) => fn === "generate-application-answers").length;
const open = (props: Partial<Parameters<typeof ApplicationAnswers>[0]> = {}) =>
  render(<ApplicationAnswers autoStart resumeText={RESUME} jobTitle="Engineer" jobCompany="Globex" jobDescription="We hire engineers." jobId="lever:globex:1" {...props} />);

afterEach(() => { cleanup(); invoke.mockReset(); forgetKeptDrafts(); });

describe("the Prepare dialog's answers", () => {
  it("closed and opened again: the same answers, and no second draft", async () => {
    invoke.mockResolvedValue(answer("Because of the billing work."));
    const first = open();
    expect(await screen.findByText("Because of the billing work.")).toBeTruthy();
    expect(drafts()).toBe(1);
    first.unmount();

    open();
    expect(screen.getByText("Because of the billing work.")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(drafts(), "reopening the dialog drafted the same job again").toBe(1);
  });

  it("Draft again asks for a new draft, and that one is kept", async () => {
    invoke.mockResolvedValueOnce(answer("First draft.")).mockResolvedValueOnce(answer("Second draft."));
    const first = open();
    expect(await screen.findByText("First draft.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Draft again/ }));
    expect(await screen.findByText("Second draft.")).toBeTruthy();
    expect(drafts()).toBe(2);
    first.unmount();
    open();
    expect(screen.getByText("Second draft.")).toBeTruthy();
    expect(drafts()).toBe(2);
  });

  it("another job, or another résumé, is drafted for itself", async () => {
    invoke.mockResolvedValue(answer("Kept for job one."));
    const first = open();
    await screen.findByText("Kept for job one.");
    first.unmount();

    invoke.mockResolvedValue(answer("For job two."));
    const second = open({ jobId: "lever:globex:2" });
    expect(await screen.findByText("For job two.")).toBeTruthy();
    second.unmount();

    invoke.mockResolvedValue(answer("For the new résumé."));
    open({ resumeText: `${RESUME} Led a team of four.` });
    expect(await screen.findByText("For the new résumé.")).toBeTruthy();
    await waitFor(() => expect(drafts()).toBe(3));
  });
});
