/**
 * A PULSE BOX IS UNTICKED, AND TICKING IT ONLY ASKS.
 *
 * Defect sweep 2026-10-02, 1.59: "Also send me a monthly market pulse" was
 * useState(true), and the compact capture at the top of the report -- which
 * renders no box at all -- sent that true with every address. send-scan-report
 * then wrote the address straight onto the pulse list. Pre-ticked consent is
 * not consent, and a box the user never saw is not even that.
 *
 * Now: unticked in both variants; the report request never carries the pulse
 * choice; a ticked box asks send-market-pulse to mail a confirmation link, and
 * the page says that one more click is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { EmailReportCapture } from "../components/EmailReportCapture";

const payload = {
  score: 74, projectedScore: 86, scoreBreakdown: null, peerPercentile: null,
  applicationPassRate: null, redFlags: [], fixRoadmap: null, industry: "technology",
};

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string) => ({ data: { success: true, ...(fn === "send-market-pulse" ? { pending: true } : {}) }, error: null }));
});

const send = (email = "me@example.com") => {
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
};

describe("the market pulse is opt-in, and opting in sends a confirmation, not a subscription", () => {
  it("the box starts unticked", () => {
    render(<EmailReportCapture payload={payload} />);
    const pulse = screen.getByRole("checkbox", { name: /monthly market pulse/i }) as HTMLInputElement;
    expect(pulse.checked).toBe(false);
  });

  it("the compact capture (no box) asks for the report only, never the pulse", async () => {
    render(<EmailReportCapture payload={payload} variant="compact" />);
    send();
    await waitFor(() => expect(screen.getByText(/Sent!/)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledTimes(1);
    const [fn, opts] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fn).toBe("send-scan-report");
    expect(opts.body).not.toHaveProperty("subscribePulse");
  });

  it("an untouched full capture never calls the pulse either", async () => {
    render(<EmailReportCapture payload={payload} />);
    send();
    await waitFor(() => expect(screen.getByText(/Sent!/)).toBeInTheDocument());
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["send-scan-report"]);
    expect(screen.queryByText(/confirmation link/i)).toBeNull();
  });

  it("ticking the box asks send-market-pulse for a confirmation, and the page says a click is still needed", async () => {
    render(<EmailReportCapture payload={payload} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /monthly market pulse/i }));
    send("Me@Example.com ");
    await waitFor(() => expect(screen.getByText(/emailed it a confirmation link/i)).toBeInTheDocument());
    const report = invoke.mock.calls.find((c) => c[0] === "send-scan-report") as [string, { body: Record<string, unknown> }];
    expect(report[1].body, "the report request must not carry the pulse choice").not.toHaveProperty("subscribePulse");
    const pulse = invoke.mock.calls.find((c) => c[0] === "send-market-pulse") as [string, { body: Record<string, unknown> }];
    expect(pulse[1].body).toEqual({ action: "subscribe", email: "Me@Example.com", industry: "technology", score: 74 });
  });

  it("a field the pulse does not cover is said so, and no confirmation is claimed", async () => {
    invoke.mockImplementation(async (fn: string) =>
      fn === "send-market-pulse"
        ? { data: null, error: { message: "422", context: new Response(JSON.stringify({ success: false, error: "not this field" }), { status: 422 }) } }
        : { data: { success: true }, error: null });
    render(<EmailReportCapture payload={payload} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /monthly market pulse/i }));
    send();
    await waitFor(() => expect(screen.getByText(/doesn't cover your field yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/emailed it a confirmation link/i)).toBeNull();
  });

  it("a refused report prints the server's reason (an inbox's daily allowance), not a generic failure", async () => {
    invoke.mockImplementation(async () => ({
      data: null,
      error: { message: "non-2xx", context: new Response(JSON.stringify({ success: false, error: "That address has already been sent several reports today." }), { status: 429 }) },
    }));
    render(<EmailReportCapture payload={payload} />);
    send();
    await waitFor(() => expect(screen.getByText(/already been sent several reports today/)).toBeInTheDocument());
  });

  it("a failed pulse request leaves the report a success and claims nothing", async () => {
    invoke.mockImplementation(async (fn: string) =>
      fn === "send-market-pulse" ? { data: null, error: new Error("429") } : { data: { success: true }, error: null });
    render(<EmailReportCapture payload={payload} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /monthly market pulse/i }));
    send();
    await waitFor(() => expect(screen.getByText(/Sent!/)).toBeInTheDocument());
    expect(screen.queryByText(/emailed it a confirmation link/i)).toBeNull();
  });
});
