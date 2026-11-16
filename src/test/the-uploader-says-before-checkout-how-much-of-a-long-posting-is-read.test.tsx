/**
 * THE UPLOADER SAYS BEFORE CHECKOUT HOW MUCH OF A LONG POSTING IS READ
 * (S14X-048).
 *
 * The Full Analysis clips the job posting at 20,000 characters and the
 * LinkedIn text at 30,000 (supabase/functions/analyze-resume/paid-run.ts),
 * and the buyer learned it only from a notice inside the report they had
 * already paid for. The uploader now says so beside the Full Analysis link
 * before checkout, and the press still goes through. The page's figures are
 * a mirror of the server's, held equal here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";

const ROOT = resolve(__dirname, "../..");
afterEach(cleanup);

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions";
const posting = (chars: number) => "Own the batch pipelines and mentor the team. ".repeat(Math.ceil(chars / 45)).slice(0, chars);

function mount(jd: string) {
  const onCheckout = vi.fn();
  render(<MemoryRouter><ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={onCheckout} onFreeScan={vi.fn()} hasContent resumeText={RESUME} jobDescriptionText={jd} /></MemoryRouter>);
  return { onCheckout };
}
const fullAnalysisLink = () => screen.getAllByRole("button").find((b) => b.textContent?.includes(i18n.t("uploader.orGetCompleteAnalysis")))!;

describe("a posting longer than the paid run reads", () => {
  it("is named beside the Full Analysis link, and the press still checks out", () => {
    const { onCheckout } = mount(posting(25_000));
    const note = screen.getByTestId("paid-input-cap-notes");
    expect(note.textContent).toContain((20_000).toLocaleString("en"));
    fireEvent.click(fullAnalysisLink());
    expect(onCheckout).toHaveBeenCalledTimes(1);
  });

  it("a posting inside the cap gets no note", () => {
    mount(posting(19_000));
    expect(screen.queryByTestId("paid-input-cap-notes")).toBeNull();
  });
});

describe("the page's caps are the paid run's", () => {
  it("mirror MAX_JOB_DESCRIPTION_LENGTH and MAX_LINKEDIN_LENGTH", async () => {
    const server = readFileSync(resolve(ROOT, "supabase/functions/analyze-resume/paid-run.ts"), "utf8");
    const num = (name: string) => Number(new RegExp(`export const ${name} = ([\\d_]+);`).exec(server)?.[1].replace(/_/g, ""));
    const caps = await import("@/config/paid-input-caps");
    expect(caps.PAID_JOB_DESCRIPTION_CHARS).toBe(num("MAX_JOB_DESCRIPTION_LENGTH"));
    expect(caps.PAID_LINKEDIN_CHARS).toBe(num("MAX_LINKEDIN_LENGTH"));
  });
});
