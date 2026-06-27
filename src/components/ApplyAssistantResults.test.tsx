import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApplyAssistantResults, ApplyPackageData } from "./ApplyAssistantResults";
import { createEmptyResume } from "@/types/resume-builder";

const baseData: ApplyPackageData = {
  jobMetadata: {
    company: "Acme Corp",
    roleTitle: "Senior Engineer",
    applyMethodHint: "Apply via the careers portal at acme.com/careers",
  },
  tailoredResume: { ...createEmptyResume(), contact: { ...createEmptyResume().contact, fullName: "Jane Doe" } },
  skillGaps: ["Kubernetes"],
  checklist: ["Review the tailored resume", "Submit it yourself on the employer's site"],
};

describe("ApplyAssistantResults", () => {
  it("renders the no-auto-submit promise prominently", () => {
    render(<ApplyAssistantResults data={baseData} />);
    expect(screen.getByText(/prep work, not auto-submission/i)).toBeInTheDocument();
  });

  it("renders job metadata", () => {
    render(<ApplyAssistantResults data={baseData} />);
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Senior Engineer")).toBeInTheDocument();
    expect(screen.getByText(/apply via the careers portal/i)).toBeInTheDocument();
  });

  it("renders the checklist in order", () => {
    render(<ApplyAssistantResults data={baseData} />);
    expect(screen.getByText("Review the tailored resume")).toBeInTheDocument();
    expect(screen.getByText("Submit it yourself on the employer's site")).toBeInTheDocument();
  });

  it("renders skill gaps with an explicit no-fabrication note", () => {
    render(<ApplyAssistantResults data={baseData} />);
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText(/won't fabricate experience/i)).toBeInTheDocument();
  });

  it("omits the skill gaps section when there are none", () => {
    render(<ApplyAssistantResults data={{ ...baseData, skillGaps: [] }} />);
    expect(screen.queryByText(/honest gaps/i)).not.toBeInTheDocument();
  });

  it("renders the cover letter when provided", () => {
    render(<ApplyAssistantResults data={baseData} coverLetter="Dear Hiring Manager," />);
    expect(screen.getByText("Dear Hiring Manager,")).toBeInTheDocument();
  });

  it("omits the cover letter section when not provided", () => {
    render(<ApplyAssistantResults data={baseData} />);
    expect(screen.queryByText("Cover Letter")).not.toBeInTheDocument();
  });
});
