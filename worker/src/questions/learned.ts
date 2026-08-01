/**
 * Answers the candidate has given once, reused on every form that asks again.
 *
 * WHY THIS AND NOT MORE PATTERNS. Measured across 29 live forms, the matcher
 * answers 51 of 103 required questions and 16 of 29 forms complete end to end.
 * Everything still blocking is role-specific:
 *
 *     Do you have a Journeyman Electrician License?
 *     Do you hold a degree in Pharmacy, a STEM-related discipline, or equivalent?
 *     How many years of experience in a GMP-regulated pharmaceutical environment?
 *     Have you personally advised senior executives on consequential talent…?
 *     What safety training have you completed?
 *
 * There is no regex for these and there should not be. Each asserts a fact
 * about one person's career that only that person knows. Writing patterns for
 * them would mean inventing the answers, which is the thing this codebase
 * exists not to do — and the same mistake as answering a US work-authorisation
 * question from a UK boolean, just less obvious.
 *
 * So the honest lever is not a better guess, it is a memory. The agent stops
 * and asks; the candidate answers once; every later form that asks the same
 * thing is answered from what they said. A permanent block becomes a one-time
 * cost, and the answer is still theirs, never ours.
 *
 * WHAT MAY NEVER BE LEARNED, and why the distinction is the whole design.
 * Two very different things look identical from the outside — "the agent
 * refused" — and only one of them should be fixable by asking:
 *
 *   - "We do not hold this."   A gap. Ask, store, reuse.
 *   - "We will not do this."   A position. Asking would quietly convert a
 *                              deliberate refusal into a stored answer, which
 *                              is how a safeguard gets deleted by a feature.
 *
 * An ID number is refused because auto-filling credentials is unsafe, not
 * because nobody typed it in. A referee's phone number is refused because it is
 * another person's data and not the candidate's to delegate to software. Date
 * of birth is refused because it is an age-discrimination vector. None of those
 * become acceptable once stored in a table, so none of them are learnable here.
 * Changing any of them is a product decision, taken deliberately, not a side
 * effect of raising a coverage number.
 */

/** Refusals that mean "we do not hold this" — a gap the candidate can close. */
const LEARNABLE = new Set([
  "unrecognised",
  "years-experience",
  "postcode",
  "salary-current",
  "salary-expected",
  "heard-about",
  "notice-period",
  "preferred-name",
  "cover-letter",
  "address",
  "city",
  "phone",
  "email",
  "portfolio",
  "linkedin",
  "full-name",
  "relocation",
  "role-location",
]);

/**
 * Refusals that mean "we will not do this". Listed explicitly rather than
 * inferred from absence, so that adding a new refusal category to the matcher
 * is a decision about which of these two sets it belongs in — not a silent
 * default into whichever one the code happens to fall through to.
 */
const NEVER_LEARNABLE = new Set([
  "identity-document", // credentials are never auto-filled
  "date-of-birth",     // age-discrimination vector
  "nationality",       // deliberately not collected; not the same question as work authorisation
  "demographic",       // decline-only; self-ID is not stored
  "referee",           // another person's data
  "extra-document",    // wants a file we do not hold, not a text answer
  "unlabelled",        // the question could not be read, so it cannot be asked coherently
  "work-authorization", // country-specific; belongs in the profile's country list, not free text
  "sponsorship",       // same — a stored yes/no would defeat the country logic
]);

export function isLearnable(category: string): boolean {
  if (NEVER_LEARNABLE.has(category)) return false;
  return LEARNABLE.has(category);
}

/**
 * The key a learned answer is stored under.
 *
 * The full normalised LABEL, not a category and not a field name. Two employers
 * asking "how many years of experience do you have in a GMP-regulated
 * pharmaceutical manufacturing environment" are asking the same question and
 * should share an answer; "years of experience" as a key would collapse that
 * together with "years of experience in commercial electrical work" and answer
 * one from the other. That is the single-global-value bug again, and keying on
 * the whole question is what prevents it.
 *
 * Requiredness markers and surrounding punctuation are stripped so that
 * "Are you available weekends?*Required" and "Are you available weekends?"
 * are one question rather than two.
 */
export function learnedKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\*\s*(required|requis|erforderlich|obligatorisk)\b/gi, " ")
    .replace(/[*∗]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** What the candidate said, and what shape of control it was given for. */
export type LearnedAnswer = {
  key: string;
  /** The question as it was actually worded when they answered it. Kept so the
   *  account UI can show the real question rather than a normalised key. */
  label: string;
  kind: "fill" | "choose" | "check";
  value: string;
};

export type LearnedAnswers = ReadonlyMap<string, LearnedAnswer>;

/**
 * Resolve a question from what the candidate has already told us.
 *
 * Returns null when there is nothing stored, and — importantly — also when the
 * stored answer no longer fits the control. A remembered option is only used if
 * that option is STILL on the form: employers edit their dropdowns, and picking
 * a stale value would either fail silently or select whatever now sits at that
 * position. Refusing and re-asking costs the candidate one question; picking
 * wrong costs them the application.
 */
export function fromLearned(
  q: { label: string; options: string[]; type: string },
  learned: LearnedAnswers,
): { kind: "fill" | "choose" | "check"; category: string; value?: string; option?: string } | null {
  const hit = learned.get(learnedKey(q.label));
  if (!hit) return null;

  if (hit.kind === "choose") {
    const still = q.options.find((o) => o.trim() === hit.value.trim());
    if (!still) return null;
    return { kind: "choose", category: "learned", option: still };
  }
  if (hit.kind === "check") return { kind: "check", category: "learned" };
  if (!hit.value.trim()) return null;
  return { kind: "fill", category: "learned", value: hit.value };
}
