// Types for scripts/employer-statements.mjs (B06: what a posting's employer
// states, applied by the bake and again by the posting page on hydration).

export interface EmployerStated {
  employerValidThrough?: string;
  employmentType?: string;
  remote?: true;
  postedAt?: string;
  address?: { addressLocality: string; addressRegion?: string; postalCode?: string; addressCountry?: string };
}

export const EMPLOYER_STATED_META: string;

export const POSTING_CLOSED_META: string;

export function postingClosedOf(v: unknown): "employer" | null;

export function employerStatedOf(v: unknown): EmployerStated | null;

export function applyEmployerStatements<R extends object>(
  row: R,
  stated: unknown,
  opts?: { employmentTypeOf?: (stated: string) => string | undefined },
): R;
