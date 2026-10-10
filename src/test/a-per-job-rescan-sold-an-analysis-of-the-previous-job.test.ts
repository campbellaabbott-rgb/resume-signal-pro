/**
 * A PER-JOB RESCAN SOLD AN ANALYSIS OF THE PREVIOUS JOB (sweep S8-075).
 *
 * The report's "Get job-specific analysis" button (Index handleJobAnalysis)
 * scanned the résumé against an uploaded job but wrote nothing: the page's
 * job description, the session and the stored résumé kept the previous job,
 * so "Get full analysis" on that report (handleCheckout(resumeText, ...,
 * jobDescriptionText)) bought an analysis against a different posting. It
 * also dropped the stated target country and context. The handler now runs
 * prepareJobAnalysisScan first.
 */
import { describe, expect, it, vi } from "vitest";
import { prepareJobAnalysisScan } from "@/lib/job-analysis-scan";

describe("a per-job rescan", () => {
  it("records the job as the job description the checkout and the session read, before the scan", () => {
    const order: string[] = [];
    const setJobDescriptionText = vi.fn(() => order.push("state"));
    const persistScanInputs = vi.fn(() => order.push("session"));
    const req = prepareJobAnalysisScan(
      { resumeText: "RESUME", linkedInText: "", jobDescription: "Data Engineer at Acme: Airflow, dbt", targetCountry: "GB", userContext: { situation: "employed", targetRole: "" } },
      { setJobDescriptionText, persistScanInputs },
    );
    expect(setJobDescriptionText).toHaveBeenCalledWith("Data Engineer at Acme: Airflow, dbt");
    expect(persistScanInputs).toHaveBeenCalledWith("RESUME", undefined, "Data Engineer at Acme: Airflow, dbt");
    expect(order).toEqual(["state", "session"]);
    expect(req).toEqual({
      resumeText: "RESUME",
      jobDescriptionText: "Data Engineer at Acme: Airflow, dbt",
      targetCountry: "GB",
      userContext: { situation: "employed", targetRole: undefined, confirmedIndustry: undefined, confirmedExperience: undefined },
    });
  });
});
