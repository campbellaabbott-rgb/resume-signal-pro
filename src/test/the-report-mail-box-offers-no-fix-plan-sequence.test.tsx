/**
 * THE REPORT MAIL BOX OFFERS NO FIX-PLAN SEQUENCE (S14X-012, the owner's
 * option B).
 *
 * The report's mail box offered a second box, "Break my fix plan into a short
 * email sequence", and after sending it said the report mail carried a button
 * that starts the sequence. Under option B the sequence is not offered from
 * the report: the box and its sentence are gone, and the report request no
 * longer carries a sequence choice, so send-scan-report has nothing to offer
 * a start button for. The pulse box, which only asks, is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

describe("the report's mail box under option B", () => {
  it("offers one box, the pulse, and no fix-plan sequence", () => {
    render(<EmailReportCapture payload={payload} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes, "a second box is still offered").toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /monthly market pulse/i })).toBeInTheDocument();
    expect(screen.queryByText(/short email sequence/i)).toBeNull();
  });

  it("sends the report with no sequence choice and says nothing about a sequence", async () => {
    render(<EmailReportCapture payload={payload} />);
    for (const b of screen.getAllByRole("checkbox")) fireEvent.click(b);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "seeker@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(invoke.mock.calls.map((c) => c[0])).toContain("send-market-pulse"));
    const report = invoke.mock.calls.find((c) => c[0] === "send-scan-report") as [string, { body: Record<string, unknown> }];
    expect(report[1].body).not.toHaveProperty("dripOptIn");
    expect(screen.queryByText(/start the fix-plan emails/i)).toBeNull();
  });
});
