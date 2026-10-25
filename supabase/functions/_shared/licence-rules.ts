/**
 * LICENCES, WITH THE PLACE THAT ISSUED THEM.
 *
 * A registered nurse licensed in Illinois is not licensed in Texas, and a
 * Queensland electrical licence is not a Victorian one. Résumé matching reads
 * a licence as a kind plus a jurisdiction on both sides: the résumé's own
 * lines ("Arizona RN license (multistate/compact)") and the posting's ("active
 * Texas RN license or compact license required"). Pure and import-free: the
 * browser loads it inside the profile chunk, and resume-match on the server.
 *
 * A LICENCE IS A GATE ONLY AFTER ITS EXTRACTOR PASSED AN AUDIT. The chances
 * sample (10 postings each) read nurse 10/10, physical therapist 10/10,
 * pharmacist 9/10, truck driver 7/10, electrician 4/10, teacher 1/10. None of
 * those is the 57-of-60 audit the spec asks for, so AUDITED_LICENCE_FAMILIES
 * starts empty and every licence is information on the card: a missing one
 * keeps a row out of Strong, it never sets the row aside.
 *
 * COMPACT STATES. The Nurse Licensure Compact list below is the set whose
 * multistate licences were being issued and honoured when this file was
 * written. States that enacted the compact but had not implemented it are kept
 * apart (NLC_PENDING) and treated as NOT compact: calling a licence "met" that
 * the state does not yet honour would be a false claim, while "transfer
 * pending" understates nothing.
 */

export const LICENCE_RULES_VERSION = "2026-10-16.1";

export type LicenceKind =
  | "rn" | "lpn" | "np" | "pharmacist" | "pt" | "ot" | "cpa" | "teacher" | "electrician"
  | "cdl" | "pe" | "epa608" | "nmc" | "ahpra" | "clearance";

export interface Licence {
  kind: LicenceKind;
  /** A state/province code (TX, ON, QLD), a body (NMC), or null when the line names none. */
  jurisdiction: string | null;
  /** A multistate (Nurse Licensure Compact) licence. */
  compact: boolean;
  /** CDL class (A, B, C) or clearance level (secret, top secret, ts/sci). */
  grade?: string | null;
  /** The line it was read from, at most QUOTE_CHARS. */
  basis: string;
}

export interface PostingLicence {
  kind: LicenceKind;
  /** Jurisdictions the posting names for this licence; empty = none named. */
  jurisdictions: string[];
  /** "or eligible", "upon hire", "within 90 days", "prior to start": the posting accepts it pending. */
  pending: boolean;
  /** The posting says a compact / multistate licence is accepted. */
  compactAccepted: boolean;
  grade?: string | null;
  quote: string;
}

/** Quotes on either side are cut to this many characters (owner decision 2: about 160). */
export const QUOTE_CHARS = 160;

/** Nurse Licensure Compact states with multistate licences in force. */
export const NLC_STATES: ReadonlySet<string> = new Set([
  "AL", "AZ", "AR", "CO", "DE", "FL", "GA", "ID", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MS", "MO",
  "MT", "NE", "NH", "NJ", "NM", "NC", "ND", "OH", "OK", "PA", "RI", "SD", "TN", "TX", "UT", "VT", "VA",
  "WA", "WV", "WI", "WY",
]);
/** Enacted, not yet honouring multistate licences when this was written: treated as not compact. */
export const NLC_PENDING: ReadonlySet<string> = new Set(["CT", "MA"]);

/**
 * A licence family is gated only after its posting extractor passed an audit
 * of at least 57 correct reads out of 60. Every entry names the day and the
 * score; the test refuses one under 57/60.
 */
export interface LicenceAudit { kind: LicenceKind; auditedOn: string; correct: number; of: number }
export const AUDIT_PASS = { correct: 57, of: 60 } as const;
export const AUDITED_LICENCE_FAMILIES: readonly LicenceAudit[] = [];

export function licenceIsGate(kind: LicenceKind): boolean {
  return AUDITED_LICENCE_FAMILIES.some((a) => a.kind === kind && a.of >= AUDIT_PASS.of && a.correct * AUDIT_PASS.of >= AUDIT_PASS.correct * a.of);
}

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};
const AU_STATES: Record<string, string> = {
  queensland: "QLD", qld: "QLD", "new south wales": "NSW", nsw: "NSW", victoria: "VIC", vic: "VIC",
  "western australia": "WA", "south australia": "SA", tasmania: "TAS",
};
const CA_PROVINCES: Record<string, string> = {
  ontario: "ON", quebec: "QC", "british columbia": "BC", alberta: "AB", manitoba: "MB", saskatchewan: "SK",
  "nova scotia": "NS", "new brunswick": "NB",
};
const US_CODES = new Set(Object.values(US_STATE_NAMES));

export function stateCodeOf(word: string): string | null {
  const w = word.trim().toLowerCase();
  if (US_STATE_NAMES[w]) return US_STATE_NAMES[w];
  if (AU_STATES[w]) return AU_STATES[w];
  if (CA_PROVINCES[w]) return CA_PROVINCES[w];
  const up = word.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(word.trim()) && US_CODES.has(up)) return up;
  return null;
}

const STATE_NAME_ALT = Object.keys(US_STATE_NAMES).sort((a, b) => b.length - a.length).join("|");
const STATE_WORD = new RegExp(`\\b(${STATE_NAME_ALT})\\b`, "gi");
const STATE_CODE_WORD = /(^|[^A-Za-z])([A-Z]{2})(?=[^A-Za-z]|$)/g;
/**
 * Upper-case pairs that are something else in a posting's own words more often
 * than a state: OR (operating room), PA (physician assistant), MD, ME, IN, OK,
 * CO, HI, ID. They count as a state only in the ", XX" form ("Portland, OR").
 */
const AMBIGUOUS_CODES = new Set(["OR", "PA", "MD", "ME", "IN", "OK", "CO", "HI", "ID"]);

/** Every US state a short span names, by name or by upper-case code. */
export function statesIn(span: string): string[] {
  const out = new Set<string>();
  for (const m of span.matchAll(STATE_WORD)) out.add(US_STATE_NAMES[m[1].toLowerCase()]);
  for (const m of span.matchAll(STATE_CODE_WORD)) {
    const code = m[2];
    if (!US_CODES.has(code)) continue;
    if (AMBIGUOUS_CODES.has(code)) {
      const before = span.slice(Math.max(0, (m.index ?? 0) - 1), (m.index ?? 0) + m[1].length);
      if (!/,\s?$/.test(before) && !/,$/.test(m[1])) continue;
    }
    out.add(code);
  }
  return [...out];
}

export const cut = (s: string, n = QUOTE_CHARS): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

/** The sentence (or line) around index i, cut to QUOTE_CHARS. */
export function sentenceAt(text: string, i: number, len = 0): string {
  let s = i;
  while (s > 0 && !/[.!?\n•;]/.test(text[s - 1])) s--;
  let e = i + len;
  while (e < text.length && !/[.!?\n•;]/.test(text[e])) e++;
  return cut(text.slice(s, e));
}

const PENDING = /\bor (?:be )?eligible\b|\beligib(?:le|ility) (?:for|to obtain)\b|\bupon hire\b|\bwithin \d{1,3} (?:days|months)\b|\bprior to (?:start|hire|employment)\b|\bby (?:the )?start date\b|\bable to obtain\b|\bobtain(?:ed)? within\b|\bpending\b/i;
const COMPACT = /\b(?:compact|multi-?state|nlc)\b/i;

interface KindRule { kind: LicenceKind; posting: RegExp; resume: RegExp }
const RULES: KindRule[] = [
  { kind: "np", posting: /\b(?:nurse practitioner|aprn|np)\b[^.\n]{0,40}\b(?:licen[cs]e|licensure|certif)/i, resume: /\b(?:nurse practitioner|aprn)\b[^.\n]{0,30}\blicen[cs]e/i },
  { kind: "lpn", posting: /\b(?:lpn|lvn|licensed (?:practical|vocational) nurse)\b[^.\n]{0,40}\b(?:licen[cs]e|licensure|required)/i, resume: /\b(?:lpn|lvn|licensed (?:practical|vocational) nurse)\b/i },
  {
    kind: "rn",
    posting: /\b(?:registered nurse|rn)\b[^.\n]{0,60}\b(?:licen[cs]e|licensure)\b|\b(?:licen[cs]ed|licensure) (?:as an? )?(?:registered nurse|rn)\b|\bmultistate (?:rn )?licen[cs]e\b|\bcompact (?:rn |nursing )?licen[cs]e\b/i,
    resume: /\b(?:rn|registered nurse)\s+licen[cs]e\b|\blicen[cs]ed (?:as an? )?(?:rn|registered nurse)\b|\bmultistate (?:rn )?licen[cs]e\b/i,
  },
  { kind: "nmc", posting: /\bnmc\b[^.\n]{0,40}\b(?:registration|registered|pin)\b|\bnmc pin\b/i, resume: /\bnmc[- ]registered\b|\bnmc (?:registration|pin)\b/i },
  { kind: "ahpra", posting: /\bahpra\b/i, resume: /\bahpra\b/i },
  { kind: "pharmacist", posting: /\b(?:licensed pharmacist|pharmacist licen[cs]e|rph\b|licen[cs]ed? (?:to practice )?(?:as a )?pharmac)/i, resume: /\b(?:licensed pharmacist|pharmacist licen[cs]e|\brph\b)/i },
  { kind: "pt", posting: /\b(?:licensed physical therapist|physical therapist licen[cs]e|pt licen[cs]e|licen[cs]ed? (?:to practice )?(?:as a )?physical therap)/i, resume: /\b(?:licensed physical therapist|physical therapist licen[cs]e|pt licen[cs]e)\b/i },
  { kind: "ot", posting: /\b(?:licensed occupational therapist|occupational therapist licen[cs]e|ot licen[cs]e)\b/i, resume: /\b(?:licensed occupational therapist|occupational therapist licen[cs]e)\b/i },
  { kind: "cpa", posting: /\bcpa\b(?:[^.\n]{0,40}\b(?:required|licen[cs]e|certif))|\b(?:active|current|licensed) cpa\b|\bcertified public accountant\b/i, resume: /\bcpa\b|\bcertified public accountant\b/i },
  { kind: "teacher", posting: /\b(?:teaching|teacher|educator'?s?|multiple subject|single subject) (?:certificat(?:e|ion)|credential|licen[cs]e)\b|\bstate (?:teaching )?certification\b/i, resume: /\b(?:teaching|teacher|educator'?s?|multiple subject|single subject)\b[^.\n]{0,30}\b(?:certificat(?:e|ion)|credential|licen[cs]e)\b/i },
  { kind: "electrician", posting: /\b(?:journeyman|master|licen[cs]ed|a-grade)\s+electrician\b|\belectrical (?:contractor |mechanic )?licen[cs]e\b|\belectrician'?s? licen[cs]e\b/i, resume: /\belectrical (?:mechanic )?licen[cs]e\b|\b(?:journeyman|master|a-grade|licen[cs]ed)\s+electrician\b/i },
  { kind: "cdl", posting: /\bcdl\b|\bcommercial driver'?s? licen[cs]e\b/i, resume: /\bcdl\b|\bcommercial driver'?s? licen[cs]e\b/i },
  { kind: "pe", posting: /\bprofessional engineer(?:ing)?\b[^.\n]{0,20}\b(?:licen[cs]e|\(pe\)|registration)|\bpe licen[cs]e\b|\blicensed pe\b/i, resume: /\bprofessional engineer\b[^.\n]{0,20}\blicen[cs]e|\bpe licen[cs]e\b|\blicensed pe\b|,\s*p\.?e\.?\b/i },
  { kind: "epa608", posting: /\bepa (?:section )?608\b/i, resume: /\bepa (?:section )?608\b/i },
];

const CLEARANCE_LEVEL = /\b(top secret\/sci|ts\/sci|top secret|secret|public trust)\b/i;

function jurisdictionsNear(text: string, i: number, len: number): string[] {
  const span = text.slice(Math.max(0, i - 60), Math.min(text.length, i + len + 60));
  const out = statesIn(span);
  for (const [w, c] of Object.entries(AU_STATES)) if (new RegExp(`\\b${w}\\b`, "i").test(span) && !out.includes(c)) out.push(c);
  return out;
}

/** Licences a résumé states, each with its jurisdiction when the line names one. */
export function readResumeLicences(text: string): Licence[] {
  const head = text.slice(0, 4000);
  const out: Licence[] = [];
  for (const r of RULES) {
    const m = r.resume.exec(head);
    if (!m) continue;
    if (r.kind === "lpn" && out.some((l) => l.kind === "rn")) continue;
    const line = sentenceAt(head, m.index, m[0].length);
    const near = jurisdictionsNear(head, m.index, m[0].length);
    let jurisdiction: string | null = near[0] ?? null;
    if (r.kind === "nmc") jurisdiction = "NMC";
    if (r.kind === "ahpra") jurisdiction = "AHPRA";
    const grade = r.kind === "cdl" ? (/\bclass\s*([abc])\b/i.exec(line)?.[1]?.toUpperCase() ?? null) : null;
    out.push({ kind: r.kind, jurisdiction, compact: r.kind === "rn" && COMPACT.test(line), grade, basis: line });
  }
  const c = /\b(?:active|current|hold(?:s|ing)?|held)\b[^.\n]{0,30}(top secret\/sci|ts\/sci|top secret|secret)\s+(?:security\s+)?clearance\b|\b(ts\/sci|top secret|secret)\s+clearance\s*\((?:active|current)\)/i.exec(head);
  if (c) out.push({ kind: "clearance", jurisdiction: null, compact: false, grade: (c[1] ?? c[2]).toLowerCase(), basis: sentenceAt(head, c.index, c[0].length) });
  return out;
}

/** The licence a posting asks for, if its text names one this file knows. */
export function readPostingLicence(description: string): PostingLicence | null {
  for (const r of RULES) {
    if (r.kind === "clearance") continue;
    const m = r.posting.exec(description);
    if (!m) continue;
    const quote = sentenceAt(description, m.index, m[0].length);
    const grade = r.kind === "cdl" ? (/\bclass\s*([abc])\b/i.exec(quote)?.[1]?.toUpperCase() ?? null) : null;
    return {
      kind: r.kind,
      jurisdictions: jurisdictionsNear(description, m.index, m[0].length),
      pending: PENDING.test(quote),
      compactAccepted: COMPACT.test(quote),
      grade,
      quote,
    };
  }
  return null;
}

export type LicenceVerdict = "met" | "met_pending" | "transfer_pending" | "transfer" | "missing" | "not_asked";

/**
 * The reader's licences against the posting's ask. A licence of the right kind
 * in the right place (or a compact licence in a compact state, or no place
 * named) is met; the right kind elsewhere is a transfer, pending when the
 * posting accepts eligibility; none at all is missing (pending when the
 * posting accepts eligibility, so a new graduate awaiting a licence reads as
 * met-pending, never as met).
 */
export function licenceVerdict(have: readonly Licence[], need: PostingLicence | null, rowStates: readonly string[] = []): LicenceVerdict {
  if (!need) return "not_asked";
  const mine = have.filter((l) => l.kind === need.kind);
  const where = need.jurisdictions.length ? need.jurisdictions : rowStates;
  if (mine.length === 0) return need.pending ? "met_pending" : "missing";
  if (need.kind === "cdl" && need.grade && mine.every((l) => l.grade && l.grade > need.grade!)) return need.pending ? "transfer_pending" : "transfer";
  if (where.length === 0) return "met";
  for (const l of mine) {
    if (!l.jurisdiction) return "met";
    if (where.includes(l.jurisdiction)) return "met";
    if (need.kind === "rn" && l.compact && NLC_STATES.has(l.jurisdiction) && where.every((s) => NLC_STATES.has(s))) return "met";
  }
  return need.pending ? "transfer_pending" : "transfer";
}
