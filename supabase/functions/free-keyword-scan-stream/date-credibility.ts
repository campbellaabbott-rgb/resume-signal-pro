/**
 * DATE CHECKS ON THE FALLBACK REPORT'S "CREDIBILITY FLAGS" CARD (register S13-022).
 *
 * The fallback scanner read "05/2019 - 08/2022" as "2019 - 08" (the month
 * after the slash taken for a two-digit year, 08 for 2008) and put
 * "end date before start date" at the top of the report as a HIGH-priority
 * credibility flag. "2023 - 2027 (expected)" was "contains future year",
 * also high, and a degree held alongside a teaching job, or a business run
 * since 2012 beside a lecturing role, was "significant overlap between roles".
 *
 * The ranges are now read by employment-gaps.ts, the same reader the primary
 * scanner's gap check uses (the file is a byte-identical copy). What is left
 * to flag:
 *   - a range that truly ends before it starts, at month precision
 *     ("Mar 2022 – Jan 2019"): a typo worth fixing;
 *   - a start more than a year in the future ("Jan 2052"): a typo too; a
 *     future END is a degree or a contract still under way, not a problem;
 *   - two finished roles, neither of them study, overlapping by three years
 *     or more. A current role ("– Present") is left out: running a business
 *     alongside other work is ordinary.
 * When the dates do not say, nothing is flagged.
 */
import { type DatePoint, monthIndex, readDateRanges } from "./employment-gaps.ts";

export interface CredibilityIssue {
  type: 'date_inconsistency' | 'timeline_overlap' | 'impossible_timeline' | 'gap';
  severity: 'high' | 'medium' | 'low';
  description: string;
  location?: string;
}

export function detectCredibilityIssues(resumeText: string, now: Date = new Date()): CredibilityIssue[] {
  const issues: CredibilityIssue[] = [];
  const today = monthIndex({ year: now.getFullYear(), month: now.getMonth() });
  const ranges = readDateRanges(resumeText, { now });

  for (const r of ranges) {
    if (r.reversed) {
      issues.push({ type: 'impossible_timeline', severity: 'high', description: `Date range "${r.text}" shows end date before start date`, location: r.text });
    } else if (monthIndex(r.start) > today + 12) {
      issues.push({ type: 'date_inconsistency', severity: 'medium', description: `Date range "${r.text}" starts more than a year from now`, location: r.text });
    }
  }

  const finishedRoles = ranges
    .filter(r => !r.reversed && !r.education && r.end !== 'present' && monthIndex(r.start) <= today)
    .sort((a, b) => monthIndex(a.start) - monthIndex(b.start));
  for (let i = 0; i < finishedRoles.length; i++) {
    for (let j = i + 1; j < finishedRoles.length; j++) {
      const a = finishedRoles[i], b = finishedRoles[j];
      const overlapMonths = Math.min(monthIndex(a.end as DatePoint), monthIndex(b.end as DatePoint)) - monthIndex(b.start);
      if (overlapMonths < 36) continue;
      issues.push({
        type: 'timeline_overlap',
        severity: 'medium',
        description: `Significant overlap (${Math.floor(overlapMonths / 12)}+ years) between roles may need clarification`,
        location: `${a.text} and ${b.text}`,
      });
    }
  }
  return issues;
}
