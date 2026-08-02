// Classifier for job-application form questions — the honesty core of the apply
// agent. It decides which questions an AI may draft an answer for (substantive,
// resume-grounded free-text) and which it must NEVER touch:
//   - identity/contact  → autofilled from the user's profile, not written by AI
//   - file uploads       → the resume/cover-letter attachments
//   - demographic/EEO    → the candidate's own to disclose; auto-answering is
//                          inappropriate and can be non-compliant
//   - factual/status     → work authorization, sponsorship, salary, start date,
//                          relocation — NOT derivable from a resume, so an AI would
//                          have to guess. We refuse; the user fills these in.
// Only "draftable" questions get a grounded AI draft. Pure + unit-tested.

export type QuestionClass = "identity" | "file" | "demographic" | "factual" | "draftable";

export interface AppQuestion {
  label: string;
  required?: boolean;
  /** normalized field type, e.g. "input_text" | "textarea" | "input_file" */
  type?: string;
}

// `contact number` and `telephone` added 2026-08-01: the first real Pinpoint
// forms we ever harvested ask for a "Secondary contact number", which matched
// neither `phone` nor `mobile` and fell through to draftable — i.e. an LLM
// would have been asked to write a phone number.
// UNAMBIGUOUS identity tokens: nobody writes an essay question containing
// "linkedin" or "postal code". These mean identity wherever they appear.
const IDENTITY = /\b(first\s*name|last\s*name|full\s*name|legal\s*name|preferred\s*name|middle\s*name|e-?mail|phone|mobile|telephone|contact\s*number|street|zip|postal|linkedin|github|portfolio|personal\s*website|twitter|url)\b/i;

// ORDINARY ENGLISH NOUNS that are identity only when the label is a FIELD, not
// prose. Found by the real-label corpus on 2026-08-01: "Describe a time you
// coordinated with government stakeholders, donors, or country partners" was
// classified identity — because of the word "country" — which would have
// autofilled the candidate's profile country into an essay box.
//
// A pre-existing bug, invisible until the agent saw real questions: the four
// generic questions it used to see contained none of these words in prose.
const IDENTITY_IF_FIELD = /\b(city|state|province|country|address|website|location)\b/i;
// "your city" is the candidate's own; "country partners" is not.
const OWN_ATTRIBUTE = /\byour\s+(?:current\s+|home\s+|primary\s+)?(?:city|state|province|country|address|website|location)\b/i;
const FILE = /\b(resume|résumé|cv|cover\s*letter|upload|attach|transcript|portfolio\s*file)\b/i;
// Protected/voluntary self-ID — never auto-answered. Stems match suffixed forms
// ("disability", "pronouns") so no trailing word-boundary can slip them through.
const DEMOGRAPHIC = /\b(gender|sex|race|ethnic\w*|hispanic|latin[ox]|veteran|disab\w*|sexual\s+orientation|pronoun\w*|date\s+of\s+birth|marital|religio\w*|nationalit\w*|citizenship|national\s+origin)/i;
// Facts a resume can't establish — must come from the candidate.
//
// EVERYTHING FROM `earliest` ONWARD WAS ADDED 2026-08-01, from the first 118
// REAL question labels ever harvested off Breezy and Pinpoint. Until that day
// the agent only ever saw four generic questions on those vendors, so every
// pattern here had been written against phrasings we imagined. Employers do not
// use them. Each addition below is a live label that fell through to
// `draftable`, which means a language model would have written the answer:
//
//   "If offered the position, what is the earliest date you could start?"
//        — `start date` and `when can you start` both miss it. The candidate
//          has ALREADY answered this in their profile; drafting it is not just
//          a guess, it is ignoring a stated fact.
//   "Are you over 18 years old?"        — `at least 18` misses "over 18".
//   "What days are you available to work?"
//   "Are you Willing to travel to different centers?"
//   "Are you willing to work in another location? If yes, where?"
//   "Do you have a current Washington medical assistant ... license"
//   "If a current skipper referred you, please list their name."
//        — a THIRD PARTY's name. A model asked to fill this invents a person.
//   "Do you have a close relative who is a current MCA/MCC staff ...?"
//   "How did you learn about this job opportunity?"
//   "If yes, kindly specify what kind of legal authorization you possess"
//
// Deliberately NOT added: `certification`, `experience`, `knowledge`,
// `proficiency`. "Do you have EMR experience?", "Do you have Medical
// Terminology knowledge?" and "Please describe your proficiency in French" are
// answerable FROM THE RESUME and must stay draftable — widening this far enough
// to catch them would block half the corpus and quietly turn the agent off.
const FACTUAL = /(authoriz\w*\s*to\s*work|work\s*authoriz|legal\s*authoriz\w*|require\s*(?:visa\s*)?sponsor|sponsorship|need\s*sponsor|work\s*(?:visa|permit)|(?:need|require|hold|have)\s*(?:a\s*)?(?:valid\s*)?(?:work\s*|employment\s*)?visa|eligible\s*to\s*work|right\s*to\s*work|employment\s*eligib\w*|salary|compensation|desired\s*pay|expected\s*(?:pay|salary|compensation)|pay\s*expectation|notice\s*period|start\s*date|available\s*to\s*start|when\s*can\s*you\s*start|willing\s*to\s*relocate|relocat|able\s*to\s*commute|are\s*you\s*(?:at\s*least\s*)?18|legally\s*(?:eligible|authorized)|do\s*you\s*now\s*or\s*in\s*the\s*future|earliest\s*(?:possible\s*)?(?:date|start)|date\s*you\s*(?:could|can|would)\s*start|over\s*18|18\s*(?:years\s*)?(?:or\s*(?:older|above)|of\s*age)|legal\s*working\s*age|days\s*(?:are\s*)?you\s*available|what\s*days\s*[\w\s]{0,24}available|willing\s*to\s*travel|willing\s*to\s*work\s*(?:in|at)\s*(?:another|a\s*different)|licen[sc]e|security\s*clearance|dbs\s*check|background\s*check|criminal\s*(?:record|convict\w*)|referred\s*you|who\s*referred|close\s*relative|family\s*member|related\s*to\s*(?:any\s*)?(?:current\s*)?(?:employee|staff)|how\s*did\s*you\s*(?:hear|learn)\s*about)/i;

export function classifyQuestion(label: string, fieldType?: string): QuestionClass {
  const l = label ?? "";
  const t = (fieldType ?? "").toLowerCase();
  // Protected self-ID wins over everything — even if phrased oddly.
  if (DEMOGRAPHIC.test(l)) return "demographic";
  if (t.includes("file") || FILE.test(l)) return "file";
  // Structured contact/location field types (Ashby: Email/Phone/Location) are
  // identity regardless of label — "Where do you plan on working from?" has no
  // identity keyword but is the candidate's own to fill.
  if (t === "email" || t === "phone" || t === "location" || t.includes("email") || t.includes("phone")) return "identity";
  // A label that IS just "name" (live Ashby forms use a bare "Name" field) is
  // identity — but only as the whole label, so "Name a project you're proud
  // of" stays draftable.
  const bare = l.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (bare === "name" || bare === "your name" || bare === "confirm your name") return "identity";
  // A SHORT label ENDING in "name" is a name box: "Candidate name", "Applicant
  // name", "Employee name". Found while wiring the packet builder — these fell
  // through to `draftable`, which meant the agent would try to GENERATE A
  // SENTENCE where a person's name belongs.
  //
  // Both halves of the rule earn their place. "Ends with" keeps the deliberate
  // guard above intact, because "Name a project you're proud of" uses name as a
  // verb and ends on "of". The three-word cap stops a long prompt that happens
  // to trail off on the word name from being autofilled.
  if (/\bname$/.test(bare) && bare.split(" ").length <= 3) return "identity";
  if (IDENTITY.test(l)) return "identity";
  // Geographic/contact words that are also ordinary English. Identity only when
  // the label reads as a FIELD — a short one ("Country", "Current City, State")
  // or one that says whose it is ("What is your country of residence?"). In a
  // long sentence with no "your", the word is doing prose work and the question
  // belongs to the drafter.
  //
  // FACTUAL is checked FIRST so that "Are you willing to work in another
  // location?" stays a refusal rather than being autofilled with a home city.
  if (FACTUAL.test(l)) return "factual";
  if (IDENTITY_IF_FIELD.test(l) && (bare.split(" ").length <= 4 || OWN_ATTRIBUTE.test(l))) {
    return "identity";
  }
  return "draftable";
}

/** The subset an AI should draft grounded answers for (everything else stays with
 *  the candidate or is autofilled). */
export function selectDraftable(questions: readonly AppQuestion[]): AppQuestion[] {
  return questions.filter((q) => classifyQuestion(q.label ?? "", q.type) === "draftable");
}

// ── Role-aware drafting guidance ────────────────────────────────────────────
// What "a good answer" emphasizes differs by field: a hiring manager reading a
// nurse's screening answers wants licenses and patient populations; one reading
// a sales answer wants quota facts. Every line is fenced with "as stated in the
// resume" — this steers emphasis, it never licenses invention. Keys are the
// board's category slugs (categories.ts); unknown/absent categories get "".

const ROLE_EMPHASIS: Record<string, string> = {
  engineering: "Name the candidate's actual languages, systems, and scale from the resume; a linked portfolio/GitHub only if the resume lists one.",
  data_ai: "Emphasize the datasets, models, tools, and measurable analyses the resume actually describes.",
  design: "Lead with the portfolio if the resume lists one, and the shipped work/design process it actually describes.",
  product: "Emphasize shipped products, user/business outcomes, and cross-functional scope exactly as the resume states them.",
  marketing: "Emphasize channels, campaigns, and measurable results exactly as stated in the resume.",
  sales: "Quota, attainment, deal size, and book-of-business figures ONLY as literally stated in the resume — these are the most-verified claims in hiring.",
  customer: "Emphasize volumes handled, tools/CRMs used, satisfaction outcomes, and languages spoken as the resume states them.",
  finance: "Credentials (CPA, CFA…) exactly as held; emphasize regulatory scope, reporting cadence, and systems from the resume.",
  legal: "Bar admissions and jurisdictions exactly as held; practice areas and matter types from the resume only.",
  people_hr: "Emphasize programs run, headcount supported, and HRIS tooling as the resume states them.",
  operations: "Emphasize process scope, volumes, safety/quality certifications, and systems exactly as the resume states them.",
  healthcare: "Licenses, certifications, and patient populations EXACTLY as held per the resume — never imply a credential it doesn't state.",
  science: "Techniques, instruments, and publications exactly as the resume lists them.",
  education: "Teaching certifications, grade levels, and subjects exactly as held per the resume.",
  hospitality_retail: "Emphasize service volumes, POS/systems, and scheduling/leadership scope as the resume states them.",
  security: "Clearances and security certifications EXACTLY as held per the resume — never imply a clearance it doesn't state.",
  admin: "Emphasize the tools, calendars/logistics scope, and stakeholders supported as the resume states them.",
};

/**
 * Optional prompt block steering answer emphasis by role category and
 * seniority. Returns "" when there's nothing useful to add.
 */
export function roleGuidance(category?: string | null, experienceBand?: string | null): string {
  const parts: string[] = [];
  const emphasis = ROLE_EMPHASIS[(category ?? "").toLowerCase()];
  if (emphasis) parts.push(emphasis);
  const band = (experienceBand ?? "").toLowerCase();
  if (band === "entry") {
    parts.push("Entry-level posting: internships, coursework, and transferable experience the resume actually lists are fair material — never inflate them into professional experience.");
  } else if (band === "senior" || band === "lead" || band === "executive") {
    parts.push("Senior posting: emphasize ownership, scope, and leadership the resume actually states — team sizes and budgets only if written there.");
  }
  return parts.length ? `ROLE FOCUS: ${parts.join(" ")}` : "";
}
