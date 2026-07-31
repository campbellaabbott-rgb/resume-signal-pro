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
 * before, 7 of 8 after.
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
 */
import type { DomQuestion } from "../vendors/enumerate-dom.js";

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
  linkedin: string;
  website: string;
  coverNote: string;
  salaryExpectation: string;
  earliestStart: string;
  workAuthorized: boolean | null;
  requiresSponsorship: boolean | null;
  willingToRelocate: boolean | null;
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

const RE_FULL_NAME = /^(full|complete)\s+name$|^name$|^your\s+(full\s+)?name$|full\s+name/i;
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
  /\bsponsor(ship|ing|ed)?\b|immigration\s+(case|petition|process|filing)|require[^?]{0,30}\b(work\s+)?(visa|permit)\b/i;
/** "…without sponsorship" / "…able to work without needing sponsorship" flips
 *  the sense of the answer. Missing this states the exact opposite of the
 *  truth, on a question employers filter hard on. */
const RE_SPONSOR_INVERTED =
  /without\s+(the\s+need\s+for\s+)?(visa\s+)?sponsor|not\s+require\s+sponsor|no\s+sponsorship\s+(required|needed)|free\s+from\s+(any\s+)?(visa|immigration)/i;

const RE_NOTICE =
  /notice\s+period|when\s+(can|could|are)\s+you\s+(start|commence|available)|start\s+date|available\s+to\s+(start|commence)|availability\s+to\s+start|earliest[^?]{0,20}start|how\s+soon\s+can\s+you/i;

const RE_ROLE_LOCATION =
  /which\s+(office|location|site|branch|region|country|city)|location[^?]{0,20}(applying|apply|prefer|interested)|preferred\s+(office|location|work\s+location|site)/i;

const RE_RELOCATE = /willing\s+to\s+relocate|open\s+to\s+relocat|able\s+to\s+relocate|relocat(e|ion)/i;

const RE_CONSENT =
  /privacy\s+(notice|policy|statement)|consent[^?]{0,30}process|process(ing)?[^?]{0,30}\b(my|personal)\s+data|gdpr|data\s+protection|terms\s+(and|&)\s+conditions/i;
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
export function matchQuestion(q: DomQuestion, a: StandingAnswers): Resolution | null {
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

  // --- Salary: current before expected, always ------------------------
  if (RE_SALARY_CURRENT.test(label)) {
    return text("salary-current", "current salary is not collected, and an expectation is not a substitute");
  }
  if (RE_SALARY_EXPECTED.test(label)) {
    return has(a.salaryExpectation)
      ? { kind: "fill", category: "salary-expected", value: a.salaryExpectation }
      : text("salary-expected", "no salary expectation on file");
  }

  // --- Work authorisation and sponsorship ------------------------------
  // Sponsorship is checked first: "require sponsorship to work" satisfies the
  // authorisation pattern too, and answering it as authorisation inverts it.
  if (RE_SPONSORSHIP.test(label)) {
    if (a.requiresSponsorship === null) {
      return text("sponsorship", "candidate has not stated whether they need sponsorship");
    }
    const inverted = RE_SPONSOR_INVERTED.test(label);
    return chooseBoolean(q, inverted ? !a.requiresSponsorship : a.requiresSponsorship, "sponsorship");
  }
  if (RE_WORK_AUTH.test(label)) {
    if (a.workAuthorized === null) {
      return text("work-authorization", "candidate has not stated whether they are authorised to work");
    }
    return chooseBoolean(q, a.workAuthorized, "work-authorization");
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
  return q.required
    ? { kind: "unanswerable", category: "unrecognised", why: `no standing answer covers "${label.slice(0, 80)}"` }
    : null;
}

/** Split a form's questions into what we can answer and what blocks the send. */
export function planAnswers(
  questions: readonly DomQuestion[],
  answers: StandingAnswers,
  alreadyMapped: AlreadyMapped,
): { answerable: Array<{ q: DomQuestion; r: Resolution }>; blocking: Array<{ q: DomQuestion; r: Resolution }> } {
  const answerable: Array<{ q: DomQuestion; r: Resolution }> = [];
  const blocking: Array<{ q: DomQuestion; r: Resolution }> = [];
  for (const q of questions) {
    if (alreadyMapped.has(q.name)) continue;
    const r = matchQuestion(q, answers);
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
