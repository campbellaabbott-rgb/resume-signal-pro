/**
 * A CLIPPED POSTING LINK SAYS SO IN THE BOX (S14X-270).
 *
 * A job link is read by fetch-job-posting, which keeps a long posting's
 * first part and says so with truncated: true. The uploader filled the box
 * with the clipped text and said nothing, so the reader scanned (or bought
 * against) part of a posting believing it was all of it. The box now carries
 * a note while it holds the clipped text; an edit removes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions";
const LINK = "https://careers.example.org/jobs/123";
const TEXT = "Own the batch pipelines, mentor four engineers and run the on-call rota. ".repeat(20);

beforeEach(() => { invoke.mockReset(); });
afterEach(cleanup);

async function readLink(truncated: boolean) {
  invoke.mockImplementation(async (fn: string) => (fn === "fetch-job-posting"
    ? { data: { ok: true, text: TEXT, title: "Data Engineer", company: null, truncated }, error: null }
    : { data: null, error: null }));
  render(<MemoryRouter><ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} hasContent resumeText={RESUME} /></MemoryRouter>);
  const toggle = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-expanded"))!;
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("tab", { name: /^Job URL$/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /^Job URL$/ }), { target: { value: LINK } });
  fireEvent.click(screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]'))!);
  await screen.findByDisplayValue(/Job Description:/);
}

describe("a posting read from a link", () => {
  it("says it was clipped while the box holds the clipped text", async () => {
    await readLink(true);
    expect((await screen.findByTestId("job-url-truncated")).textContent).toBe(i18n.t("freeScanPage.jobUrl.truncated"));
  });

  it("an edit to the box removes the note", async () => {
    await readLink(true);
    const box = (await screen.findByDisplayValue(/Job Description:/)) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: `${box.value}\nPlus the rest I pasted.` } });
    expect(screen.queryByTestId("job-url-truncated")).toBeNull();
  });

  it("a whole posting gets no note", async () => {
    await readLink(false);
    expect(screen.queryByTestId("job-url-truncated")).toBeNull();
  });
});
