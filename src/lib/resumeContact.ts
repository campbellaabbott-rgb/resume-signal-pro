/**
 * WHAT A CV ALREADY TELLS US, SO WE STOP ASKING FOR IT.
 *
 * Setup asks for thirteen things. A résumé contains most of them already, and
 * asking somebody to retype their own phone number off a document they just
 * uploaded is the kind of friction that loses a subscriber before the product
 * has done anything for them.
 *
 * THE RULE THIS FILE LIVES BY: it is better to return nothing than to return
 * something wrong. Everything here ends up on a real application to a real
 * employer under somebody's name. A blank field is a question we ask later; a
 * WRONG field is a lie we told on their behalf, and they may never see it.
 *
 * So every rule below is deliberately narrow:
 *
 *   - Contact details are read from the HEADER BLOCK only — the first handful
 *     of lines. A phone number halfway down a CV is far more likely to belong
 *     to a referee or a former employer than to the candidate. Precision
 *     matters more than recall here, because recall costs one tap later and
 *     precision costs somebody's credibility with an employer.
 *   - Every value carries a confidence. `low` means the UI must show it as a
 *     suggestion to confirm, never as a fact to submit.
 *   - Nothing here ever touches work authorisation, sponsorship, salary or
 *     consent. Those are legal and personal statements about a human being.
 *     They cannot be inferred from prose and a wrong guess is a false
 *     declaration on a legal form, so they stay un-derived FOREVER — see
 *     applyReadiness, where they are asked at the moment a form needs them.
 */

export type ContactField = "full_name" | "email" | "phone" | "linkedin" | "website";

export type DerivedValue = {
  value: string;
  /** `high` may be used as-is. `low` must be shown for confirmation first. */
  confidence: "high" | "low";
};

export type DerivedContact = Partial<Record<ContactField, DerivedValue>>;

/**
 * How many leading non-empty lines count as the header. Measured against real
 * CV layouts: name, then some combination of email/phone/location/links. Past
 * about a dozen lines you are into a summary paragraph, where any contact
 * detail found is far more likely to be somebody else's.
 */
const HEADER_LINES = 12;

/** Headings people put above their own name. Never a name. */
const NOT_A_NAME = new Set([
  "curriculum vitae", "curriculum vita", "resume", "résumé", "cv",
  "personal details", "personal information", "profile", "contact",
  "contact details", "contact information", "about me", "summary",
]);

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function headerOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, HEADER_LINES);
}

/**
 * An email address is the one field with essentially no false-positive risk:
 * the syntax is distinctive and a CV rarely contains somebody else's. Searched
 * across the WHOLE document, unlike the others, because it is common to put it
 * in a footer.
 */
function findEmail(text: string): DerivedValue | undefined {
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (!m) return undefined;
  const value = m[0].replace(/[.,;:]+$/, "").toLowerCase();
  // A trailing dot is punctuation, not part of the address. Re-check after
  // stripping so "me@example.com." does not become an invalid address.
  if (!/^[^@]+@[^@]+\.[A-Za-z]{2,}$/.test(value)) return undefined;
  return { value, confidence: "high" };
}

/** linkedin.com/in/<slug> is unambiguous. Normalised so the stored value is a URL. */
function findLinkedIn(text: string): DerivedValue | undefined {
  const m = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i);
  if (!m) return undefined;
  return { value: `https://www.linkedin.com/in/${m[1]}`, confidence: "high" };
}

/**
 * A personal site — GitHub, a portfolio. HEADER ONLY and never LinkedIn, because
 * the body of a CV is full of employer URLs and listing a former employer's
 * website as your own is a small but real embarrassment.
 */
function findWebsite(text: string): DerivedValue | undefined {
  for (const line of headerOf(text)) {
    const m = line.match(/(?:https?:\/\/)?(?:www\.)?([A-Za-z0-9-]+\.[A-Za-z0-9.-]+\/?[A-Za-z0-9\-_/%.]*)/);
    if (!m) continue;
    const raw = m[0];
    if (/linkedin\.com/i.test(raw)) continue;
    if (/@/.test(raw)) continue;                       // part of an email
    if (!/\.[A-Za-z]{2,}/.test(raw)) continue;
    // A bare domain with no scheme in a header is usually a personal site, but
    // it can also be a company name with a suffix. Low, so it is confirmed.
    return { value: raw.startsWith("http") ? raw : `https://${raw}`, confidence: "low" };
  }
  return undefined;
}

/**
 * HEADER ONLY, and requires enough digits to be a real number. Deliberately
 * does not try to be clever about international formats: a number it cannot
 * confidently read is a question asked later, which costs one tap.
 */
function findPhone(text: string): DerivedValue | undefined {
  for (const line of headerOf(text)) {
    // Skip lines that are clearly dates or ranges rather than numbers.
    if (/\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present)\b/i.test(line)) continue;
    const m = line.match(/\+?\d[\d\s().-]{7,}\d/);
    if (!m) continue;
    const digits = m[0].replace(/\D/g, "");
    // 9 is the shortest plausible national number with an area code; 15 is the
    // E.164 maximum. Outside that range it is an ID, a date or a postcode.
    if (digits.length < 9 || digits.length > 15) continue;
    return { value: clean(m[0]), confidence: "high" };
  }
  return undefined;
}

/**
 * THE HARDEST ONE, AND THE ONE THAT MATTERS MOST — it goes on every form.
 *
 * Always returns `low`. There is no reliable way to distinguish a person's name
 * from a job title or a section heading in a plain-text CV, and a confidently
 * wrong name is the single worst thing this file could produce.
 */
function findName(text: string): DerivedValue | undefined {
  for (const line of headerOf(text).slice(0, 5)) {
    const l = clean(line);
    if (l.length > 50 || l.length < 3) continue;
    if (NOT_A_NAME.has(l.toLowerCase())) continue;
    if (/[@\d]/.test(l)) continue;                        // contact line, not a name
    if (/[|/•·,:]/.test(l)) continue;                     // "Name | Title" style header
    const words = l.split(" ");
    if (words.length < 2 || words.length > 4) continue;
    // Every word starts with a capital. Catches "Jane Smith" and "Jane McArdle"
    // while rejecting "Senior engineer" and "SKILLS AND EXPERIENCE".
    if (!words.every((w) => /^[A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]*$/.test(w))) continue;
    // A line in full caps is far more often a heading than a name, but people
    // DO write their name in caps, so it is kept — at low confidence like the
    // rest, which is the whole point of the confidence flag.
    return { value: l, confidence: "low" };
  }
  return undefined;
}

/**
 * Pull whatever can be read safely out of résumé text.
 *
 * Returns only fields it actually found — a caller can spread the result over
 * existing values without clobbering anything the person typed themselves.
 * Never throws; unparseable input yields an empty object, which is a perfectly
 * good answer meaning "we will ask".
 */
export function deriveContact(resumeText: string | null | undefined): DerivedContact {
  const text = String(resumeText ?? "");
  if (text.trim().length < 10) return {};

  const out: DerivedContact = {};
  const email = findEmail(text);
  const phone = findPhone(text);
  const linkedin = findLinkedIn(text);
  const website = findWebsite(text);
  const name = findName(text);

  if (name) out.full_name = name;
  if (email) out.email = email;
  if (phone) out.phone = phone;
  if (linkedin) out.linkedin = linkedin;
  if (website) out.website = website;
  return out;
}

/**
 * Apply derived values to a profile WITHOUT overwriting anything already set.
 *
 * The person's own typing always wins. A re-upload of a corrected CV must never
 * silently revert a field they fixed by hand — that is the kind of bug where
 * somebody corrects their phone number, sees it change back, and stops trusting
 * the whole product.
 */
export function fillGaps<T extends Record<string, unknown>>(
  profile: T,
  derived: DerivedContact,
): { next: T; filled: ContactField[] } {
  const next = { ...profile };
  const filled: ContactField[] = [];
  for (const [k, v] of Object.entries(derived) as [ContactField, DerivedValue][]) {
    const current = next[k];
    const isEmpty = current === null || current === undefined ||
      (typeof current === "string" && current.trim().length === 0);
    if (!isEmpty) continue;
    (next as Record<string, unknown>)[k] = v.value;
    filled.push(k);
  }
  return { next, filled };
}
