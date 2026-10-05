/**
 * THE LINKEDIN ANALYSIS IN THE SHAPE THE PAGE READS, WHATEVER THE MODEL SENT.
 *
 * The success response used to spread the model's JSON as it came. The
 * fallback models are not schema-bound, so `headline` could be null or an
 * array could be missing, and LinkedInInsights reads analysis.headline.issues
 * .length, profileCompleteness.score and three array lengths unguarded: one
 * omitted field took the whole report render down (register L5-17).
 *
 * Every field is coerced to its documented type: numbers clamped to 0-100,
 * strings cut to a sane length, arrays defaulted to [] and capped, objects to
 * their full shape. Plain TypeScript, no imports, so Node runs it directly.
 */

export type LinkedInAnalysis = {
  linkedinScore: number;
  linkedinGrade: "A" | "B" | "C" | "D" | "F";
  headline: { current: string; score: number; issues: string[]; suggestion: string };
  about: { wordCount: number; score: number; issues: string[]; suggestion: string };
  consistencyIssues: Array<{ type: string; description: string; severity: "high" | "medium" | "low" }>;
  missingFromLinkedIn: string[];
  linkedinTips: string[];
  profileCompleteness: { score: number; missing: string[] };
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown, max = 600): string => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");
const score = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(100, n))) : 0;
};
const strings = (v: unknown, cap = 8, max = 400): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter((s) => s.trim() !== "").slice(0, cap) : [];

const GRADES = ["A", "B", "C", "D", "F"] as const;
const gradeFor = (n: number): LinkedInAnalysis["linkedinGrade"] => (n >= 90 ? "A" : n >= 80 ? "B" : n >= 70 ? "C" : n >= 60 ? "D" : "F");

export function coerceLinkedInAnalysis(raw: unknown): LinkedInAnalysis {
  const a = obj(raw);
  const linkedinScore = score(a.linkedinScore);
  const grade = typeof a.linkedinGrade === "string" ? a.linkedinGrade.trim().toUpperCase().charAt(0) : "";
  const h = obj(a.headline);
  const ab = obj(a.about);
  const pc = obj(a.profileCompleteness);
  const severities = ["high", "medium", "low"] as const;
  return {
    linkedinScore,
    linkedinGrade: (GRADES as readonly string[]).includes(grade) ? grade as LinkedInAnalysis["linkedinGrade"] : gradeFor(linkedinScore),
    headline: {
      current: str(h.current, 300) || "Not found",
      score: score(h.score),
      issues: strings(h.issues),
      suggestion: str(h.suggestion, 300),
    },
    about: {
      wordCount: Math.max(0, Math.round(Number(ab.wordCount) || 0)),
      score: score(ab.score),
      issues: strings(ab.issues),
      suggestion: str(ab.suggestion, 1200),
    },
    consistencyIssues: (Array.isArray(a.consistencyIssues) ? a.consistencyIssues : [])
      .map((x) => {
        const c = obj(x);
        const sev = typeof c.severity === "string" ? c.severity.toLowerCase() : "";
        return {
          type: str(c.type, 40) || "other",
          description: str(c.description, 500),
          severity: (severities as readonly string[]).includes(sev) ? sev as "high" | "medium" | "low" : "medium" as const,
        };
      })
      .filter((c) => c.description.trim() !== "")
      .slice(0, 10),
    missingFromLinkedIn: strings(a.missingFromLinkedIn, 4),
    linkedinTips: strings(a.linkedinTips, 6),
    profileCompleteness: { score: score(pc.score), missing: strings(pc.missing, 10, 120) },
  };
}
