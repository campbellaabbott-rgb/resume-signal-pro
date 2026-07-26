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

/**
 * Display form of an employer name. Idempotent, and a no-op for the ~99% of
 * names that already read correctly.
 */
export function companyDisplayName(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw) return "";
  // Split on spaces but keep separators like "&" and "-" intact.
  return raw
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : fixToken(part)))
    .join("");
}
