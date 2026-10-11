/**
 * A HEADCOUNT IS PRINTED WITH ITS DATE, OR NOT AT ALL (owner decision D11,
 * 2026-10-11).
 *
 * company_profiles holds 978 employee counts (YC self-reported and "public
 * records") with no column saying when any of them was true, so a line like
 * "≈779,000 employees" carried no date basis. Migration 20261012102000 adds
 * company_profiles.as_of, left null; a reader that returns it hands it over
 * as employees_as_of (or employeesAsOf in the browser's employer context).
 *
 * Every surface that prints a company_profiles headcount asks this function
 * first. Until a row carries a plain calendar date, it answers null and the
 * surface prints nothing: no count, no band, no placeholder.
 */
export interface DatedHeadcount {
  n: number;
  /** YYYY-MM-DD, the day the count was true. */
  asOf: string;
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function datedHeadcount(
  row: { employees?: number | null; employees_as_of?: string | null; employeesAsOf?: string | null } | null | undefined,
): DatedHeadcount | null {
  if (!row) return null;
  const n = row.employees;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const asOf = row.employees_as_of ?? row.employeesAsOf ?? null;
  if (typeof asOf !== "string" || !PLAIN_DATE.test(asOf)) return null;
  return { n, asOf };
}
