// Data model for the flagship Complete Resume Rewrite product.
// The edge function (generate-resume-rewrite) returns a structured rewrite with
// per-bullet before/after tracked changes; the review UI mutates acceptance
// state client-side before the final document is assembled for export.

import type { BuilderContact, BuilderEducationEntry, BuilderResume } from "@/types/resume-builder";
import { createEmptyContact, createEmptyEducationEntry } from "@/types/resume-builder";

export interface RewriteBulletChange {
  before: string;
  after: string;
  reason: string;
  /** Server reverted the AI's rewrite because it contained an unverifiable number. */
  reverted?: boolean;
}

export interface RewriteExperienceEntry {
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: RewriteBulletChange[];
}

export interface RewriteGroundingReport {
  droppedBullets: number;
  revertedBullets: number;
  droppedJobs: number;
  droppedSkills: number;
  notes: string[];
}

export interface ResumeRewriteData {
  contact: BuilderContact;
  summary: { before: string; after: string; reason?: string };
  experience: RewriteExperienceEntry[];
  education: BuilderEducationEntry[];
  skills: string[];
  certifications: string[];
  strategy: string;
  originalResumeText: string;
  jobDetails: { title: string; company: string };
  grounding: RewriteGroundingReport;
  bracketCount: number;
  modelUsed: string;
  generatedAt: string;
}

/** Per-bullet review state layered on top of the AI output. */
export interface BulletReviewState {
  /** Current text of the accepted version (starts as `after`, user-editable). */
  text: string;
  /** false = user reverted to the original wording. */
  accepted: boolean;
}

export function normalizeRewriteData(raw: Record<string, unknown>): ResumeRewriteData {
  const experience = Array.isArray(raw.experience)
    ? (raw.experience as Record<string, unknown>[]).map((e) => ({
        company: typeof e.company === "string" ? e.company : "",
        title: typeof e.title === "string" ? e.title : "",
        location: typeof e.location === "string" ? e.location : "",
        startDate: typeof e.startDate === "string" ? e.startDate : "",
        endDate: typeof e.endDate === "string" ? e.endDate : "",
        bullets: Array.isArray(e.bullets)
          ? (e.bullets as Record<string, unknown>[]).map((b) => ({
              before: typeof b.before === "string" ? b.before : "",
              after: typeof b.after === "string" ? b.after : String(b.before ?? ""),
              reason: typeof b.reason === "string" ? b.reason : "",
              reverted: b.reverted === true,
            }))
          : [],
      }))
    : [];

  const education = Array.isArray(raw.education)
    ? (raw.education as Record<string, unknown>[]).map((e) => ({ ...createEmptyEducationEntry(), ...e }))
    : [];

  const summaryRaw = (raw.summary ?? {}) as Record<string, unknown>;

  return {
    contact: { ...createEmptyContact(), ...(raw.contact as Partial<BuilderContact> | undefined) },
    summary: {
      before: typeof summaryRaw.before === "string" ? summaryRaw.before : "",
      after: typeof summaryRaw.after === "string" ? summaryRaw.after : "",
      reason: typeof summaryRaw.reason === "string" ? summaryRaw.reason : "",
    },
    experience,
    education,
    skills: Array.isArray(raw.skills) ? (raw.skills as unknown[]).filter((s): s is string => typeof s === "string") : [],
    certifications: Array.isArray(raw.certifications) ? (raw.certifications as unknown[]).filter((s): s is string => typeof s === "string") : [],
    strategy: typeof raw.strategy === "string" ? raw.strategy : "",
    originalResumeText: typeof raw.originalResumeText === "string" ? raw.originalResumeText : "",
    jobDetails: (raw.jobDetails as { title: string; company: string }) ?? { title: "", company: "" },
    grounding: (raw.grounding as RewriteGroundingReport) ?? { droppedBullets: 0, revertedBullets: 0, droppedJobs: 0, droppedSkills: 0, notes: [] },
    bracketCount: typeof raw.bracketCount === "number" ? raw.bracketCount : 0,
    modelUsed: typeof raw.modelUsed === "string" ? raw.modelUsed : "",
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
  };
}

/** Assemble the final BuilderResume from the rewrite + review decisions. */
export function assembleFinalResume(
  data: ResumeRewriteData,
  summaryAccepted: boolean,
  summaryText: string,
  bulletStates: Record<string, BulletReviewState>,
): BuilderResume {
  return {
    contact: data.contact,
    summary: summaryAccepted ? summaryText : data.summary.before,
    experience: data.experience.map((job, ji) => ({
      id: `job-${ji}`,
      company: job.company,
      title: job.title,
      location: job.location,
      startDate: job.startDate,
      endDate: job.endDate,
      bullets: job.bullets.map((b, bi) => {
        const state = bulletStates[`${ji}-${bi}`];
        if (!state) return b.after;
        return state.accepted ? state.text : b.before;
      }),
    })),
    education: data.education,
    skills: data.skills,
    certifications: data.certifications,
  };
}

/** Find unresolved [bracket] placeholders across the accepted content. */
export function findUnresolvedBrackets(resume: BuilderResume): string[] {
  const found: string[] = [];
  const scan = (text: string) => {
    for (const m of text.matchAll(/\[[^\]]{1,60}\]/g)) found.push(m[0]);
  };
  scan(resume.summary);
  for (const job of resume.experience) for (const b of job.bullets) scan(b);
  return found;
}
