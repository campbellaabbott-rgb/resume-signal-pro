/**
 * AN ANSWER THE SERVER DID NOT KEEP IS NOT THANKED (register S13-057, the
 * page half).
 *
 * ScanOutcomeAsk awaited record_scan_outcome without reading data or error
 * (supabase-js resolves, it does not throw, so its catch was dead), then
 * always wrote rb_outcome_<id> and showed "Recorded — thank you". A refusal
 * (the function answers false once client_write_allowed refuses) or a failed
 * call was shown as saved and locked in this browser. ScanFeedback read only
 * the error, so a vote the budget skipped was thanked too.
 *
 * Now each says what happened: thanks and the lock only for a stored answer
 * (data true), "not saved" for false or an error, and the buttons stay usable.
 * ScanFeedback's legacy case (the void function before 20261101150000
 * applies answers no data) keeps its old reading, stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import en from "@/i18n/locales/en.json";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/track-transport", () => ({ getVisitorId: () => "visitor-test-1" }));

import { ScanOutcomeAsk } from "@/components/ScanOutcomeAsk";
import { ScanFeedback } from "@/components/ScanFeedback";

const REPORT = "RB7Q2K9X";

beforeEach(() => { localStorage.clear(); rpc.mockReset(); });
afterEach(() => cleanup());

const interviewButton = () => screen.getByRole("button", { name: en.scanOutcome.interview });
const clickInterview = () => fireEvent.click(interviewButton());

describe("the outcome question", () => {
  it("records, thanks and remembers a stored answer", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    render(<ScanOutcomeAsk reportId={REPORT} />);
    clickInterview();
    expect(await screen.findByText(en.scanOutcome.recorded)).toBeTruthy();
    expect(localStorage.getItem(`rb_outcome_${REPORT}`)).toBe("interview");
    expect(rpc).toHaveBeenCalledWith("record_scan_outcome", { p_report_id: REPORT, p_outcome: "interview", p_ip: "visitor-test-1" });
  });

  for (const [why, answer] of [
    ["the budget refused it", { data: false, error: null }],
    ["the call failed", { data: null, error: { message: "FetchError", code: "" } }],
    ["the server answered nothing", { data: null, error: null }],
  ] as const) {
    it(`says it was not saved, and locks nothing, when ${why}`, async () => {
      rpc.mockResolvedValue(answer);
      render(<ScanOutcomeAsk reportId={REPORT} />);
      clickInterview();
      expect(await screen.findByText(en.scanOutcome.notSaved)).toBeTruthy();
      expect(screen.queryByText(en.scanOutcome.recorded)).toBeNull();
      expect(localStorage.getItem(`rb_outcome_${REPORT}`)).toBeNull();
      const btn = interviewButton();
      expect(btn.getAttribute("aria-pressed")).toBe("false");
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  }

  it("says it was not saved when the call throws", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    render(<ScanOutcomeAsk reportId={REPORT} />);
    clickInterview();
    expect(await screen.findByText(en.scanOutcome.notSaved)).toBeTruthy();
    expect(localStorage.getItem(`rb_outcome_${REPORT}`)).toBeNull();
  });
});

describe("the helpful-or-not vote", () => {
  const mount = () => render(<ScanFeedback industry="technology" atsScore={64} hadJobDescription={false} />);

  it("thanks a stored vote", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    mount();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.scanFeedback.yes) }));
    expect(await screen.findByText(en.scanFeedback.thanks)).toBeTruthy();
  });

  it("does not thank a vote the budget skipped", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    mount();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.scanFeedback.yes) }));
    expect(await screen.findByText(en.scanFeedback.notSaved)).toBeTruthy();
    expect(screen.queryByText(en.scanFeedback.thanks)).toBeNull();
  });

  it("does not thank a vote that failed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "PGRST202" } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.scanFeedback.no) }));
    await waitFor(() => expect(screen.getByText(en.scanFeedback.notSaved)).toBeTruthy());
    expect(screen.queryByText(en.scanFeedback.thanks)).toBeNull();
  });

  it("reads the void function's empty answer as stored, as before, until the migration applies", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    mount();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.scanFeedback.yes) }));
    expect(await screen.findByText(en.scanFeedback.thanks)).toBeTruthy();
  });
});
