/** WHO ANSWERS EACH QUESTION WHEN A PERSON ... docs/shared-notes.md#s46 */
import {
  CLAUSE_BREAK,
  ENDED,
  FORMAT_NOTE,
  OWN_STATUS,
  PERSON_CIRCUMSTANCE,
  anyAsk,
  asksAboutWorkDone,
  askedText,
  classifyQuestion,
  cleanQuestionLabel,
  madeOfWork,
  mentionsLaterFact,
  mentionsPersonFact,
  topicOf,
  workClause,
  type QuestionClass,
} from "./application-questions.ts";
import { automationFor } from "./apply-automation.ts";
import { computeFit } from "./fit-score.ts";
import { textOf } from "./form-readers-extra.ts";
import { sponsorshipSense, type SponsorshipSense } from "./submission-packet.ts";
import { countriesIn } from "./work-countries.ts";

export type AnsweredBy = "you" | "your_details" | "your_documents" | "draft_from_your_cv";

export type SelfApplyInput = {
  label: string;
  required: boolean;
  type: string;
  options?: string[];
  hint?: string;
  /** The employer screens applications on this answer (never which answer passes). */
  screens?: true;
};

export type SelfApplyQuestion = SelfApplyInput & {
  n: number;
  answeredBy: AnsweredBy;
  /** For a factual question: what it asks about, so the AI can say why it is asking. */
  topic?: string;
  /** ISO-2 codes the label names, for a work-right or location question. */
  aboutCountry?: string[];
  sponsorshipSense?: SponsorshipSense;
  /** A demographic question: answering it is the person's choice, and so is declining. */
  voluntary?: true;
  /** The person answers, and their CV may help them do it. */
  cvMayHelp?: true;
};

/** The motivation questions the AI may draft. docs/shared-notes.md#s47 */
export const MOTIVATION =
  /^\s*(?:(?:briefly|in\s+your\s+own\s+words)[,:]?\s+)?(?:please\s+)?(?:(?:tell|share\s+with)\s+us\s+)?(?:(?:in\s+(?:a\s+few|one|two|three|\d+(?:\s*[-–]\s*\d+)?)\s+(?:words|sentences)[,:]?\s+)?(?:(?:describe|explain)\s+)?(?:why\s+(?:do\s+you\s+want|would\s+you\s+like|are\s+you\s+(?:interested|applying|excited)|have\s+you\s+(?:applied|chosen\s+to\s+apply)|did\s+you\s+(?:apply|choose\s+to\s+apply)|you\s+(?:are\s+(?:interested|applying|excited)|want\s+to|would\s+like\s+to|applied)|(?:do\s+you\s+think\s+)?you['’]?d\s+be\s+(?:a\s+)?(?:great|good|strong|ideal|right)\s+(?:fit|candidate|match)|should\s+we\s+hire\s+you)\b|why\s+(?:this\s+(?:role|position|job|company|team|opportunity)|us|our\s+company)\b|what\s+(?:interests|excites|attracts|draws|motivates|appeals\s+to)\s+you\b|what\s+(?:makes|made)\s+you\s+(?:want\s+to\s+apply|interested|apply|(?:a\s+)?(?:great|good|strong|ideal|right)\s+(?:fit|candidate|match))\b|what\s+(?:would|will|can)\s+you\s+bring\b)|(?:cover\s*-?\s*letter|motivation(?:al)?\s+(?:letter|statement)|letter\s+of\s+motivation)\b|(?:is\s+there\s+)?anything\s+else\s+(?:(?:you['’]?d|you\s+would)\s+like\s+(?:us\s+)?to\s+(?:know|share|tell|add)|we\s+should\s+know|you\s+want\s+us\s+to\s+know)\b|additional\s+information\b)/i;
/** "Why <Employer>?", the whole label. */
const WHY_NAME = /^\s*[Ww]hy\s+([A-Z][^\s?]*(?:\s+[A-Z][^\s?]*){0,3})\s*\?\s*$/;

/** The opening a motivation question ... docs/shared-notes.md#s48 */
const MOTIVATION_OPENING = /^\s*(?:(?:briefly|in\s+your\s+own\s+words)[,:]?\s+)?(?:please\s+)?(?:(?:tell|share\s+with)\s+us\s+)?(?:in\s+(?:a\s+few|one|two|three|\d+(?:\s*[-–]\s*\d+)?)\s+(?:words|sentences)[,:]?\s+)?why\s+are\s+you\s+(?:interested|applying|excited)\b/i;

const FREE_TEXT_TYPE = /^(?:input_text|textarea|text|string|longtext|long_text|short_text|shorttext|paragraph|free_?text|multi_?line(?:_text)?|text_?area|text_?field|essay|open|open_question|long_?answer|short_?answer)$/i;

/** True for a control a person types prose into, judged by its type and the absence of options. */
export function isFreeText(type: string, options?: string[]): boolean {
  if (options && options.length) return false;
  return FREE_TEXT_TYPE.test(String(type ?? "").trim());
}

export { topicOf };

/** Sentences, each keeping its own closing mark, so a later one can be read for a question mark. */
const SENTENCES = /(?<=[?!;])\s+|(?<=[a-z]{3}\.)\s+(?=[A-Z])/;

/** Leaving a job is the person's history, whatever question it sits in. */
const LEAVING = /\b(?:leav\w*|left)\b/i;

/** A follow-up about the work just told: "How did you resolve it?", "What was the outcome?". */
const FOLLOW_UP = /^\s*(?:and\s+)?(?:how|what)\s+(?:did|was|were)\b(?:\s+you\s+[a-z][\w-]*)?/i;

/** True when every sentence after the ... docs/shared-notes.md#s49 */
export function laterSentencesArePlain(label: string, motive = false): boolean {
  return label.split(SENTENCES).slice(1).every((s) => {
    if (classifyQuestion(s, "textarea") !== "draftable") return false;
    // A second motivation question in a ... docs/shared-notes.md#s50
    if (motive && MOTIVATION.test(s)) return isMotivationQuestion(s);
    if (s.includes("?") && !FOLLOW_UP.test(s)) return false;
    const clauses = s.replace(FOLLOW_UP, " ").split(CLAUSE_BREAK).filter((_, i) => i % 2 === 0);
    // "(Limit: two paragraphs.)" is a format instruction.
    if (FORMAT.test(s) && !mentionsLaterFact(s)) return clauses.every((c) => !/\byour\b(?!\s+(?:answer|response)s?\b)/i.test(c) || madeOfWork(c));
    return clauses.every((c) => workClause(c, motive));
  });
}

/** A length or format instruction ("Max 300 words.", "Please keep responses under 150 words.", "3-4 sentences"). */
const FORMAT = new RegExp(FORMAT_NOTE.source + /|\b(?:minutes?\s+to\s+complete|under\s+\d+)/.source, "i");

/** THE EMPLOYER'S HINT IS PART OF THE ... docs/shared-notes.md#s51 */
export function hintIsPlain(hint: string | undefined): boolean {
  const h = cleanQuestionLabel(hint ?? "");
  if (!h) return true;
  if (LEAVING.test(h) || ENDED.test(h) || mentionsLaterFact(h) || PERSON_CIRCUMSTANCE.test(h) || anyAsk(h)) return false;
  return h.split(SENTENCES).every((s) => {
    const cls = classifyQuestion(s, "textarea");
    if ((cls !== "draftable" && cls !== "file") || topicOf(s) !== "other" || OWN_STATUS.test(s)) return false;
    const clauses = s.replace(FOLLOW_UP, " ").split(CLAUSE_BREAK).filter((_, i) => i % 2 === 0);
    // A format instruction or a document offer is plain unless it names something of the person's ("your ...").
    if (cls === "file" || FORMAT.test(s)) return clauses.every((c) => !/\byour\b(?!\s+(?:answer|response)s?\b)/i.test(c) || madeOfWork(c));
    if (s.includes("?") && !FOLLOW_UP.test(s)) return false;
    return clauses.every((c) => workClause(c, true));
  });
}

/** True when the label is one of the ... docs/shared-notes.md#s52 */
export function isMotivationQuestion(label: string): boolean {
  const name = WHY_NAME.exec(label);
  const opening = MOTIVATION.exec(label) ?? (name && !/^(?:remote|now|here|hybrid|on-?site|relocat)/i.test(name[1]) ? name : null);
  if (!opening || LEAVING.test(label) || mentionsPersonFact(label)) return false;
  if (!laterSentencesArePlain(label, true)) return false;
  const [firstSentence] = label.slice(opening.index + opening[0].length).split(SENTENCES);
  const clauses = (firstSentence ?? "").split(CLAUSE_BREAK);
  // A run-on second ask in the motivation's own words ("Why do you want to work here how many hours you can work").
  if (PERSON_CIRCUMSTANCE.test(clauses[0] ?? "") || /\b(?:whether|when|where|how\s+(?:soon|much|many|long))\b/i.test(clauses[0] ?? "")) return false;
  for (let i = 2; i < clauses.length; i += 2) if (!workClause(clauses[i] ?? "", true)) return false;
  return !OWN_STATUS.test(label.replace(MOTIVATION_OPENING, " "));
}

const COVER_LETTER = /cover\s*-?\s*letter|motivation(?:al)?\s+letter|letter\s+of\s+motivation/i;

/** A control the person picks from: never an upload slot, whatever its label names. */
const CHOICE_TYPE = /select|radio|check|bool|yes_?no|multiple|choice|dropdown|^multi$/i;

/** The other controls a vendor names that take no file. */
const OTHER_NON_FILE_TYPE = /^(?:date|number|numeric|integer|email|phone|tel|url|link|salary|currency|range)$/i;

/** A control the vendor named and that ... docs/shared-notes.md#s53 */
export function isKnownNonFileControl(type: string, options?: string[]): boolean {
  const t = String(type ?? "").trim();
  if (!t || /file|upload|attach|document|infobox/i.test(t)) return false;
  return (!!options && options.length > 0) || FREE_TEXT_TYPE.test(t) || CHOICE_TYPE.test(t) || OTHER_NON_FILE_TYPE.test(t);
}

/** A yes/no answer: a boolean control, or exactly two options that are yes and no in the form's language. */
const YES_NO_WORD = /^(?:yes|no|y|n|true|false|s[ií]|oui|non|ja|nein|nee|sim|n[aã]o|oo|hindi|haan|nahin)$/i;
function isYesNoControl(type: string, options?: string[]): boolean {
  if (/bool|yes_?no/i.test(String(type ?? ""))) return true;
  return !!options && options.length === 2 && options.every((o) => YES_NO_WORD.test(o.trim().replace(/[.!]$/, "")));
}

/** A consent in words the classifier's ... docs/shared-notes.md#s54 */
const OPT_IN =
  /(\b(?:permission|consent|agree|okay|ok)\b[\s\S]{0,60}\b(?:text|sms|whats\s?app)\b|\b(?:text|sms)\s+(?:message|messages|messaging|updates|notifications|alerts)\b|\b(?:can|may)\s+we\s+(?:text|sms)\b|\btext\s+you\b|\bsms\b|\b(?:receive|send\s+you|get)\b[\s\S]{0,30}\b(?:marketing|newsletters?|promotional)\b|\bopt[\s-]?in\b|\bnewsletters?\b|\btalent\s+(?:pool|community|network)\b|\b(?:contact|consider|keep)\w*\s+(?:you|me)\b[\s\S]{0,40}\bfuture\s+(?:job\s+)?(?:opportunit\w*|vacanc\w*|openings?|positions?|roles?)\b)/i;
const KEEPS_DATA = /(bewaren|speichern|aufbewahren|conserver|guardar|retain|store|keep)[\s\S]{0,80}\b(gegevens|daten|donn[ée]es|datos|data|details|information)\b|\b(gegevens|daten|donn[ée]es|datos|data)\b[\s\S]{0,80}(bewaren|speichern|aufbewahren|conserver|guardar|retain|store|keep)/i;
const AGREES = /(akkoord|einverstanden|d['’]accord|de\s+acuerdo|\bagree|\bconsent|\baccept|\bpermission|toestemming|zustimm|autoriz)/i;

/** "How did you hear about us", in the board's languages: never the CV's to help with. */
const HOW_HEARD =
  /(\b(?:how|where)\s+(?:did|have)\s+you\s+(?:first\s+)?(?:hear|find|learn|come\s+across|discover|see)\b|\bhow\s+did\s+you\s+(?:get\s+to\s+know|become\s+aware)\b|\bsource\s+of\s+(?:application|referral)\b|c[oó]mo\s+(?:te\s+enteraste|se\s+enter[oó]|nos\s+conociste|supiste)|\bwie\s+(?:sind|haben)\s+(?:sie|du)\b[\s\S]{0,40}(?:aufmerksam|erfahren)|\bhoe\s+(?:ben|heb)\s+(?:je|jij|u)\b[\s\S]{0,40}(?:terecht|gehoord|gevonden|gekomen)|\bcomment\s+avez[\s-]vous\b[\s\S]{0,40}(?:connu|entendu|trouv)|\bcomo\s+(?:soube|conheceu|ficou\s+sabendo)\b|як\s+ви\s+дізнал)/i;

/** The topic and help a consent, opt-in or "how did you hear" question carries, whatever the rest of the rule said. */
function settleConsent(q: SelfApplyQuestion, cls: QuestionClass, asked: string): SelfApplyQuestion {
  if (q.answeredBy === "your_details" || q.answeredBy === "your_documents") return q;
  const consent = cls === "consent" || OPT_IN.test(asked) || (KEEPS_DATA.test(asked) && AGREES.test(asked));
  if (consent) {
    const { cvMayHelp: _c, topic: _t, ...rest } = q;
    return { ...rest, answeredBy: "you", topic: "consent" };
  }
  if (HOW_HEARD.test(asked)) {
    const { cvMayHelp: _c, ...rest } = q;
    return { ...rest, answeredBy: "you", topic: q.topic && q.topic !== "other" ? q.topic : "how_you_found_us" };
  }
  return q;
}

/** One question, with who answers it and why. */
export function whoAnswers(q: SelfApplyInput, n: number): SelfApplyQuestion {
  const asked = askedText(q.label);
  const cls: QuestionClass = classifyQuestion(q.label, String(q.type ?? ""));
  return settleConsent(markedFor(q, n, cls, asked), cls, asked);
}

function markedFor(q: SelfApplyInput, n: number, cls: QuestionClass, asked: string): SelfApplyQuestion {
  const label = cleanQuestionLabel(q.label);
  // A line break inside the label is a ... docs/shared-notes.md#s55
  const type = String(q.type ?? "");
  const base: SelfApplyQuestion = {
    n, label, required: !!q.required, type,
    ...(q.options && q.options.length ? { options: q.options } : {}),
    ...(q.hint ? { hint: q.hint } : {}),
    ...(q.screens ? { screens: true as const } : {}),
    answeredBy: "you",
  };
  const free = isFreeText(type, q.options);
  const sense = sponsorshipSense(label);
  const countries = countriesIn(label);
  // The employer's hint is read with the ... docs/shared-notes.md#s56
  const plainHint = hintIsPlain(q.hint);
  const hintTopic = plainHint ? "other" : topicOf(cleanQuestionLabel(q.hint ?? ""));
  const hintExtras = hintTopic !== "other" ? { topic: hintTopic } : {};
  const factualExtras = {
    topic: topicOf(label),
    ...(countries.length ? { aboutCountry: countries } : {}),
    ...(sense ? { sponsorshipSense: sense } : {}),
  };
  switch (cls) {
    case "identity":
      // "Do you understand you are required to ... docs/shared-notes.md#s57
      if (isYesNoControl(type, q.options)) return { ...base, answeredBy: "you" };
      return { ...base, answeredBy: "your_details" };
    case "file":
      // A text box that wants the cover letter ... docs/shared-notes.md#s58
      if (free && COVER_LETTER.test(label) && isMotivationQuestion(asked)) return { ...base, answeredBy: "you", cvMayHelp: true, ...hintExtras };
      // A label naming the résumé on a control ... docs/shared-notes.md#s59
      if ((q.options && q.options.length) || CHOICE_TYPE.test(type)) return { ...base, answeredBy: "you" };
      // A text box or other named control whose ... docs/shared-notes.md#s60
      if (isKnownNonFileControl(type, q.options)) return free ? { ...base, answeredBy: "you", cvMayHelp: true, ...hintExtras } : { ...base, answeredBy: "you" };
      return { ...base, answeredBy: "your_documents" };
    case "demographic":
      return { ...base, answeredBy: "you", voluntary: true };
    case "consent":
      return { ...base, answeredBy: "you" };
    case "factual":
      return { ...base, answeredBy: "you", ...factualExtras };
    case "draftable":
    default: {
      if (free && plainHint && !LEAVING.test(asked) && ((asksAboutWorkDone(asked) && laterSentencesArePlain(asked)) || isMotivationQuestion(asked))) {
        return { ...base, answeredBy: "draft_from_your_cv" };
      }
      // A sponsorship or country word in a ... docs/shared-notes.md#s61
      return { ...base, answeredBy: "you", cvMayHelp: true, ...hintExtras, ...(sense ? { sponsorshipSense: sense } : {}), ...(countries.length ? { aboutCountry: countries } : {}) };
    }
  }
}

/** Every question of a form, numbered from 1 in the form's own order. */
export function whoAnswersEach(questions: readonly SelfApplyInput[]): SelfApplyQuestion[] {
  return questions.map((q, i) => whoAnswers(q, i + 1));
}

/** What a person meets when they open the employer's form. */
export type SelfApplyRoute = {
  submitter: "you";
  /** true: a sign-in or an account with the employer comes before the form. null: not measured. */
  needsEmployerAccount: boolean | null;
  /** true where the form loads a CAPTCHA script, seen or not (the field /v1 has always served). null: not measured. */
  captchaLikely: boolean | null;
  /** What the person sees of it: a challenge ... docs/shared-notes.md#s62 */
  captcha: "visible" | "invisible" | "none" | null;
  attachFilesYourself: true;
};

type Measured = { account?: boolean; captcha?: SelfApplyRoute["captcha"] };

/** Where the vendor table ... docs/shared-notes.md#s63 */
const MEASURED_ROUTES = new Map<string, Measured>([
  ["icims", { account: true }],
  ["ukg", { account: true, captcha: null }],
  ["paylocity", { account: false, captcha: "none" }],
  ["greenhouse", { captcha: "invisible" }],
]);

/** The route a person meets on this hiring ... docs/shared-notes.md#s64 */
export function selfApplyRoute(vendor: string): SelfApplyRoute {
  const v = String(vendor ?? "").trim().toLowerCase();
  const fact = automationFor(v);
  const m = MEASURED_ROUTES.get(v);
  const unmeasured = fact.tier === "unknown";
  const needsEmployerAccount = m?.account !== undefined
    ? m.account
    : fact.tier === "signup" || /\baccount\s+needed\b/i.test(fact.note) ? true : unmeasured ? null : false;
  const captcha: SelfApplyRoute["captcha"] = m && "captcha" in m
    ? m.captcha ?? null
    : fact.tier === "click" ? "visible" : unmeasured ? null : "none";
  return {
    submitter: "you",
    needsEmployerAccount,
    captchaLikely: captcha === null ? null : captcha !== "none",
    captcha,
    attachFilesYourself: true,
  };
}

/** A sentence of equal-opportunity, legal ... docs/shared-notes.md#s65 */
export const BOILERPLATE_SENTENCE = new RegExp(
  [
    // Equal opportunity and the law.
    /equal (?:employment )?opportunit|\beeo\b|\beoe\b/,
    /without regard (?:to|for)|regardless of (?:their )?(?:race|age|gender|sex|religion|colou?r|national|disabilit|sexual|background)/,
    /protected (?:veteran|class|characteristic|status|group)|national origin|sexual orientation|gender identity/,
    /\brace\b.{0,40}\bcolou?r\b|affirmative action|fair chance|arrest (?:and|or) conviction|conviction records|\bordinance\b/,
    /reasonable accommodation|(?:applicants|candidates|individuals) with disabilit|\be-?verify\b|pay transparency/,
    /veterans? (?:are )?(?:encouraged|welcome)|military spouses/,
    // Not "diverse team" or "inclusive culture" (a manager's duties say both), and not "dei" (Italian "of the").
    /diversity,? equity|inclusive employer/,
    /committed to (?:building |creating |fostering |a )*(?:diverse|inclusive|diversity|inclusion)/,
    // Benefits lists.
    /\b401\s?\(?k\)?|paid time off|(?:medical|health)\s*(?:,|\/|&|and)\s*(?:dental|vision)|(?:dental|vision)\s*(?:,|\/|&|and)\s*(?:dental|vision|medical|health)/,
    /(?:dental|vision|life|disability) insurance|(?:health savings|flexible spending) accounts?|tuition (?:reimbursement|assistance)/,
    /employee assistance program|parental leave|\bbenefits (?:include|package|offered)|what we offer\b/,
    // Privacy, fraud and agency notices.
    /privacy (?:notice|policy|statement)|personal (?:data|information) (?:will be|is|are) (?:processed|collected|used)/,
    /recruitment (?:fraud|scam)|never ask (?:you )?(?:for )?(?:payment|money|bank)|unsolicited (?:resumes|applications|cvs)/,
    /(?:third[- ]party|external) (?:recruiters|agencies)|recruitment agencies|agency fees/,
  ].map((r) => r.source).join("|"),
  "i",
);

/** Where a description's sentences end: punctuation, a line, a block tag or a bullet. */
export const SENTENCE_BREAK = /(?<=[.!?])\s+|\n+|<\/?(?:p|li|ul|ol|div|br|h[1-6]|tr|td)\b[^>]*>|\s*[•·▪●]\s*/i;

/** A run longer than this is never dropped whole: an unpunctuated description must not vanish for one EEO clause. */
const BOILERPLATE_SENTENCE_MAX = 1000;

/** The posting's text with its boilerplate sentences taken out. */
export function withoutBoilerplate(text: string): string {
  return String(text ?? "")
    .split(SENTENCE_BREAK)
    .filter((s) => s.length > BOILERPLATE_SENTENCE_MAX || !BOILERPLATE_SENTENCE.test(s))
    .join("\n");
}

/** The skills and subject terms a posting ... docs/shared-notes.md#s66 */
export function postingTermsOf(text: string, max = 30): string[] {
  const kept = withoutBoilerplate(text);
  if (!kept.trim()) return [];
  return computeFit(kept, "", max).missing;
}
