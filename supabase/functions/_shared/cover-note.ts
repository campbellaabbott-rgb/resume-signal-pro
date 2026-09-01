import { validateProseClaims } from "./resume-grounding.ts";
export const COVER_NOTE_VERSION = "2026-08-01.1";
export const MIN_CHARS = 200;
export const MAX_CHARS = 1600;
export type CoverNoteVerdict =
  | { ok: true; note: string }
  | { ok: false; issues: string[] };
export const LANGUAGES_THE_GATE_CAN_CHECK = new Set([
  "en", "en-gb", "es", "fr", "pt", "nl", "tl",
]);
export function gateCanCheck(language?: string): boolean {
  const l = (language ?? "").trim().toLowerCase();
  if (!l) return true;
  return LANGUAGES_THE_GATE_CAN_CHECK.has(l) ||
    LANGUAGES_THE_GATE_CAN_CHECK.has(l.split("-")[0]);
}
const CAPITALISED_BUT_NOT_A_CLAIM = new Set([
  "dear", "hi", "hello", "sincerely", "regards", "best", "thanks", "thank",
  "yours", "faithfully", "kind", "warm",
  "hiring", "manager", "team", "recruiter", "recruiting", "talent", "people",
  "role", "position", "job", "opening", "vacancy", "company", "organisation",
  "organization", "department",
  "i", "i'm", "i've", "i'd", "i'll", "my", "the", "a", "an", "as", "at", "in",
  "it", "its", "this", "that", "these", "those", "there", "here", "we", "you",
  "your", "and", "but", "or", "so", "if", "when", "while", "with", "for", "from",
  "having", "after", "before", "over", "under", "through", "during", "because",
  "what", "which", "who", "how", "why", "where", "both", "each", "most", "much",
  "more", "many", "some", "any", "all", "one", "two", "three", "first", "second",
  "third", "last", "next", "now", "today", "recently", "currently", "previously",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "bachelor", "bachelors", "bachelor's", "master", "masters", "master's",
  "phd", "doctorate", "degree", "diploma", "certificate", "certification",
  "university", "college", "school",
]);
const FORBIDDEN_ASSERTIONS: Array<{ re: RegExp; what: string }> = [
  { re: /\b(?:i|I)\s+(?:am|'m)\s+(?:fully\s+|legally\s+)?(?:authori[sz]ed|eligible|permitted)\s+to\s+work\b/i, what: "work authorisation" },
  { re: /\b(?:i|I)\s+(?:do\s+not|don't|will\s+not|won't)\s+(?:require|need)\s+(?:visa\s+)?sponsorship\b/i, what: "sponsorship status" },
  { re: /\b(?:i|I)\s+(?:require|need)\s+(?:visa\s+)?sponsorship\b/i, what: "sponsorship status" },
  { re: /\b(?:i|I)\s+(?:have|hold)\s+(?:the\s+)?(?:right\s+to\s+work|a\s+valid\s+visa|permanent\s+residency)\b/i, what: "immigration status" },
  { re: /\bmy\s+salary\s+(?:expectation|requirement)s?\s+(?:is|are)\b/i, what: "salary expectation" },
  { re: /\b(?:i|I)\s+can\s+start\s+(?:on|immediately|within)\b/i, what: "start date" },
];
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[[^\]]{2,40}\]/,
  /\{\{[^}]{1,40}\}\}/,
  /\bX{3,}\b/,
  /\b(?:TBD|TODO|FIXME|LOREM IPSUM)\b/i,
  /\binsert\s+(?:your|the)\s+\w+/i,
  /\byour\s+company\s+name\b/i,
];
function foldForNameMatch(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}
function assertedNames(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const tokens = sentence.trim().split(/\s+/).filter(Boolean);
    let run: string[] = [];
    const flush = () => {
      if (run.length) out.push(run.join(" "));
      run = [];
    };
    tokens.forEach((rawToken, i) => {
      const tok = rawToken
        .replace(/^[^A-Za-z0-9]+/, "")
        .replace(/[^A-Za-z0-9+#.]+$/, "")
        .replace(/\.+$/, "");
      if (!tok) { flush(); return; }
      const isCapitalised = /^[A-Z]/.test(tok);
      const isAcronym = /^[A-Z0-9][A-Z0-9+#.]{1,}$/.test(tok) && /[A-Z]/.test(tok);
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
export function validateCoverNote(opts: {
  note: string;
  resumeText: string;
  jobDescription?: string;
  jobTitle?: string;
  company?: string;
  candidateName?: string;
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
  const context = [opts.jobDescription ?? "", opts.jobTitle ?? "", opts.company ?? ""].join("\n");
  for (const issue of validateProseClaims(opts.resumeText ?? "", note, context)) issues.push(issue);
  const hay = foldForNameMatch([
    opts.resumeText ?? "", opts.jobDescription ?? "", opts.jobTitle ?? "",
    opts.company ?? "", opts.candidateName ?? "", opts.baseNote ?? "",
  ].join("\n"));
  const ungrounded = assertedNames(note).filter((name) => {
    const folded = foldForNameMatch(name).trim();
    if (!folded) return false;
    if (hay.includes(` ${folded} `)) return false;
    return !folded.split(" ").every((w) => hay.includes(` ${w} `));
  });
  for (const name of ungrounded.slice(0, 6)) {
    issues.push(`"${name}" appears in neither the résumé, the posting, nor the candidate's own note`);
  }
  return issues.length ? { ok: false, issues } : { ok: true, note };
}
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