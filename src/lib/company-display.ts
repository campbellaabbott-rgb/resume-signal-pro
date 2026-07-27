// Employer names as they should READ, not as the feed happened to store them.
//
// Some vendors hand us a name that has been title-cased from a slug, which
// mangles acronyms: a health system that writes itself NSHS arrives as "Nshs"
// and the board renders "Verified direct from Nshs" (spotted in a live browser
// walk 2026-07-26). The employer's own capitalisation is data we don't have, so
// this is deliberately CONSERVATIVE — it only fixes the shape that can't be a
// real word, and leaves anything ambiguous exactly as the feed sent it.
//
// Never invents or expands a name: "Nshs" becomes "NSHS", never "North Shore
// Health System".

// Short all-consonant tokens are the tell. English words of 3+ letters
// essentially always carry a vowel (y counts), so a vowel-less token is an
// initialism that lost its capitals in transit.
const VOWELLESS = /^[bcdfghjklmnpqrstvwxz]{3,5}$/i;

// Words that ARE real despite having no a/e/i/o/u — don't shout these.
const REAL_WORDS = new Set(["nth", "shh", "psst", "brr", "hmm", "tsk", "pfft", "grr"]);

/** One token, uppercased only when it can't be a word. */
function fixToken(token: string): string {
  // Leave anything the feed already styled deliberately: ALLCAPS, camelCase,
  // names with digits or punctuation, and long tokens.
  if (token !== token.toLowerCase() && token !== capitalize(token.toLowerCase())) return token;
  const bare = token.toLowerCase();
  if (REAL_WORDS.has(bare)) return token;
  if (VOWELLESS.test(bare)) return bare.toUpperCase();
  return token;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Names the feed stores as a title-cased vendor slug, verified against the
// employer's own careers site (2026-07-26 browser walk). Keyed by the exact
// mangled form — anything else passes through untouched. This list only grows
// from confirmed sightings, never guesses.
const NAME_FIXES: Record<string, string> = {
  modernatx: "Moderna",
  drivenbrands: "Driven Brands",
};

/**
 * Display form of an employer name. Idempotent, and a no-op for the ~99% of
 * names that already read correctly.
 */
export function companyDisplayName(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw) return "";
  const fixed = NAME_FIXES[raw.toLowerCase()];
  if (fixed) return fixed;
  // Split on spaces but keep separators like "&" and "-" intact.
  return raw
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : fixToken(part)))
    .join("");
}

// Feeds occasionally double-escape HTML ("Bob's Auto &amp; Towing") — the
// catalog decodes at write time now, but rows stored before that fix (and any
// vendor that re-escapes) still carry entities. Same map as the JD decoder.
export function decodeNameEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;|&#0?34;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Collapse a vendor artifact where the posting title repeats its own leading
 * phrase ("Registered Nurse Registered Nurse RN" — seen live on multi-field
 * ATS exports that concatenate title + display-title). Deliberately narrow: the
 * repeated phrase must be multi-word AND at least TITLE_REPEAT_MIN characters.
 *
 * Both guards exist because reduplication is how real proper nouns are spelled
 * — "Walla Walla School District Nurse", "Sing Sing Correctional Officer",
 * "New York New York Host" — and this text reaches the cards, the apply kits
 * and the JobPosting JSON-LD that Google indexes, so a false positive
 * PUBLISHES a wrong job title. Genuine artifacts repeat a whole job title
 * ("Registered Nurse Registered Nurse RN"), which clears both bars; short
 * reduplicated place names never do. The asymmetry is intentional: missing an
 * artifact just shows the vendor's text unchanged, which is honest, while
 * over-collapsing invents a title no employer wrote.
 */
const TITLE_REPEAT_MIN = 12;

export function cleanJobTitle(title: string): string {
  const t = decodeNameEntities(title).replace(/\s+/g, " ").trim();
  const m = t.match(/^(\S+(?: \S+)+?)\s+\1(\s.*|$)/i);
  if (!m || m[1].length < TITLE_REPEAT_MIN) return t;
  return `${m[1]}${m[2]}`.trim();
}
