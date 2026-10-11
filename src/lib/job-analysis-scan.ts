/**
 * A per-job rescan is a scan like any other (sweep S8-075).
 *
 * The report's "Get job-specific analysis" button scanned the résumé against
 * an uploaded job but never stored that job as the scan's job description:
 * the session and the stored résumé kept the previous one, so "Get full
 * analysis" on the job's report bought an analysis against a different job.
 * It also dropped the stated target country and context the primary scan
 * sends. Everything a purchase is made from is written before the scan.
 */
export interface JobAnalysisInputs {
  resumeText: string;
  linkedInText?: string;
  jobDescription: string;
  targetCountry?: string;
  userContext: { situation?: string; targetRole?: string; confirmedIndustry?: string; confirmedExperience?: string };
}

export interface JobAnalysisDeps {
  setJobDescriptionText: (jd: string) => void;
  persistScanInputs: (text: string, linkedIn?: string, jobDesc?: string) => void;
}

/** Records the job as the scan's job description and returns the scan request's fields. */
export function prepareJobAnalysisScan(inputs: JobAnalysisInputs, deps: JobAnalysisDeps) {
  deps.setJobDescriptionText(inputs.jobDescription);
  deps.persistScanInputs(inputs.resumeText, inputs.linkedInText || undefined, inputs.jobDescription);
  const ctx = inputs.userContext;
  return {
    resumeText: inputs.resumeText,
    jobDescriptionText: inputs.jobDescription,
    targetCountry: inputs.targetCountry || undefined,
    userContext: {
      situation: ctx.situation || undefined,
      targetRole: ctx.targetRole || undefined,
      confirmedIndustry: ctx.confirmedIndustry || undefined,
      confirmedExperience: ctx.confirmedExperience || undefined,
    },
  };
}
