// The names the bake prints for an employer, repaired first and judged
// second (SEO report 2026-10-12, SEO-006). Pure: no network, no filesystem,
// run by the bake (scripts/prerender-seo.mjs) and by the tests in src/test.
//
// WHY REPAIR COMES FIRST. A vendor feed often stores the label of a career
// SITE where the employer's name belongs: "Chubb External", "Cummins All
// Functions", "Mayo Career Site US", "Big 5 Sporting Goods Opt 1". The
// employer's own name is the text in front of the label, so the page prints
// that, and a crawler indexing "Chubb" indexes the employer it is about.
//
// WHY THE REJECTION IS NARROW. The first draft of this rule also refused
// domain-shaped names and names ending in Global or Business. Counted over
// the catalogue on 2026-10-12 that would have refused 195 domain-shaped names
// (Booking.com, Crypto.com, Alarm.com, Checkout.com) and 72 ending in Global
// (Abt Global, FGS Global, Forge Global): real employers, named as they name
// themselves. So a name is refused only when it cannot be anyone's name:
// logo or file-name text, a careers or jobs subdomain used as a name, or
// nothing but a generic word once the career-site label is off.
//
// WHAT A REFUSAL DOES (owner decision D7, 2026-10-11). A page indexable on the
// live site today keeps its indexability in this round whatever this says; it
// goes on the dry-run list the owner signs instead
// (docs/company-profiles/name-gate-dry-run.md). Only a page that is NEW to
// the index is refused, and a posting of a refused board gets no new page.

/**
 * The career-site labels a feed appends to an employer's name, as trailing
 * phrases. Each was seen live on an indexable page (SEO report 2026-10-12):
 * the label goes, the name in front of it stays.
 */
const TRAILING_LABELS = [
  /\s*[-–—|:]?\s*\(?\s*external\s+(?:career\s+site|careers?\s+site|careers?|postings?|jobs?|site)\s*\)?$/i,
  /\s*[-–—|:]?\s*\(?\s*external\s*\)?$/i,
  /\s*[-–—|:]?\s*\(?\s*careers?\s+site(?:\s+[A-Z]{2})?\s*\)?$/i,
  /\s*[-–—|:]?\s*\(?\s*career\s+portal\s*\)?$/i,
  /\s*[-–—|:]?\s*\(?\s*all\s+functions\s*\)?$/i,
  /\s*[-–—|:]?\s*\(?\s*talent\s+acquisition(?:\s+team)?\s*\)?$/i,
  /\s*[-–—|:]?\s*\(?\s*opt\.?\s*\d+\s*\)?$/i,
];

/** Words that are nobody's name on their own: a board titled only this names no employer. */
const GENERIC_NAMES = new Set([
  "all", "aerospace", "careers", "career", "jobs", "job", "external", "internal", "global", "corporate",
  "opportunities", "positions", "openings", "vacancies", "employment", "recruiting", "recruitment",
  "talent", "hiring", "apply", "join us", "work with us", "job board", "career site", "careers site",
  "us", "usa", "en", "main", "default", "test", "demo", "staff", "team", "only",
]);

/** Words that describe an image file rather than an employer; two of them in one name is alt text. */
const IMAGE_WORDS = /\b(?:logo|logos|wordmark|wht|blk|background|horizontal|vertical|stacked|reversed|transparent|colou?r|rgb|hex|banner|icon|header|footer|midnight)\b/g;

/**
 * The name with any trailing career-site label taken off. Never empties a
 * name: a name that is nothing but a label stays as it was (and the gate
 * below refuses it). Returns the name to print and whether it changed.
 */
export function repairEmployerName(name) {
  const raw = String(name ?? "").replace(/\s+/g, " ").trim();
  let out = raw;
  for (let pass = 0; pass < 3; pass++) {
    const before = out;
    for (const re of TRAILING_LABELS) {
      const next = out.replace(re, "").replace(/[\s,;:|–—-]+$/, "").trim();
      if (next && next !== out) out = next;
    }
    if (out === before) break;
  }
  return { name: out || raw, repaired: !!out && out !== raw };
}

/**
 * Why a (repaired) name cannot be printed as an employer's, or null when it
 * can. `codeShaped` is the bake's own tenant-code test (isCodeShapedName in
 * src/lib/company-display.ts), passed in because this module runs under
 * plain node and cannot import TypeScript.
 */
export function unpublishableNameReason(name, { codeShaped = false } = {}) {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!n) return "empty";
  if (codeShaped) return "tenant code";
  if (/\.(?:png|jpe?g|gif|svg|webp|bmp|tiff?|pdf|eps)\b/i.test(n)) return "file name";
  if (/\bcmyk\b|\bscreenshot at\b/i.test(n)) return "logo or image text";
  // "Logo" alone is a word some employers carry ("Logo Brands"), so it counts
  // only beside a second word that describes an image file, never by itself.
  const imageWords = (n.toLowerCase().match(IMAGE_WORDS) || []).length;
  if (imageWords >= 2) return "logo or image text";
  if (/^(?:https?:\/\/)?(?:careers?|jobs?|apply|recruiting|talent|hiring|work)\.[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?$/i.test(n)) return "careers subdomain";
  if (/^(?:only\s+)?(?:external|internal)\s+(?:postings?|jobs?|careers?|candidates?)$/i.test(n)) return "generic label";
  if (GENERIC_NAMES.has(n.toLowerCase())) return "generic word";
  return null;
}

/**
 * The bake's name for one board: the app's own board name, repaired, and
 * the gate's verdict on it.
 */
export function bakeEmployerName(token, stored, { boardName, isCodeShapedName }) {
  const shown = boardName(token, stored);
  const fixed = repairEmployerName(shown);
  // Judged before the repair too: "Only External Postings" is a label as a
  // whole, and taking a label off its end must not turn it into a name, so
  // such a name is printed as stored and refused.
  const whole = fixed.repaired ? unpublishableNameReason(shown) : null;
  const name = whole ? shown : fixed.name;
  const repaired = !whole && fixed.repaired;
  const reason = whole ?? unpublishableNameReason(name, { codeShaped: isCodeShapedName(token, name) || isCodeShapedName(token, shown) });
  return { name, shown, repaired, reason };
}
