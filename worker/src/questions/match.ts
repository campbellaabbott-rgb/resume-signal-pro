/**
 * Screening-question matching: turn a question a form actually asks into an
 * answer the candidate actually gave.
 *
 * WHY THIS EXISTS. CAPTCHAs were never the binding constraint on unattended
 * applying — employer screening questions were. Measured across 8 live Breezy
 * postings (2026-07-31), 40 required questions sat outside the mapped identity
 * fields, and only 3 of 8 postings could be completed without them.
 *
 * WHAT THE MEASUREMENT SAID, after two corrections to how it was taken.
 *
 * 22 required questions sit outside the fields the Breezy adapter already
 * fills. This module answers 16 and refuses 6:
 *
 *   answered                        refused
 *     4  EEO — by declining           2  unrecognised
 *     3  salary expectation           1  ID/identity number
 *     2  work authorisation           1  nationality
 *     2  sponsorship                  1  EEO with no decline option
 *     1  privacy consent              1  CURRENT salary (see SALARY, below)
 *     1  role location
 *     1  preferred name
 *     1  notice period
 *     1  truthfulness declaration
 *
 * Effect on the thing that matters: 3 of 8 sampled postings were completable
 * before, 7 of 8 after — but see the correction below, because that 7 was
 * partly bought with a false answer.
 *
 * THE COUNTRY CORRECTION, 2026-08-01. `workAuthorized` was a single global
 * boolean answering every authorisation question, so the UK-based test
 * candidate answered "Yes" to "Are you legally authorized to work in the US?".
 * Re-measured with that fixed:
 *
 *     5 of 8   candidate states no countries beyond their own
 *     7 of 8   candidate has explicitly stated US authorisation too
 *
 * The headline number did not really move; what moved is that it is now earned.
 * A UK candidate who has not claimed US work rights gets 5, which is the honest
 * figure for that person.
 *
 * THE WIDER RE-MEASURE, same day. Eight forms is too small to steer coverage
 * by, so 29 were harvested live across Breezy, Pinpoint and Teamtailor —
 * 103 required questions once the adapter's own fields and 18 honeypots are
 * removed. Coverage was chosen from that list rather than from intuition:
 *
 *     13 -> 16 of 29 forms completable, 48 -> 51 questions answered
 *
 * What the measurement changed about the plan, which is the point of taking it:
 *
 *  - The top unrecognised question was "Allow us to process your personal
 *    information." — a consent tickbox the matcher already knew how to answer,
 *    missed only because the pattern demanded the word "data". Five occurrences
 *    for a one-word fix.
 *  - Postcode was the SOLE remaining blocker on 3 forms. Nothing else was.
 *    That is 10 points of completion behind one text input.
 *  - Years-of-experience appeared on 6 forms and was the sole blocker on NONE.
 *    It was top of the intuition list; building it would have shipped nothing,
 *    and building it as a single career total would have been the country bug
 *    over again — see RE_YEARS_EXPERIENCE for why it refuses instead.
 *
 * `coverage.ts` regenerates all of this. The distinction it draws between
 * "blocks a form" and "is the ONLY thing blocking a form" is what makes it
 * useful; the first ranks sympathetically, the second ranks by what ships.
 *
 * THE TWO CORRECTIONS, because both were mine and both flattered the result.
 *
 * The first run reported "Full Name" as 16 of 40 blocking questions — the
 * single largest category, and a field the adapter had been filling all along.
 * It came from a hand-typed list of "already mapped" names that did not match
 * what the adapter actually targets. The same hand-listed-versus-derived
 * mistake as the old AUTO_VENDORS set; `mappedNames` is now derived from each
 * adapter's own map so the two cannot drift.
 *
 * The second was worse. The DOM enumerator attributed a label to any control
 * sharing a container with it, so marex's email, phone and address fields all
 * came back labelled "Full Name". Fed to this matcher, that types the
 * candidate's name into their phone and address boxes — a half-filled
 * application under a real person's name, which is the exact failure the whole
 * apply path exists to prevent. A label shared by several controls now
 * identifies none of them.
 *
 * THE RULE THIS IS BUILT AROUND. An unrecognised question is never guessed.
 * Every path out of here is either an answer the candidate supplied or an
 * explicit refusal; there is no branch that invents a value. A wrong answer to
 * "are you legally authorised to work here" is not a bug, it is a false
 * statement made to an employer under someone's real name.
 *
 * ONE GAP LEFT, stated rather than hidden. A question naming NO country ("Do
 * you have the right to work?") is answered from the boolean. On a posting in
 * the candidate's own country that is right; on a foreign posting it is the old
 * bug in miniature. Closing it means passing the POSTING's country into the
 * matcher — the board holds it — and treating an unqualified question as being
 * about that. Not built yet.
 */
import type { DomQuestion } from "../vendors/enumerate-dom.js";
import { fromLearned, isLearnable, type LearnedAnswers } from "./learned.js";
import { coverage } from "./countries.js";

/** What the candidate has told us. Booleans are TRINARY: null = never stated. */
export type StandingAnswers = {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  address: string;
  /** Stated separately. Never parsed out of `address`. */
  postcode: string;
  linkedin: string;
  website: string;
  coverNote: string;
  salaryExpectation: string;
  earliestStart: string;
  workAuthorized: boolean | null;
  requiresSponsorship: boolean | null;
  willingToRelocate: boolean | null;
  /** Countries the candidate has EXPLICITLY said they may work in, as ISO-ish
   *  codes. `workAuthorized` alone only speaks for `country` — being allowed to
   *  work somewhere is not being allowed to work everywhere, and a form asking
   *  about the US is not asking about where you live. */
  workAuthorizedCountries: readonly string[];
  /** Voluntary self-ID. We never store race or gender, so this only ever
   *  governs whether declining is acceptable — it can never produce a value. */
  shareDemographics: boolean;
  /** Explicit opt-in to accept an employer's privacy/data-processing notice.
   *  Defaults false: agreeing to a legal notice on someone's behalf is an act
   *  they have to authorise, not a default they discover afterwards. */
  consentToProcessing: boolean;
};

export type Resolution =
  /** Type this into a text/textarea control. */
  | { kind: "fill"; category: string; value: string }
  /** Pick this exact option — it is verbatim from the form, never invented. */
  | { kind: "choose"; category: string; option: string }
  /** Tick this checkbox. */
  | { kind: "check"; category: string }
  /** Recognised, but we cannot answer. The packet is refused. */
  | { kind: "unanswerable"; category: string; why: string };

const has = (s: string | null | undefined): s is string => !!s && s.trim().length > 0;

/* ------------------------------------------------------------------ *
 * Option selection.
 *
 * A radio or select answer must be an option the form actually offers.
 * Typing free text into a choice control either does nothing or produces a
 * value the employer's ATS cannot store, and in both cases the submission
 * looks fine from our side. So every choice resolves to verbatim option text,
 * or to nothing at all.
 * ------------------------------------------------------------------ */

/** Placeholder rows ("", "Please select…") are not answers. */
const isPlaceholder = (o: string) =>
  !o.trim() || /^(please\s+)?(select|choose)\b|^-+$|^\s*—\s*$/i.test(o.trim());

const YES_RE = /^\s*(yes|y|true|i\s+(am|do|have|will|confirm|agree)|affirmative)\b/i;
const NO_RE = /^\s*(no|n|false|i\s+(am|do|have|will)\s*not|i\s+don'?t|negative)\b/i;
const DECLINE_RE =
  /prefer\s+not|wish\s+not|don'?t\s+wish|do\s+not\s+wish|decline|choose\s+not|rather\s+not|not\s+to\s+(answer|say|disclose|specify)|no\s+response/i;

const pick = (options: string[], re: RegExp): string | null =>
  options.find((o) => !isPlaceholder(o) && re.test(o)) ?? null;

/**
 * Resolve a yes/no intent against the form's real options.
 *
 * `NO_RE` is tested before `YES_RE` for the "no" case because some option sets
 * spell the negative as "No, I am authorized…" — a string that satisfies a
 * naive yes-match on the embedded "I am".
 */
function chooseBoolean(q: DomQuestion, want: boolean, category: string): Resolution {
  if (q.type === "checkbox" && q.options.length <= 1) {
    // A lone checkbox encodes yes-by-ticking. There is no way to express "no"
    // beyond leaving it alone, and leaving a REQUIRED box unticked is a refusal.
    return want
      ? { kind: "check", category }
      : { kind: "unanswerable", category, why: "a single checkbox cannot express 'no'" };
  }
  const opt = want ? pick(q.options, YES_RE) : pick(q.options, NO_RE);
  if (opt) return { kind: "choose", category, option: opt };
  if (q.type === "text" || q.type === "textarea") {
    return { kind: "fill", category, value: want ? "Yes" : "No" };
  }
  return {
    kind: "unanswerable",
    category,
    why: `no option means ${want ? "yes" : "no"} (offered: ${q.options.filter((o) => !isPlaceholder(o)).slice(0, 5).join(" / ") || "none"})`,
  };
}

/* ------------------------------------------------------------------ *
 * Question patterns, most specific first.
 * ------------------------------------------------------------------ */

/** Identity documents. Never auto-filled, even if we somehow held one. */
const RE_ID_DOC =
  /\b(id|identity|identification|passport|ssn|social\s+security|national\s+insurance|nin|aadhaar|sin)\s*(number|no\.?|#)|\bid\s*number\b|\bnational\s+id\b/i;

const RE_NATIONALITY = /\bnationality\b|\bcitizenship\b|\bcitizen\s+of\b/i;

const RE_FULL_NAME = /^(full|complete)\s+name$|^name$|^your\s+(full\s+)?name$|full\s+name|\b(complete|legal|given)\s+name\b/i;
const RE_PREFERRED_NAME = /preferred\s+(first\s+)?name|name\s+you\s+(go\s+by|prefer)|nickname|known\s+as/i;

/**
 * SALARY. Two different questions that share most of their vocabulary.
 *
 * "What is your current Total Cost To Company per annum" and "What is your
 * salary expectation Total Cost To Company per annum" appeared on the SAME
 * form. We hold an expectation and do not hold a current salary. Answering the
 * first with the second states a stranger's pay to their prospective employer
 * — a fabrication with real consequences in a negotiation.
 *
 * So CURRENT is tested first and always refuses.
 */
const RE_SALARY_CURRENT =
  /\b(current|present|existing|latest|most\s+recent)\b[^?]{0,40}\b(salary|compensation|package|ctc|cost\s+to\s+company|remuneration|pay|earnings|wage)|(salary|compensation|package|ctc|remuneration|earnings)\b[^?]{0,20}\b(current|present)\b/i;
const RE_SALARY_EXPECTED =
  /\b(desired|expected|expectation|expectations|required|requirement|target|minimum|asking|anticipated)\b[^?]{0,40}\b(salary|compensation|package|ctc|cost\s+to\s+company|remuneration|pay|rate|wage)|\b(salary|compensation|package|ctc|remuneration|pay|rate)\b[^?]{0,30}\b(expectation|expectations|requirement|requirements|range|desired|expected)\b/i;

const RE_WORK_AUTH =
  /legally\s+(authori[sz]ed|entitled|eligible|permitted)|(authori[sz]ed|eligible|entitled|permitted)\s+to\s+work|work\s+authori[sz]ation|right\s+to\s+work|permission\s+to\s+work/i;

const RE_SPONSORSHIP =
  /\bsponsor(ship|ing|ed)?\b|immigration\s+(case|petition|process|filing)|(require|need)[^?]{0,30}\b(work\s+)?(visa|permit)\b/i;
/** "…without sponsorship" / "…able to work without needing sponsorship" flips
 *  the sense of the answer. Missing this states the exact opposite of the
 *  truth, on a question employers filter hard on. */
const RE_SPONSOR_INVERTED =
  /without\s+(the\s+need\s+for\s+)?(visa\s+)?sponsor|not\s+require\s+sponsor|no\s+sponsorship\s+(required|needed)|free\s+from\s+(any\s+)?(visa|immigration)/i;

/**
 * CONTACT DETAILS BY LABEL.
 *
 * The adapter maps fields by NAME, which works until a tenant adds its own.
 * One live Breezy form carried 27 required custom fields including "Email
 * Address", "Mobile Number", "Your Complete Legal Name" and "What is your
 * current residential address?" — every one of them an answer already on file,
 * every one of them refused, and together enough to block the whole posting.
 *
 * ORDER IS LORE HERE. Email is tested before address because "Email Address"
 * contains the word address, and filling a street address into an email field
 * produces a submitted application nobody can reply to.
 */
const RE_EMAIL = /\be-?mail\b/i;
const RE_PHONE = /\b(phone|mobile|cell|telephone)\b|contact\s+number|\btel\b/i;
const RE_LINKEDIN = /linkedin/i;
const RE_PORTFOLIO = /portfolio|personal\s+(web)?site|your\s+website|social\s+media\s+profile/i;
const RE_CITY = /^(city|town)$|city\s*\/\s*town|which\s+city|city\s+of\s+residence|^city\b/i;
const RE_POSTCODE = /zip\s*code|zipcode|^zip\b|post(al)?\s*code/i;
const RE_ADDRESS = /\baddress\b/i;
const RE_COVER_LETTER = /cover\s+letter|motivation\s+letter|covering\s+letter/i;

/**
 * DATE OF BIRTH. Refused, not collected, and deliberately so — it is an
 * age-discrimination vector, and unlike a name or a phone number there is no
 * version of this the agent should be volunteering on someone's behalf.
 */
const RE_DOB = /date\s+of\s+birth|when\s+is\s+your\s+birthday|birth\s*day|birth\s*date|\bd\.?o\.?b\.?\b/i;

/**
 * REFEREES. "Character Reference #1/#2/#3" was required on a live form. Even
 * where a candidate has given us a referee's details, publishing another
 * person's name and phone number to an employer is that person's decision, not
 * ours and not the candidate's to delegate to software.
 */
const RE_REFEREE = /character\s+reference|\breferee\b|reference\s*#?\s*\d|\breferences?\b[^?]{0,20}(name|contact|detail|email|phone)/i;

/**
 * YEARS OF EXPERIENCE — and why this REFUSES rather than answers.
 *
 * The obvious build was a `yearsExperience` number on the profile. Every real
 * example proves it wrong: "How many years' experience in commercial and/or
 * industrial electrical work", "How many years of experience do you have in a
 * GMP-regulated pharmaceutical manufacturing environment". A single career
 * total cannot answer either without asserting something nobody stated. That is
 * the country bug in a different coat — one global value answering a specific
 * question — so the honest move is to refuse and say why.
 */
const RE_YEARS_EXPERIENCE =
  /how\s+(many\s+years|much\s+(experience|exposure))|years?\s+of\s+experience|years'?\s+experience/i;

/**
 * WHERE DID YOU HEAR ABOUT US. Answerable truthfully: the agent found this
 * posting on the job board it applies from. It is not a guess and not a
 * flattering invention, which is the only reason it is answered at all.
 */
const RE_HEARD_ABOUT =
  /where\s+did\s+you\s+(hear|find|see|learn)|how\s+did\s+you\s+(hear|find|learn|get\s+to\s+know)|how\s+did\s+you\s+come\s+across|source\s+of\s+application/i;
const RE_HEARD_JOB_BOARD = /job\s*board|job\s*site|online\s+job|jobboard|internet|website|other/i;

const RE_NOTICE =
  /notice\s+period|when\s+(can|could|are)\s+you\s+(start|commence|available)|start\s+date|available\s+to\s+(start|commence)|availability\s+to\s+start|earliest[^?]{0,20}start|how\s+soon\s+can\s+you/i;

const RE_ROLE_LOCATION =
  /which\s+(office|location|site|branch|region|country|city)|location[^?]{0,20}(applying|apply|prefer|interested)|preferred\s+(office|location|work\s+location|site)/i;

const RE_RELOCATE = /willing\s+to\s+relocate|open\s+to\s+relocat|able\s+to\s+relocate|relocat(e|ion)/i;

/** "Are you an internal applicant?" / "Are you a current employee?"
 *
 *  ANSWERED "No" BY STANDING POLICY, on the owner's explicit instruction
 *  2026-08-04, having been refused before that.
 *
 *  What makes it defensible, and it is not that the answer is certain:
 *   - It is a ROUTING question. Employers use it to send internal candidates to
 *     the internal process. It is not a protected characteristic, an immigration
 *     status or a legal declaration, so a wrong answer costs a mis-routed
 *     application rather than a false statement about a person.
 *   - Reaching this form at all means the posting came off a public aggregator
 *     and the agent drove the EXTERNAL form. An internal applicant uses their
 *     employer's own portal.
 *   - blocked_companies makes it self-consistent: a candidate who excludes their
 *     employer is never applied there, so "No" is then true by construction.
 *
 *  THE RESIDUAL RISK, stated rather than buried: a candidate who does not use
 *  the blocklist and whose agent reaches their own employer's public posting
 *  will have "No" submitted for them, and it will be wrong. That is the whole
 *  exposure, and it is the argument for putting the employer in the blocklist
 *  during onboarding.
 *
 *  Narrow ON PURPOSE. It must not swallow "internal audit", "internal
 *  communications" or "internal medicine", which are job titles, not questions
 *  about employment status — hence the required applicant/employee/candidate
 *  noun and the anchored question shape.
 */
const RE_INTERNAL_APPLICANT =
  /\b(are|is)\s+you.{0,12}\b(an?\s+)?(internal|current)\s+(applicant|employee|candidate|staff)\b|\binternal\s+(applicant|candidate)\b\s*\??$|current(ly)?\s+employed\s+(by|at|with)\s+(us|this\s+(company|organi[sz]ation))/i;

// MEASURED against 29 live forms: "Allow us to process your personal
// information." was the single most common unrecognised REQUIRED question, 5
// occurrences, and it is a consent tickbox the matcher already knows how to
// answer. It missed only because the old pattern demanded the word "data" —
// "personal information" and "personal details" are the same request.
const RE_CONSENT =
  /privacy\s+(notice|policy|statement)|consent[^?]{0,30}process|process(ing)?[^?]{0,40}\b(my|your|the|personal)\s+(personal\s+)?(data|information|details)|allow\s+us\s+to\s+process|gdpr|data\s+protection|terms\s+(and|&)\s+conditions/i;
const RE_DECLARATION =
  /information\s+(provided|given|supplied)\s+is\s+(correct|true|accurate)|declare[^?]{0,40}(truthful|correct|accurate)|confirm[^?]{0,30}(accurate|correct|true)/i;

/* EEO. Identified by OPTIONS as well as label, because the label is exactly
 * what these forms tend not to give — the two race questions and one gender
 * question in the sample rendered with the first option's text where a legend
 * should be. Options are the more reliable signal here. */
const RE_EEO_LABEL =
  /\b(race|ethnicity|ethnic\s+origin|gender|sex|veteran|disability|disabled|sexual\s+orientation)\b|equal\s+(opportunit|employment)|self.?identif/i;
const RE_RACE_OPT =
  /hispanic|latino|african|caucasian|asian|pacific\s+islander|alaskan?\s+native|american\s+indian|two\s+or\s+more\s+races|coloured|\bwhite\b|\bblack\b/i;
const RE_GENDER_OPT = /^\s*(male|female|non.?binary|man|woman)\s*$/i;

const countMatching = (opts: string[], re: RegExp) => opts.filter((o) => re.test(o)).length;

function looksDemographic(q: DomQuestion): boolean {
  if (RE_EEO_LABEL.test(q.label)) return true;
  if (countMatching(q.options, RE_RACE_OPT) >= 2) return true;
  if (countMatching(q.options, RE_GENDER_OPT) >= 2) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * The matcher.
 * ------------------------------------------------------------------ */

/** Field keys the adapter already fills from the packet — never re-answered here. */
export type AlreadyMapped = ReadonlySet<string>;

/**
 * Decide how to answer one question.
 *
 * Returns `null` when the question is not required and not recognised — the
 * caller leaves it blank, which is what a person filling an optional field they
 * do not care about would do. A REQUIRED question never returns null; it
 * resolves or it refuses.
 */
function matchStanding(
  q: DomQuestion,
  a: StandingAnswers,
  /**
   * What this candidate has already told us, from earlier forms.
   *
   * Consulted ONLY after the standing rules have run and only for refusals that
   * mean "we do not hold this". A refusal of principle — an ID number, a date
   * of birth, a referee's phone number — is never resolvable from here, because
   * those are refused for what they are and not for being absent. Letting a
   * stored row override them would delete a safeguard by adding a feature.
   */
): Resolution | null {
  // A honeypot is not a question. Skipping it BEFORE anything else matters in
  // both directions: filling it announces us to a vendor that has no CAPTCHA,
  // and treating it as an unanswerable required field refuses postings that are
  // perfectly completable. Teamtailor marks its honeypot `required` precisely
  // to catch drivers that reason "required, therefore must answer".
  if (q.honeypot) return null;

  const label = (q.label || "").trim();

  // An unlabelled control is unanswerable, full stop. Two required yes/no
  // selects in the sample had no reachable label, and a matcher that guessed
  // from a name attribute or from position would be answering a question it
  // could not read. There is no safe default for a question you cannot see.
  if (!label) {
    return q.required
      ? { kind: "unanswerable", category: "unlabelled", why: `required ${q.type} "${q.name}" has no readable label` }
      : null;
  }

  const text = (verdict: string, why: string): Resolution => ({ kind: "unanswerable", category: verdict, why });

  // --- Never, regardless of what we hold -------------------------------
  if (RE_ID_DOC.test(label)) {
    return text("identity-document", "identity/ID numbers are never auto-filled");
  }
  if (RE_DOB.test(label)) {
    return text("date-of-birth", "date of birth is not collected — it is an age-discrimination vector, not a contact detail");
  }
  if (RE_REFEREE.test(label)) {
    return text("referee", "a referee's contact details are another person's data, and are not supplied on their behalf");
  }
  // An extra document slot is not the résumé slot. The adapter attaches the CV
  // by itself; anything ELSE the form wants uploaded — "Qualifications
  // Attachment", a portfolio, a licence scan — is a file we do not hold. The
  // Personio near-miss is the reason this is explicit: attaching the résumé to
  // whichever file input happened to be there would have filed a CV under
  // "employment reference" and left the CV slot empty.
  if (q.type === "file") {
    return text("extra-document", `"${label.slice(0, 60)}" wants a document that is not the résumé, and none is held`);
  }

  // --- Demographics: decline only, never assert ------------------------
  // We do not store race, gender, veteran or disability status, so the ONLY
  // answer available is a decline. When a form offers no decline option (the
  // South African race question offered African/Coloured/Indian/White/Other),
  // that is a genuine dead end and the packet must go to a human.
  if (looksDemographic(q)) {
    const decline = pick(q.options, DECLINE_RE);
    if (decline) return { kind: "choose", category: "demographic-declined", option: decline };
    if (!q.required) return null;
    return text(
      "demographic",
      a.shareDemographics
        ? "self-ID requested but no decline option, and we hold no demographic data"
        : "no decline option offered and the candidate has not opted in to sharing",
    );
  }

  // --- Names -----------------------------------------------------------
  if (RE_PREFERRED_NAME.test(label)) {
    return has(a.firstName)
      ? { kind: "fill", category: "preferred-name", value: a.firstName }
      : text("preferred-name", "no first name on file");
  }
  if (RE_FULL_NAME.test(label)) {
    const full = has(a.fullName) ? a.fullName : [a.firstName, a.lastName].filter(has).join(" ");
    return has(full)
      ? { kind: "fill", category: "full-name", value: full }
      : text("full-name", "no name on file");
  }
  if (RE_NATIONALITY.test(label)) {
    return text("nationality", "nationality is not collected — it is not the same question as work authorisation");
  }

  // --- Contact details, by label ---------------------------------------
  // Email FIRST: "Email Address" contains "address", and a street address in an
  // email field is a submitted application nobody can reply to.
  if (RE_EMAIL.test(label)) {
    return has(a.email) ? { kind: "fill", category: "email", value: a.email }
                        : text("email", "no email on file");
  }
  if (RE_PHONE.test(label)) {
    return has(a.phone) ? { kind: "fill", category: "phone", value: a.phone }
                        : text("phone", "no phone number on file");
  }
  if (RE_LINKEDIN.test(label)) {
    return has(a.linkedin) ? { kind: "fill", category: "linkedin", value: a.linkedin }
                           : text("linkedin", "no LinkedIn profile on file");
  }
  if (RE_PORTFOLIO.test(label)) {
    // A personal site and a LinkedIn profile are both honest answers to "your
    // online presence"; the website is preferred and LinkedIn is the fallback.
    const url = has(a.website) ? a.website : a.linkedin;
    return has(url) ? { kind: "fill", category: "portfolio", value: url }
                    : text("portfolio", "no website or profile URL on file");
  }
  if (RE_POSTCODE.test(label)) {
    // NOT derived from the address. Parsing a postcode out of free text is a
    // guess, and a wrong postcode on an application is worse than a blank —
    // so an empty field refuses rather than improvising one.
    return has(a.postcode) ? { kind: "fill", category: "postcode", value: a.postcode }
                           : text("postcode", "no postcode on file — it is not parsed out of the address");
  }
  if (RE_CITY.test(label)) {
    return has(a.city) ? { kind: "fill", category: "city", value: a.city }
                       : text("city", "no city on file");
  }
  if (RE_ADDRESS.test(label)) {
    return has(a.address) ? { kind: "fill", category: "address", value: a.address }
                          : text("address", "no address on file");
  }
  if (RE_COVER_LETTER.test(label)) {
    return has(a.coverNote) ? { kind: "fill", category: "cover-letter", value: a.coverNote }
                            : text("cover-letter", "no cover note on file");
  }

  // --- Salary: current before expected, always ------------------------
  if (RE_SALARY_CURRENT.test(label)) {
    return text("salary-current", "current salary is not collected, and an expectation is not a substitute");
  }
  if (RE_YEARS_EXPERIENCE.test(label)) {
    return text("years-experience",
      "years of experience in a named field is not a single stored number, and a career total is not a substitute");
  }
  if (RE_SALARY_EXPECTED.test(label)) {
    return has(a.salaryExpectation)
      ? { kind: "fill", category: "salary-expected", value: a.salaryExpectation }
      : text("salary-expected", "no salary expectation on file");
  }

  // --- Work authorisation and sponsorship ------------------------------
  // Sponsorship is checked first: "require sponsorship to work" satisfies the
  // authorisation pattern too, and answering it as authorisation inverts it.
  // WHICH COUNTRY IS THIS ABOUT? Both of these are country-specific in
  // practice — "authorized to work in the US", "require sponsorship for a UK
  // visa" — and a single global boolean answering them produced false claims
  // about a real person's immigration status. See ./countries.ts.
  if (RE_SPONSORSHIP.test(label) || RE_WORK_AUTH.test(label)) {
    const isSponsor = RE_SPONSORSHIP.test(label);
    const category = isSponsor ? "sponsorship" : "work-authorization";
    const stated = isSponsor ? a.requiresSponsorship : a.workAuthorized;
    if (stated === null) {
      return text(category, isSponsor
        ? "candidate has not stated whether they need sponsorship"
        : "candidate has not stated whether they are authorised to work");
    }

    const cov = coverage(label, a.workAuthorizedCountries, a.country);
    if (cov.kind === "not-covered") {
      // The honest refusal. Saying "yes" here claims a right to work in a
      // country nobody has said they hold, which is a false statement with
      // consequences well beyond a wasted application.
      return text(category,
        `question is about ${cov.asked.join("/")} and the candidate has only stated authorisation for ` +
        `${[a.country, ...a.workAuthorizedCountries].filter(Boolean).join(", ") || "nowhere"}`);
    }

    if (isSponsor) {
      const inverted = RE_SPONSOR_INVERTED.test(label);
      return chooseBoolean(q, inverted ? !a.requiresSponsorship! : a.requiresSponsorship!, category);
    }
    return chooseBoolean(q, a.workAuthorized!, category);
  }

  // --- Availability and relocation -------------------------------------
  if (RE_NOTICE.test(label)) {
    return has(a.earliestStart)
      ? { kind: "fill", category: "notice-period", value: a.earliestStart }
      : text("notice-period", "no notice period or start date on file");
  }
  if (RE_RELOCATE.test(label)) {
    if (a.willingToRelocate === null) return text("relocation", "candidate has not stated relocation willingness");
    return chooseBoolean(q, a.willingToRelocate, "relocation");
  }

  // Standing "No" — see RE_INTERNAL_APPLICANT for why this one is answered
  // rather than refused, and what the residual risk is.
  if (RE_INTERNAL_APPLICANT.test(label)) {
    return chooseBoolean(q, false, "internal-applicant");
  }

  // --- Which advertised location ---------------------------------------
  // This asks which posting/office the candidate wants, NOT where they live.
  // The two coincide often enough to be worth answering and not always, so an
  // option is chosen only when the candidate's own stated city or country
  // matches EXACTLY ONE of them. Two matches ("London" and "London (Hybrid)")
  // is a guess between real alternatives, and no match at all means the
  // employer is hiring somewhere the candidate never said they would go.
  if (RE_ROLE_LOCATION.test(label)) {
    const real = q.options.filter((o) => !isPlaceholder(o));
    // A required question offering exactly one location is not asking anything
    // — it is confirming the posting the candidate already chose. Selecting the
    // only option states nothing the application did not already state. Scoped
    // to this category on purpose: the same shortcut applied to a single-option
    // consent control would agree to a legal notice on someone's behalf.
    if (q.required && real.length === 1) {
      return { kind: "choose", category: "role-location", option: real[0]! };
    }
    for (const mine of [a.city, a.country]) {
      if (!has(mine)) continue;
      const hits = real.filter((o) => {
        const lo = o.toLowerCase(), lm = mine.toLowerCase();
        return lo.includes(lm) || lm.includes(lo);
      });
      if (hits.length === 1) return { kind: "choose", category: "role-location", option: hits[0]! };
      if (hits.length > 1) {
        return text("role-location", `"${mine}" matches ${hits.length} of the offered locations — ambiguous`);
      }
    }
    return text("role-location", `none of the offered locations match the candidate's stated location`);
  }

  // --- Consent and declarations ----------------------------------------
  // Both agree to something on the candidate's behalf, so both need the same
  // explicit opt-in. A truthfulness declaration is defensible — every value we
  // submit came from the candidate — but it is still a legal statement, and
  // "defensible" is not the same as "authorised".
  if (RE_CONSENT.test(label) || RE_DECLARATION.test(label)) {
    const category = RE_CONSENT.test(label) ? "consent-processing" : "truthfulness-declaration";
    if (!a.consentToProcessing) {
      return text(category, "the candidate has not authorised the agent to accept notices on their behalf");
    }
    return chooseBoolean(q, true, category);
  }

  // --- Unrecognised ------------------------------------------------------
  // --- Where did you hear about this role -------------------------------
  // True, not flattering: the agent found this posting on the job board it
  // applies from. Where the form offers a list, the closest honest option is
  // taken and nothing is invented; where it offers none that fit, it refuses
  // rather than picking whichever sounds best.
  if (RE_HEARD_ABOUT.test(label)) {
    if (q.options.length) {
      const opt = pick(q.options, RE_HEARD_JOB_BOARD);
      return opt
        ? { kind: "choose", category: "heard-about", option: opt }
        : text("heard-about", `none of the offered sources match "job board", and the real answer is not on the list`);
    }
    return { kind: "fill", category: "heard-about", value: "Job board" };
  }

  return q.required
    ? { kind: "unanswerable", category: "unrecognised", why: `no standing answer covers "${label.slice(0, 80)}"` }
    : null;
}

/**
 * The standing rules first, then — only where the refusal was "we do not hold
 * this" — whatever the candidate has already told us.
 *
 * ORDER MATTERS AND IS NOT NEGOTIABLE. The standing rules run to completion
 * before a learned answer is looked at, so a stored row can never override a
 * refusal of principle. If someone at some point answers a question that was
 * later reclassified as never-learnable, the row stays in the table and stops
 * being used — the safeguard wins over the data, not the other way round.
 *
 * A learned answer also never overrides a SUCCESSFUL standing answer. The
 * profile is the single source for name, email, work authorisation and the
 * rest; letting stale free text shadow it would reintroduce exactly the drift
 * this design is trying to remove.
 */
export function matchQuestion(
  q: DomQuestion,
  a: StandingAnswers,
  learned?: LearnedAnswers,
  prepared?: PreparedAnswers,
): Resolution | null {
  const standing = matchStanding(q, a);
  if (!standing || standing.kind !== "unanswerable") return standing;

  if (learned && learned.size && isLearnable(standing.category)) {
    const hit = fromLearned(q, learned);
    if (hit) {
      if (hit.kind === "choose") return { kind: "choose", category: standing.category, option: hit.option! };
      if (hit.kind === "check") return { kind: "check", category: standing.category };
      return { kind: "fill", category: standing.category, value: hit.value! };
    }
  }

  // LAST, AND ONLY FOR `unrecognised`. See PreparedAnswers.
  if (standing.category === "unrecognised") {
    const drafted = fromPrepared(q, prepared);
    if (drafted) return { kind: "fill", category: "unrecognised", value: drafted };
  }
  return standing;
}

/**
 * Answers apply-agent already wrote for THIS posting, keyed by question label.
 *
 * WHY THIS EXISTS — measured 2026-08-03, and it is the gap that made the whole
 * question pipeline pointless on the submit path. apply-agent harvests the
 * employer's real questions from six vendors, drafts an answer for each
 * draftable one against the résumé AND the job description, runs every draft
 * past the grounding gate, and ships the survivors in `packet.fields`. The
 * worker received all of that and read exactly one key out of it — the cover
 * note — then refused postings with "no standing answer covers ...".
 *
 * A live dry run showed the shape of the waste: "How familiar are you with
 * Service Titan?" and "What are the brands or types of units you have worked
 * on?" both blocked as `unrecognised`. Both are ordinary résumé questions that
 * apply-agent had already answered.
 *
 * THREE RULES, none of them optional:
 *
 *  1. LAST. Standing rules run to completion first, then learned answers. A
 *     draft can never shadow the profile, and never overrides the candidate's
 *     own previous words.
 *  2. ONLY `unrecognised`. Every other refusal is a refusal OF PRINCIPLE — a
 *     consent, a truthfulness declaration, a work-authorisation fact, a salary
 *     expectation. Those must come from the person or not at all, and a
 *     generated sentence is exactly what they exist to prevent. `unrecognised`
 *     is the one category that means "nothing in our schema covers this", which
 *     is precisely what a grounded draft is for.
 *  3. ALREADY GATED. buildPacket only emits a field when `d.supported` is true;
 *     an unsupported draft becomes an `unsupported-answer` blocker and never
 *     reaches the wire. So everything arriving here has passed the honesty gate
 *     once already — this does not relax it, it stops discarding its output.
 */
export type PreparedAnswers = ReadonlyMap<string, string>;

/** Labels differ in case, spacing and a trailing required-marker. Normalise both ends. */
export function normaliseLabel(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[*✱]|\(required\)|\(optional\)/g, " ")
    .replace(/[\s ]+/g, " ")
    .replace(/[:?.\s]+$/, "")
    .trim();
}

function fromPrepared(q: DomQuestion, prepared?: PreparedAnswers): string | null {
  if (!prepared || !prepared.size) return null;
  const v = prepared.get(normaliseLabel(q.label));
  return v && v.trim() ? v.trim() : null;
}

/** Split a form's questions into what we can answer and what blocks the send. */
export function planAnswers(
  questions: readonly DomQuestion[],
  answers: StandingAnswers,
  alreadyMapped: AlreadyMapped,
  learned?: LearnedAnswers,
  prepared?: PreparedAnswers,
): { answerable: Array<{ q: DomQuestion; r: Resolution }>; blocking: Array<{ q: DomQuestion; r: Resolution }> } {
  const answerable: Array<{ q: DomQuestion; r: Resolution }> = [];
  const blocking: Array<{ q: DomQuestion; r: Resolution }> = [];
  for (const q of questions) {
    if (alreadyMapped.has(q.name)) continue;
    const r = matchQuestion(q, answers, learned, prepared);
    if (!r) continue;
    if (r.kind === "unanswerable") {
      // Only a REQUIRED question blocks. An optional one we cannot answer is
      // left blank, exactly as a person would leave it.
      if (q.required) blocking.push({ q, r });
    } else {
      answerable.push({ q, r });
    }
  }
  return { answerable, blocking };
}
