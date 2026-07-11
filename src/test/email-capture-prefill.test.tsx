// Consent-preserving one-click capture: the address found ON the resume may
// only PRE-FILL the visible input with a disclosure line — never auto-send.
// These tests are the contract that keeps the prefill on the right side of
// the site's own promises ("never your resume. No spam.") and GDPR.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmailReportCapture } from "../components/EmailReportCapture";

const payload = {
  score: 74,
  projectedScore: 86,
  scoreBreakdown: null,
  peerPercentile: null,
  applicationPassRate: null,
  redFlags: [],
  fixRoadmap: null,
  industry: "technology",
};

beforeEach(() => localStorage.clear());

describe("EmailReportCapture prefill", () => {
  it("pre-fills the input with the resume's address and shows the disclosure", () => {
    render(<EmailReportCapture payload={payload} suggestedEmail="jane.doe@example.com" />);
    expect(screen.getByPlaceholderText("you@example.com")).toHaveValue("jane.doe@example.com");
    expect(screen.getByText(/We spotted this address on your resume/i)).toBeInTheDocument();
  });

  it("hides the disclosure once the user edits the address", () => {
    render(<EmailReportCapture payload={payload} suggestedEmail="jane.doe@example.com" />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "other@example.com" },
    });
    expect(screen.queryByText(/We spotted this address/i)).toBeNull();
  });

  it("renders empty with no disclosure when nothing was detected", () => {
    render(<EmailReportCapture payload={payload} />);
    expect(screen.getByPlaceholderText("you@example.com")).toHaveValue("");
    expect(screen.queryByText(/We spotted this address/i)).toBeNull();
  });

  it("still hides entirely for known visitors (prefill must not resurrect the nag)", () => {
    localStorage.setItem("rb_last_email", "jane.doe@example.com");
    const { container } = render(
      <EmailReportCapture payload={payload} variant="compact" hideIfKnown suggestedEmail="jane.doe@example.com" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("consent copy names the day-14 outcome question (four emails, opt-in)", () => {
    render(<EmailReportCapture payload={payload} />);
    expect(screen.getByText(/one question on day 14/i)).toBeInTheDocument();
    expect(screen.getByText(/Four short emails, cancel anytime/i)).toBeInTheDocument();
    // The drip stays off by default — prefill must not flip consent defaults.
    const checkboxes = screen.getAllByRole("checkbox");
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
  });
});
