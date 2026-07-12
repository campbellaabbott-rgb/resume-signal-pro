// Apply co-pilot: batch-prep panel. Verifies the gating and render states
// without a live session — pure given props, board/generate calls mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }), functions: { invoke: vi.fn() } },
}));
// ApplyAssistantResults pulls in export libs; stub it to a marker.
vi.mock("@/components/ApplyAssistantResults", () => ({
  ApplyAssistantResults: () => <div data-testid="kit-render" />,
}));
vi.mock("@/types/resume-builder", () => ({ normalizeBuilderResume: (x: unknown) => x }));

import { ApplyCopilotPanel, type CopilotApp } from "../components/account/ApplyCopilotPanel";

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const noop = () => {};
const resumeFor = () => "x".repeat(200);

const withPosting = (over: Partial<CopilotApp> = {}): CopilotApp => ({
  id: "1", company: "Acme", role: "Engineer", status: "saved", job_posting: "y".repeat(200), apply_url: "https://acme/apply", ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("ApplyCopilotPanel", () => {
  it("renders nothing when no application has a posting to prep", () => {
    const { container } = wrap(
      <ApplyCopilotPanel apps={[{ id: "1", company: "A", role: "R", status: "saved" }]} resumeFor={resumeFor} proActive onKit={noop} onStatus={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Pro sees a batch-prep button for pending applications", () => {
    wrap(<ApplyCopilotPanel apps={[withPosting()]} resumeFor={resumeFor} proActive onKit={noop} onStatus={noop} />);
    expect(screen.getByText(/Prep 1 tailored application/i)).toBeInTheDocument();
  });

  it("non-Pro sees the upgrade CTA, not the batch button", () => {
    wrap(<ApplyCopilotPanel apps={[withPosting()]} resumeFor={resumeFor} proActive={false} onKit={noop} onStatus={noop} />);
    expect(screen.getByText(/Go Pro to batch-prep/i)).toBeInTheDocument();
    expect(screen.queryByText(/Prep 1 tailored application/i)).not.toBeInTheDocument();
  });

  it("a prepped application shows an Apply link and is reviewable", () => {
    const kit = { tailoredResume: { name: "Jo" }, coverLetter: "Dear team", jobMetadata: { company: "Acme", roleTitle: "Engineer", applyMethodHint: "" }, skillGaps: [], checklist: [] };
    wrap(<ApplyCopilotPanel apps={[withPosting({ kit })]} resumeFor={resumeFor} proActive onKit={noop} onStatus={noop} />);
    expect(screen.getByText("Apply")).toBeInTheDocument();
    expect(screen.getByText(/1\/1 prepped/)).toBeInTheDocument();
  });

  it("surfaces a qualitative fit tier on prepped rows so users prioritize", () => {
    const kit = { tailoredResume: { name: "Jo" }, jobMetadata: { company: "Acme", roleTitle: "Engineer", applyMethodHint: "" }, skillGaps: [], checklist: [] };
    // 25% coverage is a strong same-field match on this compressed scale; the
    // row shows the word, never a bare "25%" that reads as poor to a layperson.
    wrap(<ApplyCopilotPanel apps={[withPosting({ kit, fit_pct: 25 })]} resumeFor={resumeFor} proActive onKit={noop} onStatus={noop} />);
    expect(screen.getByText("Strong match")).toBeInTheDocument();
    // No raw percentage leaks into the visible label.
    expect(screen.queryByText(/25%/)).not.toBeInTheDocument();
  });
});
