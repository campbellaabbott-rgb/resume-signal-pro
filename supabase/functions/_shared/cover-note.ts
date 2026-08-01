/**
 * Per-posting cover notes, and the gate that decides whether one may be sent.
 *
 * WHAT THIS REPLACES. The apply profile has held a single `cover_note` since it
 * shipped: one paragraph, written once, sent verbatim to every employer. That is
 * honest but weak — a note addressed to nobody reads like a note addressed to
 * nobody. Tailoring it per posting is the last real quality upgrade available to
 * the agent, because vendor coverage is closed at 5.16% and cannot be widened
 * without defeating bot detection.
 *
 * WHY THE GATE IS THE FEATURE. A cover note is free prose written by a language
 * model and sent to a stranger under the candidate's name, attached to their CV.
 * It is the single highest-fabrication-risk surface in the product. Everything
 * else the agent fills is a fact it was given: a name, a phone number, a
 * trinary. This is the one place it composes sentences.
 *
 * So generation is the cheap half and `validateCoverNote` is the real one. It is
 * a PURE function, deliberately, so it can be tested in both directions without
 * an LLM: that it rejects invented claims, and — just as important — that it
 * accepts honest ones. A guard that rejects everything is as useless as one that
 * accepts everything, and only the second failure is obvious in production.
 *
 * THE FALLBACK IS ALWAYS SAFE. When the gate fails, the candidate's own note is
 * sent instead, exactly as it is today. A failed tailoring attempt costs a
 * generic note, never a false one, and never a blocked application.
 *
 * TWO KINDS OF FABRICATION, both checked here:
 *
 *   FIGURES — "I grew revenue 40%" when no 40 appears anywhere. Delegated to
 *   validateProseClaims, which allows figures from the JOB POSTING too, because
 *   honest letters cite the employer's own numbers constantly.
 *
 *   PROPER NOUNS — "my time at Google", "I hold an MIT degree", "I built this in
 *   Rust". Numeric grounding is completely blind to these, and they are the more
 *   common and more damaging lie: an employer can check them, and the candidate
 *   has to defend them in an interview they did not know they were walking into.
 *   Every capitalised name in the note must appear in something the candidate or
 *   the employer actually wrote.
 */
import { validateProseClaims } from "./resume-grounding.ts";

/**
 * Bumped whenever the prompt or the gate changes. Stored on the row next to the
 * note so a note sent last month can be told apart from one sent under today's
 * rules — the same reason the salary re-sweep carries a version.
 */
export const COVER_NOTE_VERSION = "2026-08-01.1";

/** Bounds. Below the floor it is not a note; above the ceiling no one reads it,
 *  and several vendors' textareas silently truncate. */
export const MIN_CHARS = 200;
export const MAX_CHARS = 1600;

export type CoverNoteVerdict =
  | { ok: true; note: string }
  | { ok: false; issues: string[] };

/**
 * Words that are capitalised for reasons that have nothing to do with naming an
 * organisation, a school or a technology. Without these the gate would reject
 * every honest letter ever written, which is the failure mode that does not
 * announce itself.
 */
const CAPITALISED_BUT_NOT_A_CLAIM = new Set([
  // letter furniture
  "dear", "hi", "hello", "sincerely", "regards", "best", "thanks", "thank",
  "yours", "faithfully", "kind", "warm",
  // the reader and the role
  "hiring", "manager", "team", "recruiter", "recruiting", "talent", "people",
  "role", "position", "job", "opening", "vacancy", "company", "organisation",
  "organization", "department",
  // pronouns and sentence openers that survive the first-token rule after
  // punctuation the splitter does not catch (quotes, dashes, parentheses)
  "i", "i'm", "i've", "i'd", "i'll", "my", "the", "a", "an", "as", "at", "in",
  "it", "its", "this", "that", "these", "those", "there", "here", "we", "you",
  "your", "and", "but", "or", "so", "if", "when", "while", "with", "for", "from",
  "having", "after", "before", "over", "under", "through", "during", "because",
  "what", "which", "who", "how", "why", "where", "both", "each", "most", "much",
  "more", "many", "some", "any", "all", "one", "two", "three", "first", "second",
  "third", "last", "next", "now", "today", "recently", "currently", "previously",
  // days, months, and the calendar generally
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  // degrees and generic credentials — the SUBJECT still has to be grounded
  "bachelor", "bachelors", "bachelor's", "master", "masters", "master's",
  "phd", "doctorate", "degree", "diploma", "certificate", "certification",
  "university", "college", "school",
]);

/**
 * Claims the note is never allowed to make, no matter what the résumé says.
 *
 * These are the FACTUAL questions — authorisation, sponsorship, salary, notice
 * period. They are trinary standing answers precisely because a wrong one can
 * void an application, and `null` means "not stated" rather than "no". A letter
 * that volunteers "I am authorised to work in the UK" turns an unanswered
 * question into a positive assertion to an employer, made by a machine, on
 * someone else's behalf. The form has its own boxes for these; that is where
 * they get answered, from what the candidate actually configured.
 */
const FORBIDDEN_ASSERTIONS: Array<{ re: RegExp; what: string }> = [
  { re: /\b(?:i|I)\s+(?:am|'m)\s+(?:fully\s+|legally\s+)?(?:authori[sz]ed|eligible|permitted)\s+to\s+work\b/i, what: "work authorisation" },
  { re: /\b(?:i|I)\s+(?:do\s+not|don't|will\s+not|won't)\s+(?:require|need)\s+(?:visa\s+)?sponsorship\b/i, what: "sponsorship status" },
  { re: /\b(?:i|I)\s+(?:require|need)\s+(?:visa\s+)?sponsorship\b/i, what: "sponsorship status" },
  { re: /\b(?:i|I)\s+(?:have|hold)\s+(?:the\s+)?(?:right\s+to\s+work|a\s+valid\s+visa|permanent\s+residency)\b/i, what: "immigration status" },
  { re: /\bmy\s+salary\s+(?:expectation|requirement)s?\s+(?:is|are)\b/i, what: "salary expectation" },
  { re: /\b(?:i|I)\s+can\s+start\s+(?:on|immediately|within)\b/i, what: "start date" },
];

/** Placeholder text a model leaves behind when it does not know something. Any
 *  one of these reaching an employer is worse than sending nothing at all. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[[^\]]{2,40}\]/,          // [Your Name], [Company]
  /\{\{[^}]{1,40}\}\}/,       // {{company}}
  /\bX{3,}\b/,                // XXXX
  /\b(?:TBD|TODO|FIXME|LOREM IPSUM)\b/i,
  /\binsert\s+(?:your|the)\s+\w+/i,
  /\byour\s+company\s+name\b/i,
];

/** Fold to a bag of comparable words. Mirrors normalizeForMatch's intent but
 *  keeps it local: this compares NAMES, not prose, so punctuation and
 *  possessives must not defeat a match ("Acme's" ≡ "Acme"). */
function foldForNameMatch(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * Capitalised names the note asserts, minus the ones that are capitalised for
 * grammar rather than for meaning.
 *
 * The first token after sentence-ending punctuation is skipped, because every
 * sentence starts with a capital and treating those as claims would flag the
 * word "Having" in "Having led two migrations…".
 */
function assertedNames(text: string): string[] {
  const out: string[] = [];
  // Split on sentence enders AND newlines — a letter's greeting and sign-off
  // are their own lines and each starts a fresh "sentence" for this purpose.
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const tokens = sentence.trim().split(/\s+/).filter(Boolean);
    let run: string[] = [];
    const flush = () => {
      if (run.length) out.push(run.join(" "));
      run = [];
    };
    tokens.forEach((rawToken, i) => {
      // Strip surrounding punctuation but keep internal dots/pluses/hashes so
      // "Node.js", "C++" and "C#" survive as themselves. The trailing dot has
      // to go separately: keeping it for "Node.js" also kept the full stop on
      // "…in Python and Go.", which then matched nothing and reported the
      // candidate's own listed skill as an invented one.
      const tok = rawToken
        .replace(/^[^A-Za-z0-9]+/, "")
        .replace(/[^A-Za-z0-9+#.]+$/, "")
        .replace(/\.+$/, "");
      if (!tok) { flush(); return; }
      const isCapitalised = /^[A-Z]/.test(tok);
      const isAcronym = /^[A-Z0-9][A-Z0-9+#.]{1,}$/.test(tok) && /[A-Z]/.test(tok);
      // An acronym counts even at position 0: a sentence that opens with "AWS
      // is where I spent four years" is still a claim about AWS.
      const positional = i === 0 && !isAcronym;
      if (!isCapitalised || positional || CAPITALISED_BUT_NOT_A_CLAIM.has(tok.toLowerCase())) {
        flush();
        return;
      }
      run.push(tok);
    });
    flush();
  }
  return [...new Set(out)];
}

/**
 * The whole verdict. Pure — no network, no clock, no randomness — so the tests
 * can pin every branch.
 *
 * `haystack` is everything the candidate or the employer actually wrote: the
 * résumé, the posting, the company name, the candidate's own name, and their
 * base note. A name from the candidate's OWN note is theirs to make; the model
 * did not invent it, so it passes.
 */
export function validateCoverNote(opts: {
  note: string;
  resumeText: string;
  jobDescription?: string;
  jobTitle?: string;
  company?: string;
  candidateName?: string;
  /** The candidate's standing note. Anything they wrote themselves is allowed. */
  baseNote?: string;
}): CoverNoteVerdict {
  const note = (opts.note ?? "").trim();
  const issues: string[] = [];

  if (!note) return { ok: false, issues: ["The model returned nothing"] };
  if (note.length < MIN_CHARS) issues.push(`Too short to send (${note.length} chars, floor is ${MIN_CHARS})`);
  if (note.length > MAX_CHARS) issues.push(`Too long (${note.length} chars, ceiling is ${MAX_CHARS})`);

  for (const re of PLACEHOLDER_PATTERNS) {
    const m = note.match(re);
    if (m) issues.push(`Unfilled placeholder: "${m[0].slice(0, 40)}"`);
  }

  for (const { re, what } of FORBIDDEN_ASSERTIONS) {
    if (re.test(note)) {
      issues.push(`Asserts ${what} — that belongs in the form's own field, from the candidate's standing answer`);
    }
  }

  // Figures: résumé-grounded, with the posting allowed as supporting context.
  const context = [opts.jobDescription ?? "", opts.jobTitle ?? "", opts.company ?? ""].join("\n");
  for (const issue of validateProseClaims(opts.resumeText ?? "", note, context)) issues.push(issue);

  // Names: every capitalised claim must come from somewhere real.
  const hay = foldForNameMatch([
    opts.resumeText ?? "", opts.jobDescription ?? "", opts.jobTitle ?? "",
    opts.company ?? "", opts.candidateName ?? "", opts.baseNote ?? "",
  ].join("\n"));
  const ungrounded = assertedNames(note).filter((name) => {
    const folded = foldForNameMatch(name).trim();
    if (!folded) return false;
    if (hay.includes(` ${folded} `)) return false;
    // A multi-word run is grounded if EVERY word of it is — "Acme Robotics"
    // passes when the résumé says "Acme" and the posting says "Robotics".
    // Requiring the exact run would reject honest paraphrase constantly.
    return !folded.split(" ").every((w) => hay.includes(` ${w} `));
  });
  for (const name of ungrounded.slice(0, 6)) {
    issues.push(`"${name}" appears in neither the résumé, the posting, nor the candidate's own note`);
  }

  return issues.length ? { ok: false, issues } : { ok: true, note };
}

/**
 * The instruction half. Separated from the call site so the tests can assert
 * what the model is actually told, and so the rules live next to the gate that
 * enforces them rather than drifting away from it.
 */
export function coverNotePrompt(opts: {
  jobTitle: string;
  company: string;
  jobDescription?: string;
  baseNote: string;
  resumeText: string;
}): { system: string; user: string } {
  const system = `You write a short cover note for ONE job application, in the candidate's own voice.

ABSOLUTE RULES — a note that breaks any of these is discarded and the candidate's generic note is sent instead:
- Use ONLY facts present in the RESUME or the candidate's OWN NOTE. Invent nothing.
- Never name an employer, school, product, technology or certification that does not appear in the RESUME, the candidate's OWN NOTE, or the JOB POSTING.
- Never state a figure that does not appear in the RESUME or the JOB POSTING.
- Never mention work authorisation, visa status, sponsorship, salary expectations or start dates. The form has its own fields for those.
- Never leave a placeholder such as [Your Name] or {{company}}. If you do not know something, write around it.
- If the resume does not genuinely support a claim of fit, say plainly why the candidate is interested rather than overstating experience they do not have.

STYLE: ${MIN_CHARS}-${MAX_CHARS} characters. First person. Specific, not effusive. No salutation and no sign-off — the form supplies those. Three short paragraphs at most. Keep the candidate's own note as the backbone and adapt it to THIS role; do not discard their voice for generic enthusiasm.

Return ONLY the note text, with no preamble, no quotes and no markdown.`;

  const user = `ROLE: ${opts.jobTitle || "(unknown role)"} at ${opts.company || "(unknown company)"}

JOB POSTING:
${(opts.jobDescription ?? "").slice(0, 4000) || "(not provided)"}

THE CANDIDATE'S OWN NOTE (their voice — keep it):
${opts.baseNote || "(they have not written one)"}

RESUME:
${(opts.resumeText ?? "").slice(0, 8000)}`;

  return { system, user };
}
