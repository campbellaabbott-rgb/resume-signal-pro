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

/**
 * generate-application-answers answers in ITS shape, keyed by `question`:
 * {question, answer, supported, note, anticipated}. buildPacket reads
 * `label`. apply-agent handed the first to the second unconverted, so every
 * posting with a draftable question threw inside buildPacket (`d.label` was
 * undefined), the per-posting catch counted a failure, no row was written, and
 * the model was asked again the next hour (register 1.11). One converter, used
 * at the boundary, so the two shapes cannot meet unconverted again: `question`
 * or `label` becomes the label, `supported` is true only when it is literally
 * true, and an entry with no label at all is dropped rather than guessed at.
 */
export function toDraftedAnswers(raw: unknown): DraftedAnswer[] {
  if (!Array.isArray(raw)) return [];
  const out: DraftedAnswer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const label = String(a.question ?? a.label ?? "").trim();
    if (!label) continue;
    out.push({
      label,
      answer: String(a.answer ?? ""),
      supported: a.supported === true,
      ...(typeof a.note === "string" && a.note.trim() ? { note: a.note } : {}),
    });
  }
  return out;
}

/**
 * Reserved key carrying the cover note through `fields` to the worker.
 *
 * Every other key in `fields` is a QUESTION LABEL read off the employer's form.
 * This one is not, and the underscores say so. It rides here because `fields`
 * already travels intact from apply-agent → agent_submissions → apply-broker →
 * the worker, so a note added at prep time reaches the browser with no schema
 * change and no new broker action to keep in sync.
 *
 * It is excluded from `autoFilled` and `total` below — those are counts a
 * candidate reads as "how much of this form did the agent fill", and a pseudo
 * field that is not on the form would make them overstate by one.
 */
export const COVER_NOTE_FIELD_KEY = "__coverNote";

export type FilledField = {
  key: string;
  value: string;
  /** Where the value came from — a reviewer must be able to tell a fact from a
   *  generated sentence without reading both and guessing. */
  source: "profile" | "standing" | "resume" | "drafted" | "declined";
};

export type Blocker = {
  // `needs-candidate` is distinct from `missing-standing` on purpose: a standing
  // answer is one the candidate can set ONCE in their profile and stop being
  // asked. A consent is per-employer and per-document, so there is nothing to
  // pre-fill and telling them to "set this once" would be wrong advice.
  kind:
    | "captcha" | "missing-file" | "missing-standing" | "unsupported-answer"
    | "unknown-form" | "needs-candidate";
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
//
// BUT A NAME BOX IS NOT ALWAYS THE CANDIDATE'S WHOLE NAME. "First name" and
// "Last name" are halves of it, and "Company name", "Referrer name" or
// "Emergency contact name" are somebody else's altogether — every one of them
// was filled with the full name (register 2.32 / L9-05). The halves are split
// the way the broker splits them for the worker; someone else's name is
// answered with nothing, so a required one blocks instead of being invented.
const SOMEONE_ELSES_NAME =
  /\b(company|employer|organi[sz]ation|business|referr\w*|referee|reference|recruiter|manager|supervisor|emergency|contact\s+person|school|university|college|institution|spouse|partner|parent|guardian|father|mother|maiden)\b/;
function nameValue(l: string, fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (SOMEONE_ELSES_NAME.test(l)) return "";
  if (/\b(first|given|fore)\s*-?\s*name\b|\bfirstname\b/.test(l)) return parts[0] ?? "";
  if (/\b(last|sur|family)\s*-?\s*name\b|\bsurname\b|\blastname\b/.test(l)) {
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  }
  if (/\bmiddle\s+name\b/.test(l)) return "";
  return fullName;
}

function identityValue(label: string, p: Profile): string {
  const l = label.toLowerCase();
  if (/e-?mail/.test(l)) return t(p.email);
  if (/phone|mobile|telephone/.test(l)) return t(p.phone);
  if (/linked-?in/.test(l)) return t(p.linkedin);
  if (/website|portfolio|github|personal site/.test(l)) return t(p.website);
  if (/city|town|location|where are you/.test(l)) return t(p.city);
  if (/country/.test(l)) return t(p.country);
  if (/name/.test(l)) return nameValue(l, t(p.fullName));
  return "";
}

/**
 * The same three rules the worker's matcher (worker/src/questions/match.ts)
 * applies to the same labels, so the review sheet a candidate reads and the
 * form the worker fills cannot state opposite things:
 *
 *   CURRENT pay is not held. An expectation is not a substitute for it — a
 *   current salary stated to a prospective employer is a fabrication with
 *   consequences in a negotiation.
 *   "...WITHOUT sponsorship" flips the answer.
 *   A START DATE is asked many ways; "What days are you available to work?"
 *   is not one of them (it asks for a schedule).
 */
const SALARY_CURRENT =
  /\b(current|present|existing|latest|most\s+recent)\b[^?]{0,40}\b(salary|compensation|package|ctc|cost\s+to\s+company|remuneration|pay|earnings|wage)|(salary|compensation|package|ctc|remuneration|earnings)\b[^?]{0,20}\b(current|present)\b/;
const SPONSOR_INVERTED =
  /without\s+(the\s+need\s+for\s+|needing\s+(any\s+)?|requiring\s+(any\s+)?)?(visa\s+)?sponsor|not\s+require\s+sponsor|no\s+sponsorship\s+(required|needed)|free\s+from\s+(any\s+)?(visa|immigration)/;
const START_DATE =
  /notice\s+period|when\s+(can|could|are|would)\s+you\s+(be\s+able\s+to\s+)?(start|commence|be\s+available\s+to\s+start)|start\s+date|date\s+(that\s+)?you\s+(could|can|would\s+be\s+able\s+to)\s+start|available\s+to\s+(start|commence|begin)|availability\s+to\s+start|earliest[^?]{0,30}(start|begin|commence)|how\s+soon\s+(can|could)\s+you/;

/** A cover-letter box: a document slot, or a text area that wants the note itself. */
const COVER_LETTER = /cover\s*-?\s*letter|motivation(al)?\s+letter|letter\s+of\s+motivation/;

// Factual questions are the ones a résumé genuinely cannot answer — work
// authorisation, sponsorship, salary, start date, relocation. Guessing at these
// is not a smaller sin than inventing experience; a wrong sponsorship answer can
// void an application outright. They come from what the candidate configured, or
// they block.
function standingValue(label: string, s: StandingAnswers): string | null {
  const l = label.toLowerCase();
  const yn = (b: boolean | null | undefined) => (b === true ? "Yes" : b === false ? "No" : null);
  if (/sponsor/.test(l)) {
    // "Authorized to work ... WITHOUT sponsorship?" asks the opposite question
    // to "Will you require sponsorship?", and answering both with the same
    // boolean told an authorised candidate's review sheet to say No.
    if (s.requiresSponsorship === null || s.requiresSponsorship === undefined) return null;
    return yn(SPONSOR_INVERTED.test(l) ? !s.requiresSponsorship : s.requiresSponsorship);
  }
  if (/authori[sz]ed|legally able|right to work|work permit|eligible to work/.test(l)) {
    return yn(s.workAuthorized);
  }
  // Current pay first, and never answered: null blocks a required one.
  if (SALARY_CURRENT.test(l)) return null;
  if (/salary|compensation|pay expectation|desired pay/.test(l)) return t(s.salaryExpectation) || null;
  if (START_DATE.test(l)) return t(s.earliestStart) || null;
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
  /**
   * The note to put in whatever cover-letter box the form turns out to have.
   * `tailored` records whether it was written for THIS posting and passed the
   * grounding gate, or is the candidate's standing note sent as-is — the two
   * must stay distinguishable on the row, because a reviewer has to be able to
   * tell a generated sentence from one the candidate wrote themselves.
   */
  coverNote?: { value: string; tailored: boolean };
}): Packet {
  const { questions, profile, standing, drafted, automationTier } = opts;
  const fields: FilledField[] = [];
  const blockers: Blocker[] = [];
  // Tolerant of an entry with no label (see toDraftedAnswers): such an entry
  // answers nothing and is skipped, rather than throwing for the whole packet.
  const draftMap = new Map<string, DraftedAnswer>();
  for (const d of drafted ?? []) {
    const key = t((d as { label?: unknown } | null)?.label).toLowerCase();
    if (key && !draftMap.has(key)) draftMap.set(key, d);
  }

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
      // A COVER LETTER IS NOT THE RÉSUMÉ. The classifier calls any label
      // naming one a file question whatever the control is, and this branch
      // then put the résumé's storage path in a "Cover Letter" text box (or
      // attached the résumé as the cover letter). A text box gets the note;
      // a document slot has nothing we hold, so a required one blocks.
      if (COVER_LETTER.test(label.toLowerCase())) {
        const type = String(q.fieldType ?? "").toLowerCase();
        const isDocument = type.includes("file");
        const note = t(opts.coverNote?.value);
        if (!isDocument && note) {
          fields.push({ key: label, value: note, source: opts.coverNote?.tailored ? "drafted" : "standing" });
        } else if (q.required) {
          blockers.push(isDocument
            ? { kind: "missing-file", detail: `"${label}" wants a cover-letter document, and the account holds only a résumé` }
            : { kind: "missing-standing", detail: `"${label}" — write a cover note once in your agent profile and it is used here` });
        }
        continue;
      }
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

    if (cls === "consent") {
      // NEVER answered, and unlike a demographic question it is never declined
      // on the candidate's behalf either. "I have read and agree to the privacy
      // notice" is a statement about something a specific person did; ticking it
      // for them is a false statement to an employer, and leaving a required one
      // silently unticked is a submission the employer will treat as consented.
      //
      // A required consent therefore BLOCKS. On the click-to-submit path that
      // costs nothing — the candidate is already at the form, and the link is
      // one they should read. On the unattended path it is the difference
      // between the agent declining to attest and the agent attesting.
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

  // Carried, not counted. Added after the loop so it can never be mistaken for
  // an answer to one of the employer's questions.
  if (opts.coverNote && t(opts.coverNote.value)) {
    fields.push({
      key: COVER_NOTE_FIELD_KEY,
      value: t(opts.coverNote.value),
      source: opts.coverNote.tailored ? "drafted" : "standing",
    });
  }

  // Both counts ignore the reserved key. `autoFilled` is read as "how many of
  // this form's questions did the agent fill", and `ready` must not be able to
  // flip true on a packet whose only field is a note for a box that may not
  // even exist on the form.
  const answered = fields.filter((f) => f.key !== COVER_NOTE_FIELD_KEY).length;

  return {
    fields,
    blockers,
    ready: blockers.length === 0 && answered > 0,
    autoFilled: answered,
    total: questions.filter((q) => t(q.label)).length,
  };
}
