/**
 * THE JOB URL TAB READS THE POSTING (sweep S11-032, owner decision
 * 2026-10-11), the page half. The fence is a-job-link-is-read-through-a-fence;
 * the servers' half is a-link-is-not-a-job-description.
 *
 * WHAT WAS WRONG. The tab took a link, said "Job URL added", and sent
 * "[Job URL: <link>]" as the job description to the free scan and to the $5
 * analysis. Nothing ever read the posting.
 *
 * WHAT HOLDS NOW, on the uploader rendered with only the network faked:
 *   - "Get job description" asks fetch-job-posting, and the posting's text
 *     lands in the box, where the person can read it; the scan sends that
 *     text, never the link;
 *   - pressing the scan with a link still waiting reads it first, then scans;
 *   - a site the fetcher does not read says so and asks for the text, and the
 *     scan does not run against nothing;
 *   - a bare link pasted into the text box is read, not sent;
 *   - the $5 analysis never buys against a link: the press reads it and stops,
 *     and the next press buys with the text on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions";
const LEVER = "https://jobs.lever.co/acme/f7f8c3c8-bb78-47a9-a4c3-a0f0f6f42f9a";
const POSTING_TEXT = "We are hiring a senior financial analyst to own forecasting, vendor management and the monthly close. Five years of FP&A, strong SQL and Excel, and a habit of explaining numbers plainly.";

function answer(body: Record<string, unknown>) {
  invoke.mockImplementation(async (fn: string) => (fn === "fetch-job-posting" ? { data: body, error: null } : { data: null, error: null }));
}
function mount() {
  const onFreeScan = vi.fn();
  const onCheckout = vi.fn();
  render(
    <MemoryRouter>
      <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={onCheckout} onFreeScan={onFreeScan} isLoading={false} hasContent resumeText={RESUME} />
    </MemoryRouter>,
  );
  return { onFreeScan, onCheckout };
}
const jdBox = () => (screen.getAllByRole("textbox") as HTMLTextAreaElement[]).find((t) => /job description you're applying to/i.test(t.placeholder ?? ""));
const scanButton = () => screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]'))!;
// A tab since S12-140 (the mode switch is a tab list with its selection announced).
const urlTab = () => screen.getByRole("tab", { name: /^Job URL$/ });
const urlInput = () => screen.getByRole("textbox", { name: /^Job URL$/ });
const fetchCalls = () => invoke.mock.calls.filter((c) => c[0] === "fetch-job-posting");

beforeEach(() => { invoke.mockReset(); });
afterEach(cleanup);

describe("a posting link", () => {
  it("is read into the box, and the scan sends the posting's text, never the link", async () => {
    answer({ ok: true, vendor: "lever", source: "vendor_api", url: LEVER, title: "Senior Financial Analyst", company: "Acme", text: POSTING_TEXT });
    const { onFreeScan } = mount();
    fireEvent.click(urlTab());
    fireEvent.change(urlInput(), { target: { value: LEVER } });
    fireEvent.click(screen.getByRole("button", { name: /Get job description/ }));
    await waitFor(() => expect(jdBox()?.value ?? "").toContain(POSTING_TEXT));
    expect(fetchCalls()[0][1]).toMatchObject({ body: { url: LEVER } });
    expect(jdBox()!.value).toMatch(/^Job Title: Senior Financial Analyst\nCompany: Acme\nSource: https:\/\/jobs\.lever\.co\//);
    fireEvent.click(scanButton());
    expect(onFreeScan).toHaveBeenCalledTimes(1);
    const sent = String(onFreeScan.mock.calls[0][1]);
    expect(sent).toContain(POSTING_TEXT);
    expect(sent).not.toMatch(/\[Job URL:/);
  });

  it("pressing the scan with a link still waiting reads it first, then scans with the text", async () => {
    answer({ ok: true, vendor: "lever", source: "vendor_api", url: LEVER, title: "Senior Financial Analyst", company: "Acme", text: POSTING_TEXT });
    const { onFreeScan } = mount();
    fireEvent.click(urlTab());
    fireEvent.change(urlInput(), { target: { value: LEVER } });
    fireEvent.click(scanButton());
    await waitFor(() => expect(onFreeScan).toHaveBeenCalledTimes(1));
    expect(fetchCalls().length).toBe(1);
    expect(String(onFreeScan.mock.calls[0][1])).toContain(POSTING_TEXT);
    expect(String(onFreeScan.mock.calls[0][1])).not.toMatch(/\[Job URL:/);
  });

  it("a site the fetcher does not read asks for the text, and nothing is scanned against the link", async () => {
    answer({ ok: false, reason: "unsupported_host" });
    const { onFreeScan } = mount();
    fireEvent.click(urlTab());
    fireEvent.change(urlInput(), { target: { value: "https://www.linkedin.com/jobs/view/3912345678" } });
    fireEvent.click(scanButton());
    await waitFor(() => expect(screen.getByText(/We can't read job pages from this site/)).toBeTruthy());
    expect(onFreeScan, "the scan ran against a link it could not read").not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Paste the text/ }));
    expect(jdBox(), "the paste box did not come back").toBeTruthy();
  });

  it("a bare link pasted into the text box is read, not sent", async () => {
    answer({ ok: true, vendor: "lever", source: "vendor_api", url: LEVER, title: "Senior Financial Analyst", company: "Acme", text: POSTING_TEXT });
    const { onFreeScan } = mount();
    fireEvent.change(jdBox()!, { target: { value: LEVER } });
    expect(screen.getByText(/That's a link, not a job description/)).toBeTruthy();
    fireEvent.click(scanButton());
    await waitFor(() => expect(onFreeScan).toHaveBeenCalledTimes(1));
    expect(String(onFreeScan.mock.calls[0][1])).toContain(POSTING_TEXT);
  });

  it("the $5 analysis reads a waiting link and stops; the next press buys with the text on screen", async () => {
    answer({ ok: true, vendor: "lever", source: "vendor_api", url: LEVER, title: "Senior Financial Analyst", company: "Acme", text: POSTING_TEXT });
    const { onCheckout } = mount();
    fireEvent.click(urlTab());
    fireEvent.change(urlInput(), { target: { value: LEVER } });
    const buy = () => screen.getByRole("button", { name: /complete analysis/i });
    fireEvent.click(buy());
    await waitFor(() => expect(jdBox()?.value ?? "").toContain(POSTING_TEXT));
    expect(onCheckout, "a purchase started against a link").not.toHaveBeenCalled();
    fireEvent.click(buy());
    expect(onCheckout).toHaveBeenCalledTimes(1);
    expect(String(onCheckout.mock.calls[0][1])).toContain(POSTING_TEXT);
    expect(String(onCheckout.mock.calls[0][1])).not.toMatch(/\[Job URL:/);
  });
});
