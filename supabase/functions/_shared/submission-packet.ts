import { classifyQuestion, type QuestionClass } from "./application-questions.ts";
export type PacketQuestion = {
  label: string;
  required?: boolean;
  fieldType?: string;
  real?: boolean;
};
export type StandingAnswers = {
  workAuthorized?: boolean | null;
  requiresSponsorship?: boolean | null;
  salaryExpectation?: string;
  earliestStart?: string;
  willingToRelocate?: boolean | null;
  shareDemographics?: boolean;
};
export type Profile = {
  fullName?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  website?: string;
  city?: string;
  country?: string;
  resumeFileUrl?: string;
};
export type DraftedAnswer = { label: string; answer: string; supported: boolean; note?: string };
export const COVER_NOTE_FIELD_KEY = "__coverNote";
export type FilledField = {
  key: string;
  value: string;
  source: "profile" | "standing" | "resume" | "drafted" | "declined";
};
export type Blocker = {
  kind:
    | "captcha" | "missing-file" | "missing-standing" | "unsupported-answer"
    | "unknown-form" | "needs-candidate";
  detail: string;
};
export type Packet = {
  fields: FilledField[];
  blockers: Blocker[];
  ready: boolean;
  autoFilled: number;
  total: number;
};
const t = (v: unknown): string => String(v ?? "").trim();
function identityValue(label: string, p: Profile): string {
  const l = label.toLowerCase();
  if (/e-?mail/.test(l)) return t(p.email);
  if (/phone|mobile|telephone/.test(l)) return t(p.phone);
  if (/linked-?in/.test(l)) return t(p.linkedin);
  if (/website|portfolio|github|personal site/.test(l)) return t(p.website);
  if (/city|town|location|where are you/.test(l)) return t(p.city);
  if (/country/.test(l)) return t(p.country);
  if (/name/.test(l)) return t(p.fullName);
  return "";
}
function standingValue(label: string, s: StandingAnswers): string | null {
  const l = label.toLowerCase();
  const yn = (b: boolean | null | undefined) => (b === true ? "Yes" : b === false ? "No" : null);
  if (/sponsor/.test(l)) return yn(s.requiresSponsorship);
  if (/authori[sz]ed|legally able|right to work|work permit|eligible to work/.test(l)) {
    return yn(s.workAuthorized);
  }
  if (/salary|compensation|pay expectation|desired pay/.test(l)) return t(s.salaryExpectation) || null;
  if (/start date|available|notice period|when can you/.test(l)) return t(s.earliestStart) || null;
  if (/relocat/.test(l)) return yn(s.willingToRelocate);
  return null;
}
export function buildPacket(opts: {
  questions: readonly PacketQuestion[];
  profile: Profile;
  standing: StandingAnswers;
  drafted: readonly DraftedAnswer[];
  automationTier: "auto" | "signup" | "click" | "unknown";
  coverNote?: { value: string; tailored: boolean };
}): Packet {
  const { questions, profile, standing, drafted, automationTier } = opts;
  const fields: FilledField[] = [];
  const blockers: Blocker[] = [];
  const draftMap = new Map(drafted.map((d) => [d.label.toLowerCase().trim(), d]));
  for (const q of questions) {
    const label = t(q.label);
    if (!label) continue;
    const cls: QuestionClass = classifyQuestion(label, q.fieldType);
    if (cls === "identity") {
      const v = identityValue(label, profile);
      if (v) fields.push({ key: label, value: v, source: "profile" });
      else if (q.required) {
        blockers.push({ kind: "missing-standing", detail: `profile has no value for "${label}"` });
      }
      continue;
    }
    if (cls === "file") {
      if (t(profile.resumeFileUrl)) {
        fields.push({ key: label, value: t(profile.resumeFileUrl), source: "resume" });
      } else if (q.required) {
        blockers.push({ kind: "missing-file", detail: `"${label}" needs a résumé file on the account` });
      }
      continue;
    }
    if (cls === "demographic") {
      if (!standing.shareDemographics) {
        fields.push({ key: label, value: "Decline to self-identify", source: "declined" });
      }
      continue;
    }
    if (cls === "consent") {
      if (q.required) {
        blockers.push({
          kind: "needs-candidate",
          detail: `"${label}" — a consent you have to give yourself`,
        });
      }
      continue;
    }
    if (cls === "factual") {
      const v = standingValue(label, standing);
      if (v !== null) fields.push({ key: label, value: v, source: "standing" });
      else if (q.required) {
        blockers.push({
          kind: "missing-standing",
          detail: `"${label}" — set this once in your agent profile and it stops asking`,
        });
      }
      continue;
    }
    const d = draftMap.get(label.toLowerCase().trim());
    if (d && d.supported && t(d.answer)) {
      fields.push({ key: label, value: t(d.answer), source: "drafted" });
    } else if (q.required) {
      blockers.push({
        kind: "unsupported-answer",
        detail: d?.note
          ? `"${label}" — ${d.note}`
          : `"${label}" — nothing in your résumé supports an answer`,
      });
    }
  }
  if (automationTier === "click") {
    blockers.push({ kind: "captcha", detail: "this employer's form shows a CAPTCHA — one click from you" });
  }
  if (automationTier === "unknown") {
    blockers.push({ kind: "unknown-form", detail: "we haven't measured this employer's form yet" });
  }
  if (opts.coverNote && t(opts.coverNote.value)) {
    fields.push({
      key: COVER_NOTE_FIELD_KEY,
      value: t(opts.coverNote.value),
      source: opts.coverNote.tailored ? "drafted" : "standing",
    });
  }
  const answered = fields.filter((f) => f.key !== COVER_NOTE_FIELD_KEY).length;
  return {
    fields,
    blockers,
    ready: blockers.length === 0 && answered > 0,
    autoFilled: answered,
    total: questions.filter((q) => t(q.label)).length,
  };
}