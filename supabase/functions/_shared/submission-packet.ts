// Turns an employer's application form into a filled packet — and, just as
// importantly, decides where the agent must STOP.
//
// This is the file where "auto-apply" either stays honest or stops being worth
// having. An agent that fills every box will, sooner or later, put a confident
// sentence about Kubernetes into an application belonging to someone who has
// never run it — and that person then sits in an interview defending a claim
// they never made. The platform's existing answer generator already refuses that
// (it returns supported:false with a note rather than inventing). This module is
// what makes the refusal matter: an unsupported answer becomes a BLOCKER, the
// packet cannot be marked ready, and nothing is sent.
//
// So the rule is: the agent applies by itself wherever it has real material for
// every required field, and hands back to the human wherever it does not. The
// share of applications it can finish alone is then a measurement, not a policy
// setting — and it is high, because most fields are identity and a résumé.
import { classifyQuestion, type QuestionClass } from "./application-questions.ts";

export type PacketQuestion = {
  label: string;
  required?: boolean;
  fieldType?: string;
  /** Only Greenhouse publishes real questions; everywhere else this is false. */
  real?: boolean;
};

/** What the candidate configured once, so factual questions stop being blockers. */
export type StandingAnswers = {
  workAuthorized?: boolean | null;
  requiresSponsorship?: boolean | null;
  salaryExpectation?: string;
  earliestStart?: string;
  willingToRelocate?: boolean | null;
  /** Demographic/EEO: honoured as given, defaulting to declining to answer. */
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

export type FilledField = {
  key: string;
  value: string;
  /** Where the value came from — a reviewer must be able to tell a fact from a
   *  generated sentence without reading both and guessing. */
  source: "profile" | "standing" | "resume" | "drafted" | "declined";
};

export type Blocker = {
  kind: "captcha" | "missing-file" | "missing-standing" | "unsupported-answer" | "unknown-form";
  detail: string;
};

export type Packet = {
  fields: FilledField[];
  blockers: Blocker[];
  /** True only when every required field is filled and nothing blocks a send. */
  ready: boolean;
  /** Of the questions on the form, how many the agent filled unaided. */
  autoFilled: number;
  total: number;
};

const t = (v: unknown): string => String(v ?? "").trim();

// Identity questions map to profile fields by intent, not by exact label —
// "Full name", "Your name" and "Name" are the same box.
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

// Factual questions are the ones a résumé genuinely cannot answer — work
// authorisation, sponsorship, salary, start date, relocation. Guessing at these
// is not a smaller sin than inventing experience; a wrong sponsorship answer can
// void an application outright. They come from what the candidate configured, or
// they block.
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
  /** From apply-automation.ts — 'click' means a CAPTCHA is known to be present. */
  automationTier: "auto" | "signup" | "click" | "unknown";
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
      // EEO/demographic questions are voluntary by law and by design. The agent
      // declines on the candidate's behalf unless they explicitly opted in —
      // silence is the safe default, and it is never a reason to block a send.
      if (!standing.shareDemographics) {
        fields.push({ key: label, value: "Decline to self-identify", source: "declined" });
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

    // draftable
    const d = draftMap.get(label.toLowerCase().trim());
    if (d && d.supported && t(d.answer)) {
      fields.push({ key: label, value: t(d.answer), source: "drafted" });
    } else if (q.required) {
      // THE LINE. An unsupported answer is a gap in the résumé, not a sentence to
      // send. Blocking here is what stops auto-apply from becoming auto-fiction.
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
    // Never claim a form we have never looked at can be completed unattended.
    blockers.push({ kind: "unknown-form", detail: "we haven't measured this employer's form yet" });
  }

  return {
    fields,
    blockers,
    ready: blockers.length === 0 && fields.length > 0,
    autoFilled: fields.length,
    total: questions.filter((q) => t(q.label)).length,
  };
}
