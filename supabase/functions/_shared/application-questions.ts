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
//   - consent/attestation → "I have read and agree to the privacy notice". A
//                          statement about something THE CANDIDATE DID. See below.
// Only "draftable" questions get a grounded AI draft. Pure + unit-tested.

export type QuestionClass =
  | "identity" | "file" | "demographic" | "factual" | "consent" | "draftable";

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

/**
 * CONSENT AND ATTESTATION — the class this classifier was missing, found by
 * measurement on 2026-08-03 and not by reading the code.
 *
 * Two matchers, at deliberately different priorities. Read CONSENT_DOC and
 * CONSENT_ATTEST below for why the split exists; this is the shared reason
 * either of them does.
 *
 * A first sample of 40 live Recruitee forms turned up labels like
 * "Please confirm you've read our Privacy Notice" and its Dutch equivalent.
 * Both classified `draftable`, and apply-agent selected what to send the model
 * with `label.length > 24`, so both were going to it. A language model was
 * about to WRITE AN ATTESTATION THAT THE CANDIDATE HAD READ A DOCUMENT — an
 * assertion about an act a specific person did or did not perform, which no
 * amount of résumé grounding can support, on a question whose entire purpose
 * is that a human followed the link inside it.
 *
 * That is the same principle as `demographic`, and sharper: a declined EEO
 * question is a non-answer, while a drafted consent is a false statement made
 * in the candidate's name to a company they want to work for.
 *
 * THE PATTERNS BELOW ARE FITTED TO A REAL CORPUS, and that is not incidental.
 * The first version of this class was written against a label reconstructed
 * from a TRUNCATED sample — the real one reads "gelezen en begrijp" (read and
 * understand), not "gelezen en ga akkoord" (read and agree), and the deployed
 * regex missed it live while its unit test passed against the invention. So
 * every branch here is now anchored to one of 5,537 questions harvested across
 * all six reader vendors, and `consent-corpus.test.ts` replays them.
 */
/**
 * CONSENT_DOC — an attestation tied to a DOCUMENT or a data/communication
 * permission. Checked EARLY, ahead of `file` and `identity`, because the live
 * corpus shows those two classes actively stealing consent questions and
 * answering them with a value:
 *
 *   "By selecting YES, I consent to receive recruiting SMS messages from
 *    Bluestone at the phone number provided above."        -> was `identity`
 *
 * That contains "phone number", so identityValue() would have written the
 * candidate's PHONE NUMBER into a yes/no consent box.
 *
 *   "By typing my legal name below, I acknowledge that the information
 *    contained in this document, my resume, and any other materials submitted
 *    on my behalf are true and correct..."                 -> was `file`
 *
 * That contains "resume", so the packet would have put a résumé URL where a
 * signature attesting to truthfulness belongs.
 *
 * Neither was a hypothetical: both are verbatim labels from the 5,537-question
 * corpus harvested across all six reader vendors on 2026-08-03.
 */
const CONSENT_DOC =
  /(privacy\s*(?:notice|policy|statement|declaration)|privacyverklaring|privacybeleid|datenschutz\w*|pol[ií]tica\s+de\s+privacidad|politique\s+de\s+confidentialit|data\s*protection|\bgdpr\b|\bccpa\b|terms\s*(?:and|&)\s*conditions|terms\s*of\s*(?:use|service)|algemene\s*voorwaarden|arbitration\s*agreement|non-?disclosure|\bnda\b|at[-\s]?will\s*employ\w*|(?:interview|call|meeting)\s*record(?:ing|ed)|notetaker|\bdo\s+you\s+consent\b|\bi\s+(?:hereby\s+)?consent\b|consent\w*\s*(?:to|for)\s*(?:the\s*)?(?:receiv|process|stor|retain|record|use)\w*|(?:process|collect|stor)\w*\s+(?:and\s+\w+\s+)?my\s+personal\s+(?:data|information)|persoonsgegevens|\bi\s+attest\b|\battest\s+that\b|accept\s+(?:all\s+)?(?:the\s+)?terms\b|autoriza\w*\s+que\s+seus\s+dados|\blgpd\b|동의|by\s+(?:typing|signing|submitting|selecting|checking|ticking|initial\w*|entering|clicking)\b[\s\S]{0,70}\b(?:i|you)\s+(?:hereby\s+)?(?:acknowledge|confirm|certify|agree|consent)|(?:i|you)\s+(?:hereby\s+)?(?:agree|confirm|certify|acknowledge)\b[\s\S]{0,90}\b(?:true\s+and\s+(?:correct|complete|accurate)|accurate\s+and\s+complete|truthful))/i;

/**
 * CONSENT_ATTEST — a bare first-person attestation with no document attached.
 *
 * Checked LATE, AFTER `factual`, and that ordering is the whole subtlety.
 * These are all real labels:
 *
 *   "I acknowledge that I am at least 18 years of age"
 *   "I acknowledge that I am authorized to work lawfully in the United States"
 *   "I acknowledge that employees are required to have a valid driver's licence"
 *   "Please acknowledge that you have seen the posted compensation range"
 *
 * Every one is a fact the candidate has ALREADY given as a standing answer.
 * Matching them here would convert four settled profile answers into four
 * blockers and strand packets that were ready to go. `factual` claims them
 * first and fills them from the profile, which is both correct and better.
 *
 * What is left over genuinely has no answer anywhere in our data:
 *
 *   "I confirm to have a valid DNI or NIE (Spanish tax number)"
 *   "I confirm that I'm based in Madrid and able to work from the office 3 days"
 *   "You acknowledge this role will start Monday–Friday 9am–5pm"
 *
 * Those were `draftable`, meaning a model was being asked to assert facts about
 * a person's tax registration and home city. Blocking is the honest outcome.
 */
/**
 * "Please confirm you are comfortable with late-night trade" is a COMMITMENT.
 * "Please confirm whether you have 3+ years with ASC 606" is a RESUME FACT and
 * must keep being drafted. Both are live labels; the difference the pattern
 * turns on is `you are <state>` versus `you have <experience>`.
 */
const CONSENT_ATTEST =
  /(^\s*i\s+(?:hereby\s+)?(?:acknowledge|confirm|certify|agree|consent|understand)\b|^\s*you\s+(?:acknowledge|understand)\b|\byou\s+hereby\s+agree\b|\bdo\s+you\s+agree\s+to\s+this\b|acknowledge?ments?\s*$|\bconsent\s*$|please\s+confirm\b[\s\S]{0,30}\byou\s+are\s+(?:comfortable|available|willing|happy|aware|ok|okay)\b|confirm\s+(?:that\s+)?you\s+(?:have\s+)?read\b|are\s+you\s+comfortable\s+with\s+this\b|you\s+are\s+aware\s+of\s+(?:this|these)\b|confirmas\s+tu\s+disponibilidad|ik\s+heb\b[\s\S]{0,90}\bgelezen\b|ich\s+habe\b[\s\S]{0,90}\bgelesen\b|\bhe\s+le[ií]do\b|j['’]ai\s+lu\b|ga\s+(?:ik\s+)?akkoord|einverstanden|zustimm\w*|acepto\b)/i;
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
const FACTUAL = /(authoriz\w*\s*to\s*work|work\s*authoriz|legal\s*authoriz\w*|require\s*(?:visa\s*)?sponsor|sponsorship|need\s*sponsor|work\s*(?:visa|permit)|(?:need|require|hold|have)\s*(?:a\s*)?(?:valid\s*)?(?:work\s*|employment\s*)?visa|eligible\s*to\s*work|right\s*to\s*work|employment\s*eligib\w*|salary|compensation|desired\s*pay|expected\s*(?:pay|salary|compensation)|pay\s*expectation|notice\s*period|start\s*date|available\s*to\s*start|when\s*can\s*you\s*start|willing\s*to\s*relocate|relocat|able\s*to\s*commute|are\s*you\s*(?:at\s*least\s*)?18|legally\s*(?:eligible|authorized)|do\s*you\s*now\s*or\s*in\s*the\s*future|earliest\s*(?:possible\s*)?(?:date|start)|date\s*you\s*(?:could|can|would)\s*start|over\s*18|18\s*(?:years\s*)?(?:or\s*(?:older|above)|of\s*age)|legal\s*working\s*age|days\s*(?:are\s*)?you\s*available|what\s*days\s*[\w\s]{0,24}available|willing\s*to\s*travel|willing\s*to\s*work\s*(?:in|at)\s*(?:another|a\s*different)|licen[sc]e|security\s*clearance|dbs\s*check|background\s*check|criminal\s*(?:record|convict\w*)|referred\s*you|who\s*referred|close\s*relative|family\s*member|related\s*to\s*(?:any\s*)?(?:current\s*)?(?:employee|staff)|how\s*did\s*you\s*(?:hear|learn)\s*about|how\s*you\s*(?:heard|learned)\s*about|name\s*of\s*the\s*[\w\/]{0,24}\s*(?:staff|contractor|consultant|employee|colleague|relative|referrer)|able\s*to\s*start\s*(?:work|by|on)|start\s*working\s*(?:with|for)\s*us)/i;

/**
 * Real vendor question labels are not always plain text.
 *
 * 2 of 127 live Recruitee labels arrived as HTML — `<p>` wrappers and `<a>`
 * tags around the very link the candidate is being asked to read. Markup in a
 * label breaks it twice: it renders as tag soup wherever the packet is shown,
 * and it defeats the matchers below, which are written against prose. A label
 * whose consent link is spelled `<a href="...">privacy statement</a>` still has
 * to classify as consent.
 *
 * So classification and display both run on text. Entities are decoded AFTER
 * tags are stripped, so an escaped `&lt;p&gt;` in genuine question text cannot
 * become a tag that the strip pass has already gone past.
 */
export function cleanQuestionLabel(raw: unknown): string {
  return String(raw ?? "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * THE HONESTY CLASSES, IN THE LANGUAGES EMPLOYERS ACTUALLY WRITE IN.
 *
 * MEASURED 2026-08-03, and it is the widest hole found all day. Ten labels
 * were tested against the classifier — a Dutch date of birth, a Dutch gender,
 * a Swedish personnummer, a French/German/Spanish date of birth, a Dutch
 * address, a Dutch background check. TEN OF TEN came back `draftable`.
 *
 * `draftable` means a language model is asked to write the answer. So on any
 * non-English form this file's entire purpose inverted: the classifier whose
 * header calls it "the honesty core of the apply agent" would have had an LLM
 * invent a DATE OF BIRTH, a GENDER, or a NATIONAL ID NUMBER. The only thing
 * standing behind it was the grounding gate marking the draft unsupported —
 * a backstop, not a design.
 *
 * This is not hypothetical traffic. The same day's dry runs drove live Dutch
 * (velomedi), Swedish (vardaga, attendosverige), Norwegian (compass-group) and
 * Italian (roccofortehotels) application forms.
 *
 * ADDITIVE ON PURPOSE. Each pattern below is OR'd with its English original
 * rather than merged into it, so every existing English case keeps the exact
 * behaviour its tests pin. A regression here can only come from these lines.
 *
 * Word boundaries are avoided around accented terms — JavaScript's \b is
 * ASCII-only, so `\bkön\b` does not do what it looks like it does.
 */
const DEMOGRAPHIC_INTL =
  /(geboorte\w*|geburts\w*|date\s+de\s+naissance|fecha\s+de\s+nacimiento|data\s+di\s+nascita|data\s+de\s+nascimento|födelsedatum|fødselsdato|syntymäaika|data\s+urodzenia|personnummer|fødselsnummer|\bbsn\b|geslacht|geschlecht|\bsexe\b|\bgénero\b|\bgenere\b|\bsesso\b|\bkön\b|kjønn|sukupuoli|\bpłeć\b|nationaliteit|staatsangehörigkeit|nationalité|nacionalidad|nazionalità|nacionalidade|nationalitet|kansalaisuus|obywatelstwo|burgerlijke\s+staat|familienstand|état\s+civil|estado\s+civil|stato\s+civile|civilstånd|handicap|behinderung|discapacidad|disabilità|deficiência|funktionsnedsättning|funksjonsnedsettelse|etnische|ethnische|origine\s+ethnique|origen\s+étnico)/i;

const IDENTITY_INTL =
  /(adresgegevens|\badres\b|anschrift|\badresse\b|dirección|indirizzo|endereço|\badress\b|osoite|telefoonnummer|telefoon|telefonnummer|téléphone|teléfono|telefono|telefone|puhelin|postcode|postleitzahl|\bplz\b|code\s+postal|código\s+postal|postnummer|postinumero|kod\s+pocztowy|voornaam|achternaam|vorname|nachname|prénom|apellido|cognome|sobrenome|förnamn|efternamn|etunimi|sukunimi)/i;

const FACTUAL_INTL =
  /(salaris\w*|gehalt\w*|prétentions\s+salariales|\bsalaire\b|expectativa\s+salarial|pretensión\s+salarial|\bsueldo\b|stipendio|salário|löne\w*|\blön\b|lønn\w*|palkka\w*|wynagrodzenie|opzegtermijn|kündigungsfrist|préavis|preaviso|preavviso|uppsägningstid|oppsigelsestid|startdatum|beschikbaar\s+vanaf|verfügbar\s+ab|date\s+de\s+début|fecha\s+de\s+inicio|data\s+di\s+inizio|tillträde|werkvergunning|arbeitserlaubnis|aufenthaltstitel|permis\s+de\s+travail|permiso\s+de\s+trabajo|permesso\s+di\s+lavoro|arbetstillstånd|arbeidstillatelse|verklaring\s+omtrent\s+gedrag|\bvog\b|führungszeugnis|casier\s+judiciaire|antecedentes\s+penales|belastningsregister|politiattest|rijbewijs|führerschein|permis\s+de\s+conduire|carnet\s+de\s+conducir|patente\s+di\s+guida|körkort)/i;

const FILE_INTL =
  /(curriculum\s+vitae|lebenslauf|motivatiebrief|motivationsschreiben|anschreiben|lettre\s+de\s+motivation|carta\s+de\s+presentación|lettera\s+di\s+presentazione|carta\s+de\s+apresentação|personlig\w*\s+brev|søknadsbrev|hakemuskirje|bijlage|anhang|pièce\s+jointe|ladda\s+upp|hochladen|télécharger|subir\s+(?:tu|su|el)|caricare|carregar|last\s+opp|lataa\s+tiedosto)/i;

export function classifyQuestion(label: string, fieldType?: string): QuestionClass {
  const l = cleanQuestionLabel(label);
  const t = (fieldType ?? "").toLowerCase();
  // Protected self-ID wins over everything — even if phrased oddly.
  if (DEMOGRAPHIC.test(l) || DEMOGRAPHIC_INTL.test(l)) return "demographic";
  // BEFORE `file` AND `identity`, deliberately — see CONSENT_DOC. Both of those
  // classes were measured stealing real consent questions and answering them
  // with a phone number and a résumé URL respectively.
  if (CONSENT_DOC.test(l)) return "consent";
  if (t.includes("file") || FILE.test(l) || FILE_INTL.test(l)) return "file";
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
  if (IDENTITY.test(l) || IDENTITY_INTL.test(l)) return "identity";
  // Geographic/contact words that are also ordinary English. Identity only when
  // the label reads as a FIELD — a short one ("Country", "Current City, State")
  // or one that says whose it is ("What is your country of residence?"). In a
  // long sentence with no "your", the word is doing prose work and the question
  // belongs to the drafter.
  //
  // FACTUAL is checked FIRST so that "Are you willing to work in another
  // location?" stays a refusal rather than being autofilled with a home city.
  if (FACTUAL.test(l) || FACTUAL_INTL.test(l)) return "factual";
  // AFTER factual, so "I acknowledge that I am at least 18 years of age" keeps
  // the standing answer it already has instead of becoming a blocker.
  if (CONSENT_ATTEST.test(l)) return "consent";
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
