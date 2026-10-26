// Which text a census tool may write into the catalogue as an employer's
// name, and where on each vendor it reads that text. Pure: no network, no
// filesystem. Imported by the census tools (verify-all, resolve-oracle-names,
// resolve-oracle-sites, resolve-adp-names, merge-all, merge-oracle,
// tag-agencies) and by the tests in src/test.
//
// WHY THIS MODULE EXISTS (trusted-pages round, 2026-10-25). The census tools
// wrote names the employers never used, and every one of them came from a
// field that was not the employer's name:
//   - UKG boards were named from the most frequent image alt text on the
//     board page, which is the vendor brand's internal label ("Axia Logo
//     Horizontal", "US - LLC Recruiting", "Westminster Brand 051816"), while
//     the same page embeds the board's own Name and a footer link to the
//     employer's domain;
//   - Oracle tenants were named from the SiteName of their active sites
//     (often an audience or template label: "Aerospace", "Student"), the
//     SeoOrganizationName of inactive sites went unread, and stripping a
//     trailing "Jobs" turned "All Jobs" into "All";
//   - ADP boards fell back to the logo's file name ("C3 CMYK", "BTB2.png");
//   - Ashby boards took the hosted page's title, which is the bare word
//     "Jobs" when the organization has no hosted page;
//   - and the agency screen then read words inside those labels ("US - LLC
//     Recruiting") as a staffing business, so employers were labelled and
//     hidden as agencies.
//
// THE RULE. A name is read from the vendor's own name field first. The bake's
// rule (scripts/prerender-names.mjs: repair a trailing career-site label,
// then refuse what cannot be anyone's name) is applied unchanged, and the
// census adds the label shapes that rule does not know, because a census
// writes names before any human has looked at them: names made only of label
// words, account numbers, slugs and an image word at the end; and, in text
// read from a LABEL field (a board's label, a career-site name, welcome
// prose), template and test sites. Scaffolding comes off first ("Careers",
// "Career Site", "Jobs at", and in a label field the version, date and
// brand-asset tags an admin screen appends: "NEW", "V2", "2022", "Branding"),
// and what remains is judged as a name. A remainder that is not a name is
// refused whole and the census writes nothing: "All Jobs" never becomes
// "All", and the board waits for a name.
//
// The bake's own gate is not touched by this module. It stays as narrow as it
// is (it judges pages already on the index); the census is stricter because
// what it refuses is only held back, never printed.

import { repairEmployerName, unpublishableNameReason } from "./prerender-names.mjs";

/** Numeric and the common named entities, ampersand last so "&amp;#x27;" decodes in one pass. */
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return " "; } })
    .replace(/&apos;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&reg;/g, "\u00ae").replace(/&trade;/g, "\u2122").replace(/&copy;/g, "\u00a9")
    .replace(/&(?:ndash|mdash);/g, "-")
    .replace(/&amp;/g, "&");
}

const tidy = (s) => decodeEntities(s)
  .replace(/[\u200b\u200e\u200f\ufeff]/g, "")
  .replace(/[\s\u00a0]+/g, " ")
  .replace(/^[\s,;:|_\u2013\u2014-]+|[\s,;:|_\u2013\u2014-]+$/g, "")
  .trim();

/**
 * Words that label a board, a site, an audience or an image rather than name
 * anyone. A name made of nothing else (once joiners and legal suffixes are
 * off) carries no identity: "All Community", "Staff and Faculty", "US - LLC
 * Recruiting", "Career Portal". Kept to words no employer is named by
 * alone, so a name that adds one word outside the set ("Center for
 * Employment Opportunities", "New Opportunities Inc", "Opportunity 180",
 * "Branding Brand") stays a name.
 */
const LABEL_WORDS = new Set([
  "all", "apply", "available", "board", "career", "careers", "default",
  "employment", "external", "hiring", "internal", "job", "jobs", "join",
  "listing", "listings", "opening", "openings", "opportunities", "opportunity",
  "page", "portal", "position", "positions", "posting", "postings",
  "recruiting", "recruitment", "search", "vacancies", "vacancy", "welcome",
  "site", "sites", "location", "locations", "corporate", "company",
  "companies", "us", "team", "work", "global", "emea", "apac", "latam", "template",
  "minimal", "testing", "test", "demo", "sandbox", "sample", "logo",
  "header", "footer",
  // the same scaffolding in the languages Oracle and SmartRecruiters sites use
  "trabaje", "trabaja", "trabalhe", "con", "conosco", "nosotros", "carreras",
  "empleos", "empleo", "vagas", "emplois", "emploi", "carri\u00e8res", "carrieres",
  "rejoignez", "offres", "karriere", "stellenangebote", "stellen",
  "vacatures", "werken",
]);
/**
 * The audiences a career site is built for. A site named only for its
 * audience ("Student", "Staff and Faculty", "Training Community") names no
 * employer, but a company may carry one of these words as its whole name
 * ("Faculty", "Campus"), so they refuse a name on their own only in text
 * read from a label field, and otherwise only beside a label word
 * ("Seasonal Positions").
 */
const AUDIENCE_WORDS = new Set([
  "student", "students", "staff", "faculty", "internship", "internships",
  "intern", "interns", "campus", "volunteer", "volunteers", "seasonal",
  "community", "communities", "training", "employees", "contingent",
  "workers", "worker", "contractors", "contractor",
]);
/** Words that only a label field uses as a label ("Career Site - New Applicants"); a company may be "New Opportunities Inc". */
const LABEL_FIELD_WORDS = new Set(["new", "applicants", "candidates", "existing", "current", "open", "other", "others"]);
/**
 * The parts of an employer a label field names a board after ("Retail
 * Stores", "Hospital & Other", "Property Management - Hospitality"). In a
 * label field, a name made only of these, the slice words below and the
 * label words names a part of an employer, not the employer.
 */
const DIVISION_WORDS = new Set([
  "hospital", "hospitals", "store", "stores", "restaurant", "restaurants",
  "warehouse", "warehouses", "distribution", "property", "properties",
  "management", "plant", "plants", "facility", "facilities", "clinic",
  "clinics", "division", "department", "casino", "hotel", "hotels", "roles",
]);
/** A legal suffix marks a company's name, so a name carrying one is never "a part of an employer" ("Warehouse Services, Inc."). */
const LEGAL_SUFFIX = new Set(["inc", "llc", "ltd", "corp", "corporation", "plc", "llp", "pllc", "gmbh", "lp", "co", "company", "sa", "ag", "bv", "nv", "pty"]);
/** Words that join or qualify a name and carry no identity of their own. */
const JOINERS = new Set([
  "and", "of", "the", "a", "an", "at", "for", "with", "to", "in", "our",
  "your",
  "llc", "inc", "ltd", "corp", "plc", "llp", "pllc", "gmbh",
]);
/**
 * Words that name a slice of an employer (a division, a region, an
 * audience) and so cannot be a name standing alone: "Aviation", "Support",
 * "Executive", "HealthCare". Beside another word they are ordinary name
 * words ("East West Hospitality", "Global Support Company").
 */
const SLICE_WORDS = new Set([
  "aerospace", "aviation", "healthcare", "hospitality", "retail",
  "operations", "engineering", "manufacturing", "technology", "sales",
  "support", "field", "office", "headquarters", "hq", "craft", "services",
  "executive", "executives", "leadership", "professional", "professionals",
  "clinical", "nursing", "university", "college", "graduate", "graduates",
  "hourly", "salaried", "temporary", "worldwide", "regional", "local",
  "north", "south", "east", "west", "usa", "america", "americas", "uk",
  "europe", "new", "canada", "mexico", "india", "china", "germany", "france",
  "australia", "ireland", "japan", "brazil",
  // a role is not an employer ("Attorney Opportunities")
  "attorney", "attorneys", "nurse", "nurses", "physician", "physicians",
  "driver", "drivers", "teacher", "teachers", "technician", "technicians",
]);

const wordsOf = (s) => String(s).toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{N}']+/gu, " ").trim().split(/\s+/).filter(Boolean)
  .map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);

/** Words that describe an image file when they END a name of two name words or more ("Envision Header"). */
const IMAGE_TAIL = /(?:\s|\))(?:logos?|wordmark|header|footer|banner|icon|transparent|horizontal|vertical|stacked|reversed|cmyk|rgb)\s*$/i;

// The four shapes below are refused only in text read from a LABEL field (a
// board's own label, a career-site name, welcome prose): there they are how a
// vendor's admin screens version an asset. In a company-name field the same
// shapes are ordinary names ("Horl 1993", "V7", "The Normal Brand", "Altius
// Test Prep"), so they are not refused there.
/** A trailing version or build word ("PM New", "KemperSports - New", "Career Site V2", "(OLD) EMEA copy"). */
const VERSION_TAIL = /(?:^|[\s\-\u2013\u2014|:])(?:new|old|v\d+|copy|draft)\s*$|^\(?old\)?\s/i;
/** A brand-asset word ending the name once its dates and versions are off ("Westminster Brand 051816"). */
const BRAND_TAIL = /\b(?:brand|branding|rebrand(?:ing)?|refresh|updates?)\s*$/i;
/** A year or a packed date standing alone ("Recruiting 2025", "QSAC 01/13/2023", "SCF New Branding 2018"). */
const DATED = /(?:^|[^\w.])(?:19[89]\d|20[0-4]\d)(?![\w.])|(?:^|[^\w.])\d{6,8}(?![\w.])/;
/**
 * A board label written as a sentence or a slogan: one that addresses the
 * reader ("Your Next Career", "Discover Your Potential at ...", "*Thanks for
 * your interest in ...") or opens with an instruction. "Our Lady of ...",
 * "Make-A-Wish" and "Build-A-Bear" are names and are spared.
 */
const SENTENCE = /^\W*(?:your|we|we're|join|start|find|explore|discover|search|view|apply|come|become|grow|build|make|thanks?|thank\s+you|welcome|looking)(?=\s)|\b(?:your|thank\s+you|thanks\s+for)\b|^\W*our\b(?!\s+lady\b)/i;
/** Template, test and demo sites ("Community Template", "Tiffany - SR Testing", "S&C Minimal"). */
const TEST_SITE = /\b(?:templates?|sandbox|demo|sample|placeholder|test|minimal)\b|[-\u2013\u2014|:]\s*(?:\S+\s+)?testing\s*$|\b(?:sr|uat|qa|dev|stage|staging)\s+testing\b/i;

/**
 * Why the census must not write this name, or null when it may. The bake's
 * reasons first, judged on the name as given and on its repaired form, then
 * the census's own label shapes. `fromLabel` marks text read from a label
 * field rather than a company-name field, and adds the four label-only
 * shapes above.
 */
export function censusNameReason(raw, { fromLabel = false } = {}) {
  const name = tidy(raw).replace(/\s*\(\d{1,2}\)\s*$/, "");
  if (!name) return "empty";
  const whole = unpublishableNameReason(name);
  if (whole) return whole;
  const repaired = repairEmployerName(name).name;
  const fixed = unpublishableNameReason(repaired);
  if (fixed) return fixed;
  const words = wordsOf(name);
  if (words.length === 0) return "empty";
  if (words.every((w) => /^\d+$/.test(w)) && words.join("").length >= 5) return "account number";
  if (words.join("").length < 2) return "too short";
  if (/^[a-z0-9]+(?:careers|careersite|jobsite|portal)$/.test(name) && !LABEL_WORDS.has(name)) return "slug";
  const core = words.filter((w) => !JOINERS.has(w));
  if (!core.length) return "label words only";
  const labelOrAudience = core.every((w) => LABEL_WORDS.has(w) || AUDIENCE_WORDS.has(w) || (fromLabel && LABEL_FIELD_WORDS.has(w)));
  if (labelOrAudience && (fromLabel || core.some((w) => LABEL_WORDS.has(w)))) return "label words only";
  if (core.length === 1 && SLICE_WORDS.has(core[0])) return "generic word";
  if (core.length >= 2 && IMAGE_TAIL.test(name)) return "logo or image text";
  if (!fromLabel) return null;
  const legalName = words.some((w) => LEGAL_SUFFIX.has(w));
  if (!legalName && core.every((w) => LABEL_WORDS.has(w) || AUDIENCE_WORDS.has(w) || LABEL_FIELD_WORDS.has(w) || SLICE_WORDS.has(w) || DIVISION_WORDS.has(w))) return "names a part of an employer";
  if (SENTENCE.test(name)) return "a sentence, not a name";
  if (TEST_SITE.test(name)) return "template or test site";
  if (DATED.test(name)) return "dated label";
  if (VERSION_TAIL.test(name)) return "version label";
  const undated = name.replace(/(?:[\s\-\u2013\u2014|:/]+(?:new|old|v\d+|\d+))+\s*$/i, "");
  if (BRAND_TAIL.test(undated)) return "brand asset label";
  return null;
}

/**
 * Vendor scaffolding around a name: "Jobs at X", "X Careers", "X Career
 * Opportunities", "X - Support Staff Openings". The suffix must stand apart
 * from the name ("EniJobs" keeps its last letters).
 */
const AFFIX_PREFIX = /^(?:(?:jobs?|careers?|career\s+opportunities|opportunities|openings|positions|vacancies|work)\s+(?:at|@|with|for)|careers?\s+(?:center|centre|page|site|portal)\s+(?:of|for|at))\s+/i;
const AFFIX_SUFFIX = /(?:^|[\s\-\u2013\u2014|:_]+)(?:(?:(?:support\s+)?staff|faculty|intern(?:ship)?s?|students?|executive|experienced|professionals?|additional|official|training|campus|graduate|hourly|salaried|corporate|external|internal)\s+)?(?:career\s+opportunities|job\s+opportunities|employment\s+opportunities|opportunities|careers?\s+(?:site|page|portal|center|centre|section)(?:\s+\d{1,2})?|careers?\s+website|careersite|candidate\s+experience(?:\s+site)?|(?:jobs?|careers?)\s+(?:and|&)\s+(?:jobs?|careers?|opportunities)|career|careers|jobs?(?:\s+portal)?|job\s+board|job\s+openings|jobs?\s+listings?|employment\s+(?:portal|site|page|center|centre)|openings|positions|vacancies|talent\s+community)\s*$/i;
/**
 * In a label field, the tags a vendor's admin screen appends to an asset's
 * name: a version ("NEW", "V2"), a date ("2022", "01/13/2023", "051816"), a
 * brand-asset word ("Branding", "Refresh", "updates"). They come off, and
 * what remains is judged as a name ("CareOne Group NEW" is CareOne Group,
 * "Westminster Brand 051816" is Westminster, "2024 New" is nothing).
 */
const LABEL_TAG_TAIL = /(?:^|[\s\-\u2013\u2014|:_/(]+)(?:new|old|v\d+|copy|draft|updated?|updates|brand|branding|rebrand(?:ing)?|refresh|seasonal|hourly|salaried|interns?|internships?|volunteers?|open|all|19[89]\d|20[0-4]\d|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2}|\d{6,8})\)?\s*$/i;
/** A region tag after a separator ("Barnes - US", "Store Opportunities - Canada"). */
const REGION_TAIL = /\s*[-\u2013\u2014|]\s*(?:us|usa|u\.s\.?|uk|canada|emea|apac|latam|na|global|international|north\s+america)\s*$/i;
/** In a label field, a reader-facing qualifier in front of the label ("Current SEIU Opportunities", "All Opportunities at EOS", "External SA Recycling"). */
const LABEL_LEAD = /^(?:current\s+|external\s+|open\s+|(?:all|available)\s+(?=(?:job|jobs|career|careers|opportunities|opportunity|openings|positions|vacancies)\b))/i;
/** "all O'Neal Industries' Affiliates", "All ELLWOOD Groups": the employer is the one named inside. */
const ALL_OF = /^all\s+(.+?)['\u2019]?\s+(?:affiliates|locations|companies|groups|brands)$/i;
const COPY_NUMBER = /\s*\(\d{1,2}\)\s*$/;

/**
 * A site name in segments ("Work with us | Copa Airlines"): when every
 * segment but one is scaffolding and that one is a name, the name is the
 * segment. Otherwise the text is judged whole.
 */
function nameSegment(text, opts) {
  const parts = text.split(/\s+[|\u2013\u2014-]\s+|\s*\|\s*$/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return text;
  const named = parts.filter((x) => censusName(x, opts).name);
  return named.length === 1 ? named[0] : text;
}

/**
 * The name the census may write for one raw value, or "" with the reason it
 * may not. Scaffolding comes off (and in a label field the admin screen's
 * tags) and the bake's trailing-label repair runs, but only when what remains
 * is a name: "All Jobs" is refused whole, it never becomes "All", and text
 * that is nothing but scaffolding ("our Career Center") is refused.
 */
export function censusName(raw, opts = {}) {
  let whole = tidy(raw);
  // A label field's underscores stand for spaces ("UNIPOL_External Career Site").
  if (opts.fromLabel) whole = tidy(whole.replace(/_+/g, " "));
  if (!whole) return { name: "", reason: "empty", raw: whole };
  // The bake's verdict on the whole text first, as bakeEmployerName gives it:
  // "Only External Postings" is a label whole, whatever its end looks like.
  const wholeWhy = unpublishableNameReason(whole);
  if (wholeWhy) return { name: "", reason: wholeWhy, raw: whole };
  let name = nameSegment(whole, opts);
  for (let pass = 0; pass < 6; pass++) {
    let next = tidy(name.replace(COPY_NUMBER, "").replace(AFFIX_PREFIX, "").replace(AFFIX_SUFFIX, ""));
    if (opts.fromLabel) next = tidy(next.replace(ALL_OF, "$1").replace(LABEL_LEAD, "").replace(REGION_TAIL, "").replace(LABEL_TAG_TAIL, "").replace(/(?<=s)['\u2019]$/, ""));
    if (!next) return { name: "", reason: "label words only", raw: whole };
    if (next === name) break;
    name = next;
  }
  name = tidy(repairEmployerName(name).name);
  const reason = censusNameReason(name, opts);
  if (reason) return { name: "", reason, raw: whole };
  return { name, reason: null, raw: whole };
}

// ── agency ──────────────────────────────────────────────────────────────────

/**
 * Vendors whose catalogue names were mined from a label rather than read from
 * a company-name field: UKG (board label or logo text), Oracle (career-site
 * names), ADP (welcome prose, logo files, posting prose). A word inside such a
 * name says what the board is for, not what the business is, so it is never
 * evidence of a staffing agency. Their flags come from the conviction ledger
 * or the mill screen's phrase evidence only.
 */
export const LABEL_NAMED_VENDORS = new Set(["ukg", "oracle", "adp"]);

/** A recruiting word used as the label of an employer's own hiring portal or team. */
const RECRUITING_LABEL = /\b(?:campus|university|college|graduate|student|internal|external|corporate|global)\s+(?:e-?)?recruit(?:ing|ment)\b|\b(?:e-?)?recruit(?:ing|ment|er)s?\s+(?:portal|team|system|site|page|department|dept|office|centre|center|platform|board|template)\b|\be-recruitment\b/gi;

/**
 * The text of a catalogue name that the staffing-vocabulary screen may read,
 * or "" when no word of it may count. Empty for a label-named vendor and for
 * a name the census rule refuses (a label as a whole names no business); the
 * recruiting-portal phrases are taken out of the rest, so "mthree Recruiting
 * Portal" is screened as "mthree".
 */
export function agencyScreenText(vendor, name) {
  if (LABEL_NAMED_VENDORS.has(String(vendor))) return "";
  const n = tidy(name);
  if (!n || censusNameReason(n)) return "";
  return n.replace(RECRUITING_LABEL, " ").replace(/\s+/g, " ").trim();
}

// ── page readers ────────────────────────────────────────────────────────────

/** The JSON object literal that starts at text[at] ("{"), string-aware, or null. */
function objectAt(text, at) {
  if (text[at] !== "{") return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(at, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** The object assigned after `marker` in a page's script ("jobBoard: {...}", "__appData = {...}"). */
function assignedObject(html, marker) {
  const text = String(html ?? "");
  let from = 0;
  for (;;) {
    const i = text.indexOf(marker, from);
    if (i < 0) return null;
    const brace = text.indexOf("{", i + marker.length);
    if (brace >= 0 && /^[\s:=]*$/.test(text.slice(i + marker.length, brace))) {
      const obj = objectAt(text, brace);
      if (obj) return obj;
    }
    from = i + marker.length;
  }
}

/** Every attribute of one tag, lowercased names, entity-decoded values. */
function attrsOf(tag) {
  const out = {};
  for (const m of String(tag).matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/**
 * What a UKG board page says about its owner: the board's own Name (the
 * vendor's name field; a translation stands in when the field is blank) and
 * the employer's footer link. Image alt text is not read at all.
 */
export function ukgBoardFields(html) {
  const board = assignedObject(html, "jobBoard:");
  const translated = Array.isArray(board?.Translations)
    ? board.Translations.map((t) => String(t?.Name ?? "").trim()).find(Boolean) ?? ""
    : "";
  const boardName = String(board?.Name ?? "").trim() || translated;
  let footerUrl = "";
  for (const m of String(html ?? "").matchAll(/<a\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if (a["data-automation"] === "footer-text" && a.href) { footerUrl = a.href.trim(); break; }
  }
  return { boardName, footerUrl };
}

/** Hosts that are never an employer's own site: the vendor, social networks, job sites, shorteners. */
const NOT_EMPLOYER_HOST = /(?:^|\.)(?:ultipro\.com|ukg\.com|ultimatesoftware\.com|linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|youtu\.be|vimeo\.com|glassdoor\.com|indeed\.com|google\.com|goo\.gl|forms\.gle|bit\.ly|tinyurl\.com|adp\.com|oraclecloud\.com|ashbyhq\.com|squarespace\.com|squarespace-cdn\.com|wixstatic\.com|buttercms\.com|cloudfront\.net|amazonaws\.com|googleusercontent\.com|sharepoint\.com|hubspotusercontent[\w-]*\.net|e-verify\.gov|uscis\.gov|dol\.gov|eeoc\.gov)$|^(?:cdn|static|assets|media|img|images)\d*\./i;

/** The employer's host from a footer link, or "" when the link is missing or points elsewhere. */
export function employerHost(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  let host;
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase(); } catch { return ""; }
  if (!host.includes(".") || NOT_EMPLOYER_HOST.test(host)) return "";
  return host;
}

/** The registrable label of a host: www.axiawh.com -> axiawh, careers.nhs.co.uk -> nhs. */
function hostLabel(host) {
  const parts = String(host).toLowerCase().replace(/^www\d*\./, "").split(".").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const label = parts.length >= 3 && tld.length === 2 && /^(?:co|com|org|net|ac|gov|edu|or|ne)$/.test(sld)
    ? parts[parts.length - 3] : sld;
  return label.replace(/[^a-z0-9]/g, "");
}

const NAME_STOP = new Set(["the", "of", "and", "for", "a", "an", "at", "inc", "llc", "ltd", "corp", "co", "company", "group", "plc", "llp"]);
/**
 * Words too common in names to show, by themselves, that a name and a domain
 * or slug belong together: "Adaptive Home Health" shares only "health" with
 * the fira-health board, and is another company.
 */
const COMMON_NAME_WORDS = new Set([
  "health", "healthcare", "care", "medical", "group", "services", "service", "solutions", "systems",
  "labs", "lab", "media", "energy", "capital", "partners", "technologies", "technology", "tech",
  "home", "homes", "bank", "financial", "finance", "consulting", "management", "international",
  "global", "america", "american", "national", "foods", "food", "company", "companies", "network",
  "industries", "enterprises", "holdings", "resources", "software", "digital", "ai", "data",
]);

/**
 * Whether a board's name and its employer's domain plausibly name the same
 * employer: a name word inside the domain label, the domain label spelled by
 * the name's letters in order from its first, or the name's initials leading
 * the label. "Craft" against austin-ind.com disagrees; "Axia Women's Health"
 * against axiawh.com and "Hilltop Community Resources" against htop.org agree.
 */
export function nameAgreesWithHost(name, host) {
  return nameAgreesWithLabel(name, hostLabel(host));
}

/** The same test against a vendor slug ("binance.us", "sf-tensor", "goteleport"). */
export function nameAgreesWithSlug(name, slug) {
  return nameAgreesWithLabel(name, String(slug ?? "").toLowerCase().replace(/^eu~/, "").replace(/[^a-z0-9]/g, ""));
}

function nameAgreesWithLabel(name, label) {
  if (label.length < 2) return false;
  const words = wordsOf(name).map((w) => w.replace(/'/g, "")).filter((w) => w && !NAME_STOP.has(w));
  if (!words.length) return false;
  if (words.some((w) => w.length >= 3 && !COMMON_NAME_WORDS.has(w) && label.includes(w))) return true;
  const letters = words.join("");
  if (label.includes(letters)) return true;
  if (label.length >= 3 && label[0] === letters[0]) {
    let j = 0;
    for (const c of letters) if (c === label[j]) j++;
    if (j === label.length) return true;
  }
  const initials = words.map((w) => w[0]).join("");
  return initials.length >= 2 && label.startsWith(initials);
}

/**
 * The name an employer's own homepage gives itself: og:site_name, then a
 * JSON-LD Organization's name, then application-name. Never the <title>,
 * which carries page words ("Home | ...").
 */
export function siteNameFromHomepage(html) {
  const text = String(html ?? "");
  const metas = [...text.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const og = metas.find((a) => (a.property ?? a.name ?? "").toLowerCase() === "og:site_name")?.content;
  if (og && og.trim()) return og.trim();
  for (const m of text.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const nodes = [];
    const walk = (x) => {
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (x && typeof x === "object") { nodes.push(x); if (Array.isArray(x["@graph"])) walk(x["@graph"]); }
    };
    walk(data);
    for (const n of nodes) {
      const types = [].concat(n["@type"] ?? []).map(String);
      if (types.some((t) => /^(?:Organization|Corporation|LocalBusiness|NGO|EducationalOrganization|CollegeOrUniversity|MedicalOrganization|Hospital|GovernmentOrganization)$/.test(t))
        && typeof n.name === "string" && n.name.trim()) return decodeEntities(n.name.trim());
    }
  }
  const app = metas.find((a) => (a.name ?? "").toLowerCase() === "application-name")?.content;
  return app && app.trim() ? app.trim() : "";
}

/**
 * One UKG board's name, decided from what its page and its employer's site
 * say. The board's own Name wins when it is a name and agrees with the
 * employer's footer domain (or there is no footer); otherwise the employer's
 * homepage names itself; otherwise the board is left unnamed.
 */
/**
 * Whether a name fits the UKG tenant code, which the vendor builds from the
 * employer's legal name: three letters, digits, an abbreviation
 * ("CON1051CONPC" for Continental Properties, "AUS1003AUIN" for Austin
 * Industries). Evidence that a board Name is its employer's when the footer
 * domain does not show it; never a name source.
 */
export function nameAgreesWithTenant(name, tenant) {
  const m = /^([a-z]{3})\d+([a-z0-9]*)$/i.exec(String(tenant ?? ""));
  if (!m) return false;
  const letters = wordsOf(name).filter((w) => !NAME_STOP.has(w)).join("").replace(/'/g, "");
  if (letters.startsWith(m[1].toLowerCase())) return true;
  return m[2].length >= 3 && nameAgreesWithLabel(name, m[2].toLowerCase());
}

/** The name a homepage gives itself, cut to the segment that names its own domain ("RREMC Restaurants | American ..."). */
function siteNameFor(siteName, host) {
  const whole = censusName(siteName);
  const parts = String(siteName ?? "").split(/\s+[|\u2013\u2014-]\s+/).map((x) => censusName(x).name).filter(Boolean);
  if (parts.length < 2) return whole.name;
  // How much of a segment the domain spells: the share of its words inside the
  // domain label, or all of it when its initials are the label.
  const label = hostLabel(host);
  const fit = (x) => {
    const w = wordsOf(x).map((t) => t.replace(/'/g, "")).filter((t) => t && !NAME_STOP.has(t));
    if (!w.length) return 0;
    if (w.map((t) => t[0]).join("") === label) return 1;
    return w.filter((t) => t.length >= 3 && label.includes(t)).length / w.length;
  };
  const ranked = parts.filter((x) => nameAgreesWithHost(x, host)).sort((a, b) => fit(b) - fit(a) || b.length - a.length);
  return ranked[0] ?? whole.name;
}

export function pickUkgName({ boardName, footerUrl, siteName, tenant = "" }) {
  const host = employerHost(footerUrl);
  const board = censusName(boardName, { fromLabel: true });
  if (board.name && !host) return { name: board.name, evidence: "jobBoard.Name (no footer link)" };
  if (board.name && nameAgreesWithHost(board.name, host)) return { name: board.name, evidence: `jobBoard.Name, agrees with ${host}` };
  if (board.name && nameAgreesWithTenant(board.name, tenant)) return { name: board.name, evidence: `jobBoard.Name, agrees with tenant ${tenant}` };
  const site = host ? siteNameFor(siteName, host) : "";
  if (site) return { name: site, evidence: `${host} names itself` };
  const why = board.name
    ? `jobBoard.Name "${board.raw}" does not match ${host}`
    : `jobBoard.Name "${board.raw}": ${board.reason}`;
  return { name: "", evidence: host ? `${why}; ${host} gave no usable name` : why };
}

/**
 * The census read of one UKG board: its page, and its employer's homepage
 * only when the board's own Name cannot settle it. `getText(url)` returns the
 * body or null. Null when the board page itself is unreadable.
 */
export async function ukgName(boardUrl, getText) {
  const html = await getText(boardUrl);
  if (!html) return null;
  const fields = { ...ukgBoardFields(html), tenant: /\/([^/]+)\/JobBoard\//i.exec(`${boardUrl}/`)?.[1] ?? "" };
  const host = employerHost(fields.footerUrl);
  const first = pickUkgName({ ...fields, siteName: "" });
  if (first.name || !host) return { ...first, ...fields };
  let origin;
  try { origin = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(fields.footerUrl) ? fields.footerUrl : `https://${fields.footerUrl}`).origin; } catch { origin = `https://${host}`; }
  const home = await getText(`${origin}/`);
  const siteName = siteNameFromHomepage(home);
  return { ...pickUkgName({ ...fields, siteName }), ...fields, siteName };
}

/**
 * The organization name on an Ashby hosted jobs page (its embedded app
 * data), or "" when the page carries none. The page <title> is not read: it
 * is the bare word "Jobs" whenever the organization field is empty.
 */
export function ashbyOrganizationName(html) {
  const data = assignedObject(html, "__appData");
  const name = data?.organization?.name;
  return typeof name === "string" ? name.trim() : "";
}

/**
 * An Ashby board's name: the organization record's name when it plainly
 * names the board's own slug's employer, else the slug made readable (the
 * census's long-standing fallback), which the census rule then judges. An
 * organization name that disagrees with the slug is usually a legal entity
 * or a renamed account ("Armitage Labs" on creem, "cfo.ai" on runway), so it
 * is not written over the name the employer gave its board.
 */
export function pickAshbyName(orgName, slug) {
  const prettify = (t) => String(t).replace(/^eu~/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim().slice(0, 60);
  const org = String(orgName ?? "").trim();
  if (org && nameAgreesWithSlug(org, slug)) return { name: org.slice(0, 60), from: "organization.name" };
  return { name: prettify(slug), from: org ? `slug (organization.name "${org}" does not match it)` : "slug (no organization record)" };
}

/** Words that may sit inside a name between its capitalised words ("City of Boston", "Bed Bath & Beyond"). */
const NAME_CONNECTORS = new Set(["of", "and", "the", "de", "la", "du", "des", "del", "di", "da", "van", "von", "&", "+", "-", "for", "at", "on", "by", "upon"]);

/**
 * The run of name words at the start of a phrase: words carrying a capital
 * or a digit, and connectors between them. Prose that runs on past the name
 * ("Taco Bell and be part of a team that supports your success") stops at
 * its first ordinary word, and a phrase that opens with one ("our Career
 * Center") has no name in it.
 */
function leadingNameRun(phrase) {
  const kept = [];
  const toks = String(phrase).replace(/[\u00ae\u2122\u00a9]/g, "").trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    // a capital letter alone before a lowercase word is a broken word ("C entral"), not a name word
    if (/^\p{Lu}$/u.test(tok) && /^\p{Ll}/u.test(toks[i + 1] ?? "")) break;
    // the prose turns to the reader ("... Brands Careers We're hiring")
    if (/^(?:we|we're|we\u2019re|our|you|your|you're|i|us)$/i.test(tok.replace(/[^\w'\u2019]/g, ""))) break;
    // a comma ends the name unless a legal suffix follows ("Kawasaki Robotics (USA), Inc")
    if (/,$/.test(tok) && /[\p{Lu}\p{N}]/u.test(tok)) {
      const legalNext = /^(?:inc|llc|ltd|co|corp|l\.?p|p\.?c|plc|llp|pllc)\b\.?/i.test(toks[i + 1] ?? "");
      kept.push(legalNext ? tok : tok.slice(0, -1));
      if (!legalNext) break;
      continue;
    }
    if (/[\p{Lu}\p{N}]/u.test(tok)) { kept.push(tok); continue; }
    if (kept.length && NAME_CONNECTORS.has(tok.toLowerCase())) { kept.push(tok); continue; }
    break;
  }
  while (kept.length && NAME_CONNECTORS.has(kept[kept.length - 1].toLowerCase())) kept.pop();
  return kept.join(" ");
}

/**
 * The employer name in an ADP career centre's welcome prose ("Welcome to
 * League School!", "Welcome to Hudson Regional Hospital Career Center"), or
 * "". The logo's file name is never a source.
 */
export function adpWelcomeName(contentLinks) {
  for (const cl of Array.isArray(contentLinks) ? contentLinks : []) {
    if (cl?.linkTypeCode?.codeValue !== "WELCOME-TXT") continue;
    const prose = decodeEntities(String(cl?.linkTypeCode?.longName ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const m = prose.match(/\bwelcome to ([^.!?|]{2,60}?)\s*(?:[.!?|]|$)/i) ||
      prose.match(/\b(?:employment|a career|careers?|a position|positions?|opportunit\w+|working) (?:with|at) ([A-Z][^.!?,|]{1,60}?)\s*(?:[.!?,|]|$)/);
    if (!m) continue;
    const run = leadingNameRun(m[1].replace(/^the\s+(?=\p{Lu})/u, ""));
    if (!run) continue;
    const c = censusName(run, { fromLabel: true });
    if (c.name) return c.name;
  }
  return "";
}

// ── Oracle ──────────────────────────────────────────────────────────────────

const siteNumber = (s) => String(s?.SiteNumber ?? s?.Number ?? "");

/**
 * One Oracle career site's employer name: its SeoOrganizationName (the name
 * the employer gave search engines) when that is a name, else its SiteName
 * when that is a name, else null. "All Jobs", "Student", "Community
 * Template" and the like are labels and name no one.
 */
export function oracleSiteName(site) {
  const seo = censusName(site?.SeoOrganizationName);
  if (seo.name) return seo.name;
  const label = censusName(site?.SiteName, { fromLabel: true });
  return label.name || null;
}

/**
 * A tenant's name from its whole site list. Active sites decide: one name
 * across them resolves, several are ambiguous (the per-site split takes
 * over). When no active site carries a name, the SeoOrganizationName on the
 * tenant's inactive sites is read before giving up, because a tenant whose
 * only live site is a label ("Aerospace") often kept its name there.
 */
export function oraclePickName(sites) {
  const list = Array.isArray(sites) ? sites : [];
  const active = list.filter((s) => s?.StatusCode === "ORA_ACTIVE");
  const named = active.map((s) => ({ site: s, name: oracleSiteName(s) })).filter((x) => x.name);
  if (named.length) {
    const names = [...new Set(named.map((x) => x.name.toLowerCase()))];
    if (names.length > 1) return { status: "ambiguous", names: named.map((x) => x.name) };
    return { status: "resolved", name: named[0].name, activeSite: siteNumber(named[0].site), evidence: `${named.length} active named site(s)` };
  }
  const retired = list.filter((s) => s?.StatusCode !== "ORA_ACTIVE")
    .map((s) => ({ site: s, name: censusName(s?.SeoOrganizationName).name })).filter((x) => x.name);
  const names = [...new Set(retired.map((x) => x.name.toLowerCase()))];
  if (names.length === 1) {
    return {
      status: "resolved",
      name: retired[0].name,
      activeSite: siteNumber(active[0] ?? retired[0].site),
      evidence: `SeoOrganizationName of ${retired.length} inactive site(s) (${retired.map((x) => siteNumber(x.site)).join(", ")}); no active site carries a name`,
    };
  }
  if (names.length > 1) return { status: "ambiguous", names: retired.map((x) => x.name) };
  return { status: "unresolved" };
}
