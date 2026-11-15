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
// logo or file-name text, a careers or jobs subdomain used as a name, a web
// address with a scheme or a path, a logo caption listing its colours, or
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

/**
 * The audience a career site is for, appended to its employer's name: "Inova
 * Military" is the site Inova runs for service members (SEO check 2026-11-15,
 * F04). Taken off like the labels above, but ONLY ON A BOARD MEASURED TO CARRY
 * IT AS A LABEL (review of 2026-11-15): taken off every name, it cut real
 * names short ("Disabled American Veterans", "Paralyzed Veterans", "Texas
 * Military"), and Google asks hiringOrganization for the company's name. A
 * board is listed here only when its tenant's other board in the catalogue is
 * named exactly what is left: Inova's elar~us2~CX_14001 beside elar~us2~CX_1,
 * "Inova". The test that holds this list
 * (src/test/a-logo-caption-a-careers-address-or-a-site-audience-never-names-an-employer.test.ts)
 * reads the catalogue and fails when a board meets that rule and is missing,
 * or is listed and does not. Cummins' veterans site is not on it: none of
 * that tenant's sites is named "Cummins" alone.
 */
export const AUDIENCE_LABEL_SITES = new Set(["elar~us2~CX_14001"]);
const TRAILING_AUDIENCE = /^(.*\S)[\s\-–—|:(]+(?:military|veterans)\)?$/i;

function withoutAudience(name, token) {
  if (!AUDIENCE_LABEL_SITES.has(String(token ?? ""))) return name;
  const m = TRAILING_AUDIENCE.exec(name);
  if (!m) return name;
  const head = m[1].replace(/[\s,;:|–—-]+$/, "").trim();
  return head || name;
}

/** Words that are nobody's name on their own: a board titled only this names no employer. */
const GENERIC_NAMES = new Set([
  "all", "aerospace", "careers", "career", "jobs", "job", "external", "internal", "global", "corporate",
  "opportunities", "positions", "openings", "vacancies", "employment", "recruiting", "recruitment",
  "talent", "hiring", "apply", "join us", "work with us", "job board", "career site", "careers site",
  "us", "usa", "en", "main", "default", "test", "demo", "staff", "team", "only",
]);

/**
 * Words that describe an image file rather than an employer; two of them in
 * one name is alt text. "Email" and "signature" joined the list from ADP
 * boards named by their logo file (SEO/GEO audit 2026-11-07, B02): "VHB Email
 * Signature" was a Google for Jobs hiringOrganization while its own postings
 * name Villas of Holly Brook. One alone stays a name ("Signature Healthcare").
 *
 * The second group joined from the logo captions the SEO check of 2026-11-15
 * (F04) read on live pages and the ADP and UKG boards beside them in the
 * catalogue: a logo's master file ("TRAILBORN MASTER MONOGRAM ORANGE", "AIP
 * Master Dark", "VHBG Full Master low res2"), its fonts and print colours
 * ("Denali Full Font AI Blue", "CAMlogo13 PMS"), and its variants ("Level Data
 * Full Navy", "CAA Lockup Full Light Background"). Each is an ordinary word in
 * a real name (Master Electronics, Monogram Health, Full Sail, Light & Wonder,
 * Brand Industrial Services), so each counts once and never refuses alone.
 */
const IMAGE_WORDS = new Set([
  "logo", "logos", "wht", "blk", "background", "horizontal", "vertical", "stacked", "reversed", "transparent",
  "colour", "color", "rgb", "hex", "banner", "icon", "header", "footer", "midnight", "email", "signature",
  "monogram", "master", "full", "font", "pms", "res", "light", "dark", "brand", "alone",
]);

/**
 * A logo file's variant words, which no employer's name carries, so one is
 * enough: "AVITA Health Systems unstacked", "Group withMVSB wtag" (with
 * tagline), "Klipboard No Strapline Full (1)". Each was a live ADP board name.
 * "Tagline" ("KDV Tagline", "Oceana English SideTagline 2Blue", "(no
 * tagline)"), "lockup" and "wordmark" ("Loomis Chaffee Wordmark15 RED") are
 * the same kind: none of the 45,103 catalogue and live names carrying one is
 * an employer's name (corpus of 2026-11-15).
 */
const LOGO_VARIANT_WORDS = new Set(["unstacked", "wtag", "strapline", "tagline", "lockup", "wordmark"]);

/** A file copy's suffix ("Full (1)", "transparent (3)", "OC Red (002)"): counts as one image word. */
const COPY_SUFFIX = /\s*\(\d{1,3}\)$/;

/**
 * A name that is a web address, not a name: a scheme ("https://www.deag.de/
 * navi-bottom/investors/karriere.html?t=1" was a Personio board's company
 * name and so its markup's hiringOrganization), a leading "www.", or a domain
 * followed by a path. A bare domain stays a name: Booking.com, Alarm.com,
 * Otter.ai and Change.org are how those employers write themselves (221 of
 * the 223 domain-shaped names in the catalogue and the live list on
 * 2026-11-15), unless its own words say it is a careers site.
 */
const WEB_ADDRESS = /:\/\/|^www\.|^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S/i;

/**
 * A careers site's address used as a name: a bare domain whose own name says
 * careers or jobs. "HealthCareersInSask.ca" (an Oracle site's name, so a live
 * posting's hiringOrganization, SEO check 2026-11-15 F04) is a recruiting
 * site, not the employer behind it; the one domain-shaped name in the corpus
 * carrying either word.
 */
const CAREERS_SITE_ADDRESS = /^[a-z0-9-]*(?:careers?|jobs)[a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/i;

/** An email address is not a name ("info@bodymasters.de", a Recruitee board's company field). */
const EMAIL_ADDRESS = /^[^\s@]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/i;

/** Colour words, as a logo caption lists its palette. */
const COLOUR_WORDS = new Set([
  "black", "white", "red", "blue", "green", "gold", "silver", "grey", "gray", "navy", "coral", "burgundy",
  "maroon", "teal", "orange", "purple", "yellow", "pink", "cyan", "magenta", "violet", "brown", "beige",
  "cream", "ivory", "turquoise", "aqua", "lime", "olive", "plum", "bronze", "copper", "charcoal",
]);

/**
 * A name's words as a caption reads them: split at every character that is
 * not a letter, a digit or "&", at each lower-to-upper step and between
 * letters and digits, so "SideTagline 2Blue" reads side, tagline, 2, blue and
 * "Brand_Blue" reads brand, blue. The case of each word is kept. No
 * lookbehind: the app's bundle runs this module in browsers too.
 */
function captionWords(n) {
  return n
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9&]+/)
    .filter(Boolean);
}

/**
 * A logo caption that names its colours: two or more colour words beside a
 * run-together "...Text" token ("CASES Gold+Coral+Burgundy BurgundyText", an
 * ADP board first baked 2026-11-06). Two colours alone are a name ("Blue Cross
 * Blue Shield", "Black & Veatch Red"), and so is a "...Text" word alone
 * ("OpenText").
 */
function isColourCaption(n) {
  if (!/[a-z]Text\b/.test(n)) return false;
  // Split at every non-letter and at each lower-to-upper step, without a
  // lookbehind: the app's bundle runs this module in browsers too.
  const words = n.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z]+/).map((w) => w.toLowerCase()).filter(Boolean);
  return words.filter((w) => COLOUR_WORDS.has(w)).length >= 2;
}

/**
 * A logo caption that ends in the colour of the file (SEO check 2026-11-15,
 * F04: "MEI Maroon" on two live postings, "TRAILBORN MASTER MONOGRAM ORANGE"
 * a live hiringOrganization). A name may end in a colour ("Florida Blue",
 * "Molton Brown", "Berkshire Grey", "CD PROJEKT RED", "Blades of Green"), so a
 * trailing colour is a caption only in a shape no name in the corpus takes:
 *   - written in lower case after a capitalised word ("WeatherTech red",
 *     "INDI green", "CIPLOGO ALONE blue");
 *   - after nothing but an initialism ("MEI Maroon", "DEKRA Green", "AMHA
 *     Gold", "A&A Red");
 *   - the second of two different colours ("Cambrian Yellow Navy", "OC Aqua
 *     Navy", "JCSU LettersOnly Gold Blue"); a name said twice is one name
 *     ("Copper | Copper", a Pinpoint board of the CRM company Copper).
 * Anywhere else it counts as one image word: "KemperSports Logo Green" and
 * "Level Data Full Navy" are refused by the count, "Sentinel Blue" is not.
 */
function trailingColour(words) {
  const last = words[words.length - 1];
  if (!last || words.length < 2 || !COLOUR_WORDS.has(last.toLowerCase())) return null;
  const rest = words.slice(0, -1);
  if (last === last.toLowerCase() && rest.some((w) => /[A-Z]/.test(w))) return "caption";
  if (rest.length === 1 && /^[A-Z&]{2,5}$/.test(rest[0]) && /[A-Z]{2}|[A-Z]&[A-Z]/.test(rest[0])) return "caption";
  const before = rest[rest.length - 1].toLowerCase();
  if (COLOUR_WORDS.has(before) && before !== last.toLowerCase()) return "caption";
  return "image word";
}

/**
 * The name with any trailing career-site label taken off, and on a board
 * listed in AUDIENCE_LABEL_SITES (`token`) its audience label too. Never
 * empties a name: a name that is nothing but a label stays as it was (and the
 * gate below refuses it). Returns the name to print and whether it changed.
 */
export function repairEmployerName(name, { token = null } = {}) {
  const raw = String(name ?? "").replace(/\s+/g, " ").trim();
  let out = raw;
  for (let pass = 0; pass < 3; pass++) {
    const before = out;
    for (const re of TRAILING_LABELS) {
      const next = out.replace(re, "").replace(/[\s,;:|–—-]+$/, "").trim();
      if (next && next !== out) out = next;
    }
    out = withoutAudience(out, token);
    if (out === before) break;
  }
  return { name: out || raw, repaired: !!out && out !== raw };
}

/**
 * THE REFUSALS THAT JUDGE THE TEXT ITSELF: a logo or colour caption, a file
 * name, a web, email or careers-site address. Such a text is no name on any
 * surface, so the board prints no employer for it (src/lib/listing/employer.ts).
 * The gate's other refusals say only that the name may not stand in job
 * markup: a name its board's tenant code spells ("Abercrombie" on
 * abercrombie~wd108~anf), a generic word or label. The board printed those
 * before the gate was asked, and still does (review of 2026-11-15: blanking
 * them took the employer off 9,104 open roles).
 */
export const REFUSALS_OF_THE_TEXT = new Set([
  "logo or image text", "colour caption", "file name", "web address", "email address", "careers site address", "careers subdomain",
]);

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
  // An image file's print and screen sizes: a Pantone number ("CornerstoneBankLogo
  // PMS195"), a retina or pixel suffix ("PUREHomeRiver Logo@2x", "Hori
  // FC@3600px") and a resolution ("Zeigler Auto Group high res"). A property
  // system is a name ("Vital PMS"), a number after it is a swatch, and
  // "Experienced Hires" is a hiring label, not a resolution.
  if (/pms\s?\d{2,4}\b|@\d{1,4}(?:x|px)\b|\b(?:hi[\s-]|high[\s-]?|low[\s-]?)res\b/i.test(n)) return "logo or image text";
  // "Logo" alone is a word some employers carry ("Logo Brands"), so it counts
  // only beside a second word that describes an image file, never by itself.
  const copy = COPY_SUFFIX.test(n);
  const words = captionWords(n.replace(COPY_SUFFIX, ""));
  if (words.some((w) => LOGO_VARIANT_WORDS.has(w.toLowerCase()))) return "logo or image text";
  const colour = trailingColour(words);
  if (colour === "caption") return "colour caption";
  const imageWords = words.filter((w) => IMAGE_WORDS.has(w.toLowerCase())).length + (copy ? 1 : 0) + (colour ? 1 : 0);
  if (imageWords >= 2) return colour ? "colour caption" : "logo or image text";
  if (/^(?:https?:\/\/)?(?:careers?|jobs?|apply|recruiting|talent|hiring|work)\.[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?$/i.test(n)) return "careers subdomain";
  if (WEB_ADDRESS.test(n)) return "web address";
  if (EMAIL_ADDRESS.test(n)) return "email address";
  if (CAREERS_SITE_ADDRESS.test(n)) return "careers site address";
  if (isColourCaption(n)) return "colour caption";
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
  const fixed = repairEmployerName(shown, { token });
  // Judged before the repair too: "Only External Postings" is a label as a
  // whole, and taking a label off its end must not turn it into a name, so
  // such a name is printed as stored and refused.
  const whole = fixed.repaired ? unpublishableNameReason(shown) : null;
  const name = whole ? shown : fixed.name;
  const repaired = !whole && fixed.repaired;
  const reason = whole ?? unpublishableNameReason(name, { codeShaped: isCodeShapedName(token, name) || isCodeShapedName(token, shown) });
  return { name, shown, repaired, reason };
}
