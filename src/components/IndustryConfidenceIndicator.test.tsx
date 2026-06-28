import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IndustryConfidenceIndicator } from "./IndustryConfidenceIndicator";

// Regression test for a real bug fixed earlier: the free-keyword-scan edge
// function computed industryDetection internally but never included it in
// the response, so this component's industryDetection prop was always
// undefined in production — every correction ever logged recorded a
// hardcoded fallback confidence ('medium') and null signals instead of the
// real detection data, silently feeding the corrections-learning loop
// garbage. This test exercises the actual correction flow end-to-end and
// asserts the real confidence/signals get passed to the logging RPC, not
// the fallback defaults.
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

beforeEach(() => {
  rpcMock.mockClear();
});

describe("IndustryConfidenceIndicator", () => {
  it("logs the real confidence and signals when a user corrects the industry (not the hardcoded fallback)", () => {
    render(
      <IndustryConfidenceIndicator
        industry="sales"
        industryDetection={{
          detected: "sales",
          confidence: "low",
          signals: ["Job title match: \"account executive\"", "Co-occurrence patterns detected"],
          aiSuggested: "marketing",
        }}
        resumeTextLength={1234}
        visitorId="visitor-abc"
      />
    );

    // Expand the indicator, then open the correction picker.
    fireEvent.click(screen.getByText(/Industry:/i));
    fireEvent.click(screen.getByText(/Correct Industry/i));

    // Exact name match — "Marketing" also appears inside "Use AI suggestion:
    // Marketing" and possibly "Growth Marketing", so a substring match picks
    // an arbitrary one of those instead of the plain grid option.
    fireEvent.click(screen.getByRole("button", { name: "Marketing" }));

    expect(rpcMock).toHaveBeenCalledWith("log_industry_correction", {
      p_original_industry: "sales",
      p_corrected_industry: "marketing",
      p_original_confidence: "low",
      p_detection_source: "server",
      p_resume_text_length: 1234,
      p_server_signals: ["Job title match: \"account executive\"", "Co-occurrence patterns detected"],
      p_ai_suggested_industry: "marketing",
      p_visitor_id: "visitor-abc",
    });
  });

  it("falls back to 'medium' confidence and null signals only when industryDetection is genuinely absent", () => {
    render(<IndustryConfidenceIndicator industry="sales" resumeTextLength={500} />);

    fireEvent.click(screen.getByText(/Industry:/i));
    fireEvent.click(screen.getByText(/Change Industry/i));

    fireEvent.click(screen.getByRole("button", { name: "Marketing" }));

    expect(rpcMock).toHaveBeenCalledWith("log_industry_correction", expect.objectContaining({
      p_original_confidence: "medium",
      p_detection_source: "fallback",
      p_server_signals: null,
    }));
  });

  it("shows a one-click AI-suggestion shortcut when the AI disagreed with the server", () => {
    render(
      <IndustryConfidenceIndicator
        industry="sales"
        industryDetection={{ detected: "sales", confidence: "low", signals: [], aiSuggested: "marketing" }}
      />
    );

    fireEvent.click(screen.getByText(/Industry:/i));
    fireEvent.click(screen.getByText(/Correct Industry/i));
    expect(screen.getByText(/Use AI suggestion: Marketing/i)).toBeInTheDocument();
  });
});
