/**
 * TEXT A MAIL FROM OUR DOMAIN MAY CARRY: NO WAY TO REACH ANYONE.
 *
 * Some sentences we mail are written by a model reading a resume the caller
 * chose: the fix-plan steps and top issues in "email me my report". A resume
 * can say anything, and a model can be steered into repeating it, so a seal
 * proves only that OUR scanner wrote a sentence, not that the sentence is
 * harmless. What turns a sentence into phishing is a way to act on it: a link,
 * a bare domain a mail client auto-links ("secure-rb-billing.com/restore"), an
 * address to write to, or a number to call. mailSafeText removes all four
 * before anything is clipped or escaped, so the clip can never cut a link in
 * half and leave the half that still works.
 *
 * A word is dropped whole when it holds a scheme ("://"), a "www.", an e-mail
 * address, or a domain anywhere inside it ("see:evil.example" included).
 *
 * Kept on purpose: technology names that look like domains but cannot be one,
 * because their last label is not a top-level domain (Node.js, config.yaml,
 * report.pdf) and the three .NET names. Degree abbreviations (B.Tech, M.Sc,
 * Ph.D) are kept because a domain needs a label of at least two characters
 * before its top level. Date ranges (2019-2023) are kept: a number is removed
 * when it starts with "+" and has seven digits, or has nine or more.
 */

/** Last labels that are file types or library suffixes and no top-level domain. */
const NOT_A_TLD = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "yml", "yaml", "html", "htm", "css", "scss",
  "php", "cpp", "csv", "xls", "xlsx", "doc", "docx", "pdf", "txt", "sql", "xml",
]);
const DOTNET = /^(?:asp|ado|vb)\.net$/i;

const SCHEME = /:\/\//;
const WWW = /(?:^|[^\p{L}\p{N}])www\./iu;
const EMAIL = /[^\s@]+@[^\s@]+\.\p{L}{2,}/u;
/** label(.label)*.tld anywhere in a word; the label before the tld at least two characters. */
const DOMAIN = /(?<![\p{L}\p{N}-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)*[\p{L}\p{N}][\p{L}\p{N}-]*[\p{L}\p{N}]\.(\p{L}{2,24})(?![\p{L}\p{N}-])/gu;
/** A run of digits with up to three separators between each, optionally "+" and "(" first. */
const PHONE = /(?<!\p{N})\+?\(?\p{N}(?:[\s().\-–]{0,3}\p{N}){6,}/gu;

function holdsDomain(word: string): boolean {
  for (const m of word.matchAll(DOMAIN)) {
    if (DOTNET.test(m[0])) continue;
    if (!NOT_A_TLD.has(m[1].toLowerCase())) return true;
  }
  return false;
}

function isContactWord(word: string): boolean {
  if (SCHEME.test(word) || WWW.test(word)) return true;
  if (word.includes("@") && EMAIL.test(word)) return true;
  return holdsDomain(word);
}

/** The string with every link, bare domain, e-mail address and phone number taken out. */
export function stripContactVectors(s: string): string {
  const kept = s.split(/\s+/).filter((w) => w && !isContactWord(w)).join(" ");
  return kept.replace(PHONE, (m) => {
    const digits = (m.match(/\p{N}/gu) ?? []).length;
    return (m.startsWith("+") && digits >= 7) || digits >= 9 ? " " : m;
  });
}

/**
 * Plain text for a mail: one line, every contact vector removed, then clipped
 * to `max` characters. Anything that is not a string is "". Escaping is still
 * the caller's job.
 */
export function mailSafeText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return stripContactVectors(v).replace(/\s+/g, " ").trim().slice(0, max);
}
