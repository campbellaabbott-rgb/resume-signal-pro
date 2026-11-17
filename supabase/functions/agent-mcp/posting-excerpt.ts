/**
 * THE POSTING'S OWN LINES ON APPLYING AND REQUIREMENTS (connect W4,
 * APPLY-1107-06), for apply_myself when no form was read. Kept beside the
 * connector, not in _shared, because only agent-mcp reads it and every byte in
 * _shared counts toward job-board's deploy upload (src/test/the-upload-tally-
 * counts-every-shared-file-and-every-comment.test.ts).
 *
 * Below postingExcerptOf, which is unchanged: the excerpt get_jobs returns
 * for "requirements" (MCP upgrade 3, W1), and the reorder that puts a
 * description's boilerplate after everything else before a cut.
 */
import { BOILERPLATE_SENTENCE, SENTENCE_BREAK } from "../_shared/self-apply.ts";
import { textOf } from "../_shared/form-readers-extra.ts";

/** A line about how to apply. */
const HOW_TO_APPLY_LINE = new RegExp(
  [
    String.raw`\bhow to apply\b`, String.raw`\bto apply\b`, String.raw`\bapply (?:by|via|online|through|with|before)\b`,
    String.raw`\bplease (?:submit|send|include|attach|upload|apply|provide)\b`, String.raw`\bcover letter\b`, String.raw`\bportfolio\b`,
    String.raw`\bwriting sample\b`, String.raw`\breferences\b`, String.raw`\bdeadline\b`, String.raw`\bclosing date\b`,
  ].join("|"),
  "i",
);

/** A line stating something the applicant must have or be. */
const REQUIREMENT_LINE = new RegExp(
  [
    String.raw`\brequire(?:d|s|ments?)\b`, String.raw`\bmust (?:have|be|hold|possess)\b`, String.raw`\bqualifications?\b`, String.raw`\bminimum\b`,
    String.raw`\bessential\b`, String.raw`\beligib`, String.raw`\bauthori[sz]ed to work\b`, String.raw`\bright to work\b`, String.raw`\bsponsor`,
    String.raw`\bvisa\b`, String.raw`\blicen[cs]e[ds]?\b`, String.raw`\bcertifi(?:ed|cation)\b`, String.raw`\bdegree\b`,
    String.raw`\byears? of (?:\w+ )?experience\b`, String.raw`\bbackground check\b`, String.raw`\bdrug (?:test|screen)`, String.raw`\bclearance\b`,
  ].join("|"),
  "i",
);

/** A heading that opens a requirements or how-to-apply section. */
const SECTION_HEAD = /^\W*(?:(?:key |minimum |basic |preferred |essential |required )?(?:requirements|qualifications|skills(?: and experience)?)|what (?:you(?:'ll| will)? (?:need|bring)|we(?:'re| are) looking for)|about you|who you are|must[- ]haves?|how to apply|to apply|application process)\b/i;

/** A short line ending in a colon, or a known heading: where one section stops and the next starts. */
const ANY_HEAD = /^.{0,60}:$|^\W*(?:responsibilities|duties|what you(?:'ll| will) do|about (?:us|the (?:role|company|team|job))|who we are|company description|job description|additional information|what we offer|our offer|benefits|perks|why (?:join|work)|the role|your role|compensation|salary|location)\b.{0,30}$/i;

const EXCERPT_LINE_MAX = 240;

/**
 * Up to eight of the posting's own lines on how to apply and what it requires
 * (at most three on applying), in the posting's order, boilerplate excluded:
 * the employer's words, so the AI can tell the person what is asked without a
 * second call when no form was read.
 */
export function postingExcerptOf(text: string): string[] {
  const segs = String(text ?? "").split(SENTENCE_BREAK).map((x) => textOf(x)).filter(Boolean);
  const apply: number[] = [];
  const req: number[] = [];
  let inSection = false;
  segs.forEach((seg, i) => {
    if (seg.length <= 70 && SECTION_HEAD.test(seg)) { inSection = true; return; }
    if (seg.length <= 70 && ANY_HEAD.test(seg)) { inSection = false; return; }
    if (seg.length < 20 || BOILERPLATE_SENTENCE.test(seg)) return;
    if (HOW_TO_APPLY_LINE.test(seg)) { if (apply.length < 3) apply.push(i); return; }
    if ((inSection || REQUIREMENT_LINE.test(seg)) && req.length < 6) req.push(i);
  });
  const seen = new Set<string>();
  return [...apply, ...req].sort((a, b) => a - b)
    .map((i) => (segs[i].length > EXCERPT_LINE_MAX ? `${segs[i].slice(0, EXCERPT_LINE_MAX - 1).trimEnd()}…` : segs[i]))
    .filter((x) => (seen.has(x) ? false : (seen.add(x), true)))
    .slice(0, 8);
}

// ── The requirements excerpt (MCP upgrade 3, W1: U3-08, critique F4, F5, M10) ──

/** Work-rights lines a requirements excerpt always keeps, when the posting has them. */
export const WORK_RIGHTS_SLOTS = 2;
/** Other requirement lines kept beside them: six lines or fewer in all. */
export const OTHER_REQUIREMENT_SLOTS = 4;
/** Lines addressed to an AI that are quoted; any more are counted. */
export const ADDRESSED_TO_AI_MAX = 3;
/** Set on a posting written mostly in another language. */
export const EXCERPT_NOT_ENGLISH = "not English: lines in other languages are not picked out";

/**
 * One kind of work-rights wording. `not` is tested on the 40 characters
 * either side of each hit, `notSentence` on the sentence holding it: a hit
 * either one matches does not count. Tier 1 says who may work or whether a
 * visa is sponsored; tier 2 says where the person must be (relocation, "must
 * be based in", "remote within"). Tier 1 lines take the reserved slots first.
 */
type WorkRightsTerm = { re: RegExp; not?: RegExp; notSentence?: RegExp; tier: 1 | 2 };

const WORK_RIGHTS_TERMS: WorkRightsTerm[] = [
  {
    // A visa, not the card scheme ("memberships of Visa and Mastercard",
    // "Citi, Wells Fargo, J.P. Morgan, and Visa"), nor a visa an assistant
    // arranges ("itineraries, visas, and expense reports").
    re: /\bvisas?\b/gi,
    not: /\b(?:mastercard|amex|american express|discover|paypal|citi|wells fargo|morgan|barclays|hsbc|card schemes?|card networks?|financial institutions?)\b|\bvisa (?:cards?|network|inc|direct|checkout|payments?|merchants?)\b|\b(?:itinerar\w*|passports?|travel arrangements?|bookings?|expense reports?)\b/i,
    tier: 1,
  },
  {
    // Sponsoring a person, not an event, a stakeholder or a benefit plan
    // ("employer-sponsored benefits"; "without employer sponsorship" is one).
    re: /\bsponsor(?:s|ed|ing|ships?)?\b/gi,
    not: /\b(?:event|conference|exhibit\w*|partner(?:ship)?|corporate|title|brand|media|sports?|athletic|executive|club|team|program(?:me)?|project|clinical|study|trial|plan|pension|church|industry|charity|community|education(?:al)?|tuition|training|course|qualification|professional|membership|assistance|learning)[- ]sponsor(?:s|ed|ing|ships?)?\b|\b(?:employer|company|government|state|privately)[- ]sponsored\b|\bsponsor(?:s|ed|ing|ships?)? (?:opportunit\w*|decks?|packages?|sales|activations?|assets|fulfil\w*|deliverables|benefits|levels?|tiers?|events?|conferences?|content|posts?|relationships?|agreements?|logos?|booths?)\b|\b(?:vendors?|partners?|exhibitors?|speakers?|attendees|stakeholders?),? (?:and |or |& )?sponsors?\b/i,
    tier: 1,
  },
  {
    // Authorised, eligible or permitted to work; a work permit or visa; H-1B.
    re: /\b(?:authori[sz]ed|authori[sz]ation|eligible|eligibility|entitled|permitted|permission|legally (?:able|allowed|authori[sz]ed|eligible|entitled|permitted)) to (?:live and )?work\b|\bwork[- ]authori[sz](?:ed|ation)\b|\bright to (?:live and )?work\b|\bwork (?:permits?|visas?)\b|\bH-?1B\b|\bgreen card\b/gi,
    not: /\bto work (?:from home|remotely|flexibl\w*|hybrid|part[- ]time|overtime|shifts?)\b/i,
    // "We comply with all applicable laws ... work authorization ... requirements."
    notSentence: /\bcompl(?:y|ies|iance) with\b[^.]*\b(?:laws?|regulations?)\b/i,
    tier: 1,
  },
  {
    // A security clearance, not a customs or stock one.
    re: /\b(?:security|government|federal|secret|top[- ]secret|TS\/SCI|SC|DV|NV[12]|baseline|public trust|national security|BPSS|NPPV\d?|DoD|DOE|interim)\s+(?:\w+\s+)?clearances?\b|\bclearances?\s+(?:level|is required|required|eligib\w*)\b|\b(?:active|current|obtain|hold|maintain|gain)\s+(?:an?\s+|the\s+)?(?:[\w/-]+\s+){0,3}clearances?\b|\bTS\/SCI\b/gi,
    not: /\b(?:customs|sales?|price|stock|tax|inventory|ground|height|bridge)\s+clearances?\b/i,
    tier: 1,
  },
  { re: /\bcitizenship (?:is )?required\b|\bmust (?:be|hold) (?:an? )?(?:[\w.]+ ){0,2}citizen(?:ship)?\b|\bcitizens? only\b/gi, tier: 1 },
  {
    // The person's relocation, not a moving firm's trade or moved machinery.
    re: /\breloca(?:tion|te|ting)\b/gi,
    not: /\brelocation (?:and logistics )?services\b|\brelocation (?:experts?|compan(?:y|ies)|industry|specialists?|consultants?)\b|\b(?:machinery|equipment|household|corporate|office|commercial|military)\s+relocations?\b|\breloca\w* (?:of )?(?:the )?(?:machinery|equipment|furniture|offices?|households?|goods|assets|servers?)\b|\binstallation and relocation\b|\b(?:machinery|equipment|tools)\b[^.]{0,20}\brelocation\b/i,
    tier: 2,
  },
  { re: /\bmust (?:be )?(?:based|located|living|resident|residing|reside|live)\s+(?:in|within)\b/gi, tier: 2 },
  { re: /\bremote\b[^.;:]{0,30}?\b(?:within|only (?:in|from|within))\b/gi, tier: 2 },
];

/** A heading that only names the subject ("Work Visa Sponsorship"): the line under it says what the posting says. */
const WORK_RIGHTS_HEADING = /^\W*(?:(?:work|visas?|sponsorship|immigration|authori[sz]ation|permits?|rights?|to|security|clearance|relocation|eligibility|citizenship|and|&|\/)\s*)+\W*$/i;

/**
 * Where the excerpt's sentences end: as SENTENCE_BREAK, except after
 * initials ("U.S.", "J.P.", "e.g.") and a few abbreviations, so "authorized
 * to work in the U.S. without sponsorship" stays one sentence.
 */
const EXCERPT_SENTENCE_BREAK = /(?<=[.!?])(?<!\b[A-Z]\.(?:[A-Z]\.)+|\b(?:etc|vs|approx|incl|Inc|Ltd|Co|St|Dr|Mr|Mrs|Ms|Jr|Sr)\.)\s+|\n+|<\/?(?:p|li|ul|ol|div|br|h[1-6]|tr|td)\b[^>]*>|\s*[•·▪●]\s*/i;

/** The sentence of `line` that holds position `at`. */
function sentenceAt(line: string, at: number): string {
  const start = Math.max(line.lastIndexOf(". ", at), line.lastIndexOf("! ", at), line.lastIndexOf("? ", at));
  const ends = [". ", "! ", "? "].map((x) => line.indexOf(x, at)).filter((x) => x >= 0);
  return line.slice(start < 0 ? 0 : start + 2, ends.length ? Math.min(...ends) + 1 : line.length);
}

/** The best tier of work-rights wording in a line, and where its first such hit starts. */
function workRightsOf(line: string): { tier: 1 | 2; at: number; len: number } | null {
  let best: { tier: 1 | 2; at: number; len: number } | null = null;
  for (const t of WORK_RIGHTS_TERMS) {
    if (best && best.tier <= t.tier) continue;
    t.re.lastIndex = 0;
    for (let m = t.re.exec(line); m; m = t.re.exec(line)) {
      const near = line.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
      if (t.not?.test(near)) continue;
      if (t.notSentence?.test(sentenceAt(line, m.index))) continue;
      best = { tier: t.tier, at: m.index, len: m[0].length };
      break;
    }
  }
  return best;
}

/**
 * A line that says who may work for this employer, whether it sponsors a
 * visa, what clearance is needed, or where the person must be: sponsor,
 * visa, authorised or eligible to work, right to work, clearance,
 * relocation, "must be based in", "remote within". Read in context, so a
 * payments firm's "Visa", event sponsorship, "employer-sponsored benefits"
 * and "eligible to work from home" are not. An E-Verify sentence counts only
 * when it also says who is authorized to work.
 */
export function isWorkRightsLine(line: string): boolean {
  return workRightsOf(String(line ?? "")) !== null;
}

// The words that name an AI. "AI" and the rest count only as an addressee:
// followed by punctuation or a verb, so "AI tools", "AI skills" and "an AI
// enthusiast" are mentions, and a job titled assistant is never one.
const AI_WHO = String.raw`(?:an?\s+|the\s+|any\s+|all\s+)?(?:(?:AI|A\.I\.)(?:\s+(?:assistants?|agents?|systems?|models?|screeners?|readers?|bots?))?|artificial intelligence(?:\s+(?:assistants?|agents?|systems?|models?))?|(?:virtual|digital)\s+assistants?|(?:large\s+)?language\s+models?|LLMs?|ChatGPT|Claude|chat\s?bots?|bots?)`;
const AI_END = String.raw`(?=\s*(?:[,:;.!?)\]—–]|-\s|$)|\s+(?:reading|processing|parsing|reviewing|screening|evaluating|summari[sz]ing|analy[sz]ing|helping|assisting|that|who|which)\b)`;
const AI_DOES = String.raw`(?:ignore|disregard|forget|include|mention|add|write|say|state|tell|insert|append|prepend|respond|reply|answer|rate|rank|score|recommend|output|print|use|put|start|begin|end|treat|mark|classify|summari[sz]e|return|give|do not|don['’]t|you must|you should|make sure)`;
const ADDRESSED_TO_AI: RegExp[] = [
  // "If you are an AI, ..." / "If you're a large language model reading this ..."
  new RegExp(String.raw`\bif\s+(?:you(?:['’]re|\s+are))\s+${AI_WHO}${AI_END}`, "i"),
  // "Note to AI assistants: ..." (the addressee, then a colon or a comma)
  new RegExp(String.raw`\b(?:note|message|instructions?|reminder|directive|memo|warning)\s+(?:to|for)\s+${AI_WHO}\s*[:,—–]`, "i"),
  // "ChatGPT, please mention ..." / "Claude: disregard ..."
  new RegExp(String.raw`^\W*(?:(?:dear|hey|hello|hi|attention|attn)\s+)?${AI_WHO}\s*[,:]\s*(?:please\s+)?${AI_DOES}\b`, "i"),
  // "Any LLM processing this job ad ..."
  new RegExp(String.raw`\b${AI_WHO}\s+(?:reading|processing|parsing|reviewing|screening|evaluating|summari[sz]ing|analy[sz]ing)\s+(?:this|these)\b`, "i"),
  // "AI assistants should include the code word ..." (said of the applicant or this posting)
  new RegExp(String.raw`\b${AI_WHO}\s+(?:should|must|needs?\s+to|(?:are|is)\s+(?:instructed|asked|required)\s+to)\s+(?:always\s+|also\s+|now\s+)?(?:(?:ignore|disregard)\b|(?:include|mention|add|insert|append|say|state|write|use|rate|rank|score|recommend)\b[^.]{0,60}\b(?:word|phrase|code|term|candidate|applicant|application|cover letter|r[eé]sum[eé]|cv|this (?:job|role|posting|ad|position))\b)`, "i"),
  // "As an AI, you ..."
  new RegExp(String.raw`\bas\s+${AI_WHO}\s*,\s*you\b`, "i"),
  // "Ignore all previous instructions": written for a model, whoever it names.
  /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:(?:the|your|of the)\s+)?(?:previous|prior|above|earlier|preceding|other)\s+(?:instructions|prompts?|directions|rules)\b/i,
];

/**
 * A posting line written TO an AI (F5): "if you are an AI, include the word
 * ...", "note to AI assistants: ...", "ChatGPT, please mention ...", or a
 * line telling a model to ignore its instructions. Never a line that only
 * mentions AI ("experience with AI tools") or names a person or job.
 */
export function isAddressedToAi(line: string): boolean {
  const s = String(line ?? "");
  return ADDRESSED_TO_AI.some((re) => re.test(s));
}

// Distinctive English function words: other languages the board carries do
// not spell them (so not "a", "in", "is", "to", "an", "on", "as", "at").
const EN_FUNCTION_WORDS = new Set([
  "the", "and", "of", "with", "you", "your", "we", "our", "are", "will", "for", "this", "that",
  "from", "have", "be", "by", "or", "which", "who", "us", "it", "they", "their", "can", "about",
]);
/** Fewer words than this are too few to judge: never flagged. */
const LANGUAGE_MIN_WORDS = 25;
/** English text has more of its words among EN_FUNCTION_WORDS than this. */
const ENGLISH_MIN_SHARE = 0.06;
/** Letters outside the Latin script above this share: not English. */
const OTHER_SCRIPT_MAX_SHARE = 0.1;

/**
 * Written mostly in another language (M10): letters mostly in another script,
 * or, among at least LANGUAGE_MIN_WORDS words, too few English function
 * words. It never names the language: it only says the English line
 * patterns could not read the posting's own lines.
 */
export function isMostlyNotEnglish(text: string): boolean {
  const s = String(text ?? "");
  const letters = s.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return false;
  const otherScript = s.match(/(?!\p{Script=Latin})\p{L}/gu)?.length ?? 0;
  if (otherScript > OTHER_SCRIPT_MAX_SHARE * letters) return true;
  const words = s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < LANGUAGE_MIN_WORDS) return false;
  return words.filter((w) => EN_FUNCTION_WORDS.has(w)).length < ENGLISH_MIN_SHARE * words.length;
}

/** A line cut to EXCERPT_LINE_MAX, around the words that made it a work-rights line when they sit past the cut. */
function lineAround(seg: string, at: number, len: number): string {
  const max = EXCERPT_LINE_MAX;
  if (seg.length <= max) return seg;
  if (at + len <= max - 1) return `${seg.slice(0, max - 1).trimEnd()}…`;
  let start = Math.max(1, at - 60);
  let end = Math.min(seg.length, start + max - 2);
  if (end === seg.length) start = seg.length - (max - 1);
  const sp = seg.indexOf(" ", start);
  if (sp >= 0 && sp < at) start = sp + 1;
  if (end < seg.length) {
    const e = seg.lastIndexOf(" ", end);
    if (e > at + len) end = e;
  }
  return `…${seg.slice(start, end).trim()}${end < seg.length ? "…" : ""}`;
}

/** Where a description's lines end (its sentences end at SENTENCE_BREAK). */
const LINE_BREAK = /\n+|<\/?(?:p|li|ul|ol|div|br|h[1-6]|tr|td)\b[^>]*>/i;

export interface RequirementsExcerpt {
  /** The posting's own lines, in its order: up to WORK_RIGHTS_SLOTS on work rights, kept first, and up to OTHER_REQUIREMENT_SLOTS other requirement lines. */
  postingExcerpt: string[];
  /** Lines the posting addresses to an AI, word for word. Present only when there are any. */
  addressedToAi?: string[];
  /** How many more such lines there were. Present only when more than ADDRESSED_TO_AI_MAX. */
  addressedToAiNotShown?: number;
  /** EXCERPT_NOT_ENGLISH, present only when the posting is written mostly in another language. */
  excerptLanguage?: typeof EXCERPT_NOT_ENGLISH;
}

/**
 * The requirements excerpt get_jobs returns instead of a description
 * (U3-08). Work-rights lines are tested FIRST, before the boilerplate
 * pattern that counts E-Verify and equal-opportunity wording (F4), and up to
 * WORK_RIGHTS_SLOTS of them are always kept, tier 1 first; then up to
 * OTHER_REQUIREMENT_SLOTS other requirement lines (and any further
 * work-rights lines) in the posting's order. How-to-apply lines are not
 * requirements here. Each line is at most EXCERPT_LINE_MAX characters, so
 * ten postings come to 14,400 or fewer.
 *
 * A line addressed to an AI goes to addressedToAi word for word and never
 * into postingExcerpt (F5). A posting written mostly in another language
 * carries excerptLanguage (M10): its lines are not picked out, so an empty
 * excerpt there says nothing about the posting.
 */
export function requirementsExcerptOf(text: string): RequirementsExcerpt {
  const raw = String(text ?? "");
  const toAi: string[] = [];
  const segs: string[] = [];
  for (const rawLine of raw.split(LINE_BREAK)) {
    const line = textOf(rawLine);
    if (!line) continue;
    if (isAddressedToAi(line)) { toAi.push(line); continue; }
    for (const part of rawLine.split(EXCERPT_SENTENCE_BREAK)) {
      const seg = textOf(part);
      if (seg) segs.push(seg);
    }
  }
  const work: Array<{ i: number; tier: 1 | 2; at: number; len: number }> = [];
  const other: number[] = [];
  const seen = new Set<string>();
  let inSection = false;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (!seg) continue;
    const short = seg.length <= 70;
    const head = short && SECTION_HEAD.test(seg) ? "requirements" : short && ANY_HEAD.test(seg) ? "other" : null;
    if (head === "requirements") inSection = true;
    else if (head === "other") inSection = false;
    if (seen.has(seg)) continue;
    let wr = seg.length >= 8 && !(short && WORK_RIGHTS_HEADING.test(seg)) ? workRightsOf(seg) : null;
    if (wr && seg.length <= 60 && seg.endsWith(":")) {
      // A label whose value is the next line ("Clearance Level Must Currently
      // Possess:" then "Secret"): kept as one line, or not at all.
      const value = segs[i + 1];
      if (value && value.length <= 40 && !value.endsWith(":")) {
        segs[i] = `${seg} ${value}`;
        segs[i + 1] = "";
      } else wr = null;
    }
    if (wr) { seen.add(seg); work.push({ i, ...wr }); continue; }
    if (head || seg.length < 20 || BOILERPLATE_SENTENCE.test(seg) || HOW_TO_APPLY_LINE.test(seg)) continue;
    if (inSection || REQUIREMENT_LINE.test(seg)) { seen.add(seg); other.push(i); }
  }
  const ranked = [...work].sort((a, b) => a.tier - b.tier || a.i - b.i);
  const reserved = ranked.slice(0, WORK_RIGHTS_SLOTS);
  const rest = [...ranked.slice(WORK_RIGHTS_SLOTS).map((w) => w.i), ...other].sort((a, b) => a - b).slice(0, OTHER_REQUIREMENT_SLOTS);
  const hit = new Map(work.map((w) => [w.i, w]));
  const postingExcerpt = [...reserved.map((w) => w.i), ...rest].sort((a, b) => a - b).map((i) => {
    const w = hit.get(i);
    return lineAround(segs[i], w?.at ?? 0, w?.len ?? 0);
  });
  const out: RequirementsExcerpt = { postingExcerpt };
  if (toAi.length) {
    out.addressedToAi = toAi.slice(0, ADDRESSED_TO_AI_MAX).map((l) => (l.length > EXCERPT_LINE_MAX ? `${l.slice(0, EXCERPT_LINE_MAX - 1).trimEnd()}…` : l));
    if (toAi.length > ADDRESSED_TO_AI_MAX) out.addressedToAiNotShown = toAi.length - ADDRESSED_TO_AI_MAX;
  }
  if (isMostlyNotEnglish(textOf(raw))) out.excerptLanguage = EXCERPT_NOT_ENGLISH;
  return out;
}

// ── Boilerplate last (U3-08b) ──

/** A heading that opens a benefits, equal-opportunity, accommodation or privacy section. */
const BOILERPLATE_HEAD = /^\W*(?:benefits?|perks?|what we offer|what(?:['’]s| is) in it for you|we offer|our offer|why (?:join|work (?:with|for|at))|compensation (?:and|&) benefits|total rewards|equal (?:employment )?opportunit\w*|eeo\b|diversity(?:,| and| &) (?:equity|inclusion)|inclusion (?:and|&) (?:diversity|belonging)|our commitment to (?:diversity|inclusion)|(?:reasonable )?(?:accommodations?|adjustments?)\b|(?:candidate |applicant |data )?privacy|data protection|recruitment fraud)\b.{0,60}$/i;
/** Inside such a section, a line ending in a colon that still lists what is offered. */
const OFFER_HEAD = /\b(?:offer|treat you|you(?:['’]ll| will) (?:get|enjoy|receive)|in it for you|perks?|benefits?|rewards?|health|wellness|well-?being|time off|holidays?|leave|pension|retirement|financial|family|insurance|learning|development)\b/i;
/** Equal-opportunity wording the shared boilerplate pattern leaves to the sentence ("committed to fostering an intentional, inclusive, and diverse culture"). */
const DIVERSITY_STATEMENT = /\b(?:committed to|commitment to|dedicated to)\b[^.]{0,60}\b(?:inclusive|diverse|diversity|inclusion|belonging)\b/i;
/** What a requirement says: a paragraph holding one is never moved. */
const MUST_HAVE = /\bmust (?:have|hold|possess)\b|\b(?<!as )required\b(?! by)|\brequirements?\b|\byears? of (?:\w+ )?experience\b|\bdegree\b|\blicen[cs]e[ds]?\b|\bcertifi(?:ed|cations?)\b|\bexperience (?:with|in)\b/i;

/** A line that never moves: work rights, or where the work is done. */
function staysInPlace(line: string): boolean {
  return isWorkRightsLine(line) || /\bremote(?:ly)?\b|\bhybrid\b/i.test(line);
}

/** An unheaded paragraph of equal-opportunity, accommodation, privacy or benefits text. */
function isBoilerplateParagraph(line: string): boolean {
  const sentences = line.split(SENTENCE_BREAK).filter(Boolean);
  return sentences.some((s) => BOILERPLATE_SENTENCE.test(s) || DIVERSITY_STATEMENT.test(s)) && !sentences.some((s) => MUST_HAVE.test(s));
}

/**
 * The description with its equal-opportunity, accommodation, privacy and
 * benefits paragraphs moved after everything else, in their own order, so a
 * cut spends its characters on the job (U3-08b). A paragraph is a line; a
 * section under a benefits or equal-opportunity heading moves whole, up to
 * the next heading of another kind. A line with work-rights or remote words
 * never moves, nor does a paragraph that states a requirement. Nothing is
 * deleted: the result has the same lines and the same length. Run it after
 * any requirements-first reorder, so the reorder cannot bring the
 * boilerplate forward again. Text with no line breaks is returned as it is.
 */
export function boilerplateLast(text: string): string {
  const s = String(text ?? "");
  const lines = s.split("\n");
  if (lines.length < 2) return s;
  const moved: boolean[] = [];
  let section = false;
  let sinceHead = 0;
  let prev = false;
  let prevText = "";
  for (const raw of lines) {
    const line = textOf(raw);
    if (!line) { moved.push(prev); continue; }
    let flag: boolean;
    if (/^[a-z]/.test(line) && prevText && !/[.!?:]$/.test(prevText)) {
      // A sentence carried over from the line before: it goes where that line goes.
      flag = prev && !staysInPlace(line);
    } else {
      const short = line.length <= 70;
      const boilerplateHead = short && !/\.$/.test(line) && BOILERPLATE_HEAD.test(line) && !staysInPlace(line);
      if (boilerplateHead) {
        section = true;
        sinceHead = 0;
      } else if (section && short && (SECTION_HEAD.test(line) || (ANY_HEAD.test(line) && !(sinceHead === 0 || OFFER_HEAD.test(line))))) {
        section = false;
      } else if (section) {
        sinceHead++;
      }
      flag = !staysInPlace(line) && (boilerplateHead || section || isBoilerplateParagraph(line));
    }
    moved.push(flag);
    prev = flag;
    prevText = line;
  }
  if (!moved.some(Boolean)) return s;
  return [...lines.filter((_, i) => !moved[i]), ...lines.filter((_, i) => moved[i])].join("\n");
}
