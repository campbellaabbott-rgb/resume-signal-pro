/**
 * THE POSTING AS THE LISTING VOCABULARY READS IT.
 *
 * One shape for the three surfaces that print a posting: the board's card and
 * pane (Jobs.tsx holds the row as its BoardJob), the company page (the same
 * row) and /jobs/posting/... (the detail action's PostingRow). Every field is
 * optional and nullable so BOTH of those row types are assignable to it as
 * they are: the card and the page never ask a caller to reshape a row, which
 * is where two surfaces start disagreeing about one posting.
 *
 * Until src/components/jobs/contracts.ts (design-system pass A) lands on this
 * branch, the prop types the components take are declared beside them as
 * extension types and listed in the wiring table; the names follow the
 * contract (JobCardProps, PostingDetailProps, PostingMenuActions).
 */
export interface ListingJob {
  id: string;
  title?: string | null;
  company?: string | null;
  token?: string | null;
  source?: string | null;
  location?: string | null;
  country?: string | null;
  remote?: boolean | null;
  /** remote | hybrid | onsite, as the employer states it; anything else is no statement. */
  workMode?: string | null;
  employmentType?: string | null;
  department?: string | null;
  category?: string | null;
  postedAt?: string | null;
  missingSince?: string | null;
  /** When we last read THIS BOARD's feed (job_board_verifications.verified_at). */
  recheckedAt?: string | null;
  applyUrl?: string | null;
  salary?: string | null;
  salaryMinAnnual?: number | null;
  salaryMaxAnnual?: number | null;
  salaryPeriod?: string | null;
  salaryCurrency?: string | null;
  agency?: boolean | null;
  experienceBand?: string | null;
  minYears?: number | null;
  locationCount?: number | null;
  postingCount?: number | null;
  otherLocations?: string[] | null;
  snippet?: string | null;
  closeMatch?: boolean | null;
  semanticMatch?: boolean | null;
  matchScope?: string | null;
}

/** The one open-roles figure a page chose (company-profiles plan; contracts.ts OpenRolesValue). */
export interface OpenRolesValue {
  value: number;
  /** True when the value is a floor ("10,000+"), never an exact count. */
  floor: boolean;
  asOf: string | null;
}

export type WorkModeKey = "remote" | "hybrid" | "onsite";
export const WORK_MODE_KEYS: readonly WorkModeKey[] = ["remote", "hybrid", "onsite"];

/**
 * TRINARY OR NOTHING. The employer's stated mode, or the legacy remote flag
 * standing for "remote" — and null for every other value, including the empty
 * one. An unstated mode is never "on-site".
 */
export function statedWorkMode(job: Pick<ListingJob, "workMode" | "remote">): WorkModeKey | null {
  const v = typeof job.workMode === "string" ? job.workMode.trim().toLowerCase() : "";
  if ((WORK_MODE_KEYS as readonly string[]).includes(v)) return v as WorkModeKey;
  return job.remote === true ? "remote" : null;
}

export const EMPLOYMENT_TYPE_KEYS = ["full_time", "part_time", "contract", "temporary", "internship"] as const;
export type EmploymentTypeKey = (typeof EMPLOYMENT_TYPE_KEYS)[number];
/** Employer-stated or nothing: only the five values the filter offers. */
export function statedEmploymentType(v: unknown): EmploymentTypeKey | null {
  return typeof v === "string" && (EMPLOYMENT_TYPE_KEYS as readonly string[]).includes(v) ? (v as EmploymentTypeKey) : null;
}
/** English fallbacks for the five main-locale keys jobsPage.employmentType.*. */
export const EMPLOYMENT_TYPE_FALLBACK: Record<EmploymentTypeKey, string> = {
  full_time: "Full-time", part_time: "Part-time", contract: "Contract", temporary: "Temp", internship: "Internship",
};
