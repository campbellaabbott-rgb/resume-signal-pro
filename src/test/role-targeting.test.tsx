// The grade→game-plan cards: role targeting from real detection output, and
// the paste-a-posting rescan flow.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RoleTargetingCard, CheckAgainstPostingCard } from "../components/RoleTargeting";

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("RoleTargetingCard", () => {
  it("lists real roles for the detected industry with market-aware search links", () => {
    wrap(<RoleTargetingCard industry="sales" countryName="Germany" />);
    expect(screen.getByText(/Roles this resume screens for/i)).toBeInTheDocument();
    const linkedin = screen.getAllByText("LinkedIn")[0].closest("a")!;
    expect(linkedin.getAttribute("href")).toContain("linkedin.com/jobs/search");
    expect(linkedin.getAttribute("href")).toContain("location=Germany");
  });

  it("shows reach roles from the secondary blend with the honest pct", () => {
    wrap(
      <RoleTargetingCard
        industry="sales"
        industryBlend={{ primary: "sales", secondary: "marketing", primaryPct: 70, secondaryPct: 30 }}
      />,
    );
    expect(screen.getByText(/30% marketing side/i)).toBeInTheDocument();
    expect(screen.getByText(/keyword coverage, not experience/i)).toBeInTheDocument();
  });

  it("renders nothing for an industry with no role pages", () => {
    const { container } = wrap(<RoleTargetingCard industry="nonexistent_industry" />);
    expect(container.querySelector("h3")).toBeNull();
  });
});

describe("CheckAgainstPostingCard", () => {
  it("submits the pasted posting to the rescan callback", () => {
    const onScan = vi.fn();
    wrap(<CheckAgainstPostingCard onScanWithPosting={onScan} />);
    const jd = "Senior Account Executive at Acme. Requirements: 5+ years enterprise SaaS sales, Salesforce, pipeline management, quota attainment, and territory planning experience.";
    fireEvent.change(screen.getByPlaceholderText(/paste the full job posting/i), { target: { value: jd } });
    fireEvent.click(screen.getByText(/Rescan against this posting/i));
    expect(onScan).toHaveBeenCalledWith(jd);
  });

  it("refuses to submit a too-short posting", () => {
    const onScan = vi.fn();
    wrap(<CheckAgainstPostingCard onScanWithPosting={onScan} />);
    fireEvent.change(screen.getByPlaceholderText(/paste the full job posting/i), { target: { value: "sales job" } });
    fireEvent.click(screen.getByText(/Rescan against this posting/i));
    expect(onScan).not.toHaveBeenCalled();
    expect(screen.getByText(/full posting for a real comparison/i)).toBeInTheDocument();
  });
});
