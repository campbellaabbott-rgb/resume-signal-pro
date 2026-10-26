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
  // Oracle's shipped site name ("Candidate Experience site") and an admin
  // screen's abbreviations ("ADMN Training Career Site V2")
  "candidate", "experience", "admin", "admn",
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
const LABEL_FIELD_WORDS = new Set(["new", "applicants", "candidates", "existing", "current", "open", "other", "others", "only", "courtesy"]);
/**
 * Qualifiers a label leaves behind once its label words are off ("Club
 * Opportunities", "International Opportunities", "Swisher Current
 * Opportunities"). Standing alone in a label field they name no one; a
 * company may still be called "Current" in its own name field.
 */
const LEFTOVER_QUALIFIERS = new Set(["current", "international", "club", "only", "candidates"]);
/** The institutions an employer can be by itself ("Community Hospital"), unlike a store or a plant. */
const INSTITUTION_WORDS = new Set(["hospital", "clinic", "school", "college", "university", "academy", "library", "museum"]);
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
  "dining", "food", "beverage", "culinary", "shops", "branch", "branches",
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
  // a role is not an employer ("Attorney Opportunities", a school district's
  // "Teaching" and "Substitutes" sites)
  "attorney", "attorneys", "nurse", "nurses", "physician", "physicians",
  "driver", "drivers", "teacher", "teachers", "technician", "technicians",
  "teaching", "substitute", "substitutes", "psychologist", "psychologists",
  "paraprofessional", "paraprofessionals", "counselor", "counselors",
  "therapist", "therapists", "custodian", "custodians", "pharmacist", "pharmacists",
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
const SENTENCE = /^\W*(?:your|we|we're|join|start|find|explore|discover|search|view|apply|come|become|grow|build|make|thanks?|thank\s+you|welcome|looking)(?=\s)|\b(?:your|thank\s+you|thanks\s+for|for\s+more\s+information)\b|^\W*our\b(?!\s+lady\b)/i;
/** Template, test and demo sites ("Community Template", "Tiffany - SR Testing", "S&C Minimal"). */
const TEST_SITE = /\b(?:templates?|sandbox|demo|sample|placeholder|test|minimal)\b|[-\u2013\u2014|:]\s*(?:\S+\s+)?testing\s*$|\b(?:sr|uat|qa|dev|stage|staging)\s+testing\b/i;
/**
 * A web address. A leading "www." is nobody's name. A name ending in a
 * top-level domain is how some employers name themselves in their own name
 * field (Booking.com, Jinba.io), but in a label field, or as the name a
 * homepage gives itself, it is the address of a site, and often not the
 * employer's: "MLB.com" for the Houston Astros, "covolt.com" on Signal
 * Energy's page (the review, 2026-10-26).
 */
const LEADING_WWW = /^www\d*\./i;
const DOMAIN_TAIL = /\.(?:com|org|net|io|co|us|edu|gov|ai|biz|info|app)$/i;
/** An email address or a link: contact text, never a name ("... email FWS@BerkeleyCollege.edu"). */
const CONTACT = /[^\s@]+@[^\s@]+\.[a-z]{2,}|https?:\/\//i;
/** A label naming a place rather than an employer ("Career Opportunities in Delaware"). */
const PLACE_LABEL = /^(?:(?:employment|job|career)\s+)?(?:opportunities|openings|positions|jobs|careers?|vacancies)\s+in\s+/i;
/** A part of an employer named as a department ("Department of Human Resources"). */
const DEPARTMENT_OF = /^(?:the\s+)?(?:department|dept\.?|division|office|bureau)\s+of\s+/i;
/** Only an HR function's own name ("Human Resources", "Talent Acquisition"). */
const HR_FUNCTION = /^(?:the\s+)?(?:human\s+resources?|talent\s+acquisition|hr|people\s+(?:team|operations))(?:\s+(?:team|department|dept))?$/i;
/**
 * A segment saying the board belongs to, or is a property of, ANOTHER
 * company: "KENT Nutrition - A member of the KENT WORLDWIDE family of
 * companies", "The Lodge - A Benchmark Resorts Property". Whose employee a
 * reader would be is exactly what such a name leaves open, so it is refused.
 */
const OTHER_COMPANY = /^(?:an?|the)\s+(?:proud\s+)?(?:member|part|division|subsidiary|affiliate|unit)\s+of\b|^an?\s+.*\b(?:property|properties)\s*$/i;
const OTHER_COMPANY_TAIL = /\s[-\u2013\u2014|]\s*(?:(?:an?|the)\s+(?:proud\s+)?(?:member|part|division|subsidiary|affiliate|unit)\s+of\b|an?\s+[^-|\u2013\u2014]*\b(?:property|properties)\b)/i;
/** A slogan or an award beside the name ("US Best Managed Company Award Winner", "Maine Roots. Global Opportunities."). */
const SLOGAN_WORDS = /\baward\b|\bwinners?\b|\bbest\s+(?:managed|places?|employers?)\b|\bcertified\b|\btop\s+workplaces?\b/i;
/** Abbreviations whose full stop does not end a sentence ("Coherent Corp. Malaysia", "National Assoc. of ..."). */
const ABBREVIATIONS = new Set(["corp", "assn", "assoc", "dept", "univ", "intl", "natl", "bros", "svcs", "mfrs"]);
/** A full stop after a word, then a capital: one sentence ending and another starting ("Maine Roots. Global Opportunities."). */
function sentenceBreak(s) {
  for (const m of String(s).matchAll(/(\p{L}{4,})\.\s+\p{Lu}/gu)) if (!ABBREVIATIONS.has(m[1].toLowerCase())) return true;
  return false;
}
const isSlogan = (s) => SLOGAN_WORDS.test(s) || sentenceBreak(s);
/** A short code standing for a site, not a name ("L148"); "A49" (an architecture firm) and "3M" stay names. */
const CODE_WORD = /^[a-z]{1,3}\d{3,}[a-z]?$/;
/** Brackets and quotes that open and never close: the text was cut off mid-name. */
function unbalanced(s) {
  const count = (re) => (s.match(re) ?? []).length;
  return count(/\(/g) !== count(/\)/g) || count(/\[/g) !== count(/\]/g) || count(/"/g) % 2 === 1 || count(/\u201c/g) !== count(/\u201d/g);
}

/**
 * Why the census must not write this name, or null when it may. The bake's
 * reasons first, judged on the name as given and on its repaired form, then
 * the census's own label shapes. `fromLabel` marks text read from a label
 * field rather than a company-name field, and adds the four label-only
 * shapes above and the review's (2026-10-26): a leftover qualifier, a code,
 * a label naming a place, another company's property, a department, a
 * sentence. `fromSite` marks the name a homepage gives itself, which may not
 * be a web address. `institutionOk` lets a hospital, school or clinic stand
 * as the employer when its tenant names no other site (oraclePickName).
 */
export function censusNameReason(raw, { fromLabel = false, fromSite = false, institutionOk = false } = {}) {
  const name = tidy(raw).replace(/\s*\(\d{1,2}\)\s*$/, "");
  if (!name) return "empty";
  const whole = unpublishableNameReason(name);
  if (whole) return whole;
  if (LEADING_WWW.test(name)) return "a web address, not a name";
  if ((fromLabel || fromSite) && DOMAIN_TAIL.test(name)) return "a web address, not a name";
  if (CONTACT.test(name)) return "contact text, not a name";
  if (unbalanced(name)) return "cut off mid-name";
  if (HR_FUNCTION.test(name)) return "label words only";
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
  const labelOrAudience = core.every((w) => LABEL_WORDS.has(w) || AUDIENCE_WORDS.has(w) || (fromLabel && (LABEL_FIELD_WORDS.has(w) || CODE_WORD.test(w))));
  if (labelOrAudience && (fromLabel || core.some((w) => LABEL_WORDS.has(w)))) return "label words only";
  if (core.length === 1 && SLICE_WORDS.has(core[0])) return "generic word";
  if (core.length >= 2 && IMAGE_TAIL.test(name)) return "logo or image text";
  if (!fromLabel) return null;
  if (core.length === 1 && LEFTOVER_QUALIFIERS.has(core[0])) return "generic word";
  if (core.length === 1 && CODE_WORD.test(core[0])) return "a code, not a name";
  if (PLACE_LABEL.test(name)) return "a label naming a place";
  if (OTHER_COMPANY.test(name) || OTHER_COMPANY_TAIL.test(name)) return "names another company's property or family";
  const legalName = words.some((w) => LEGAL_SUFFIX.has(w));
  const institution = institutionOk && core.length >= 2 && INSTITUTION_WORDS.has(core[core.length - 1]);
  if (!legalName && !institution && core.every((w) => LABEL_WORDS.has(w) || AUDIENCE_WORDS.has(w) || LABEL_FIELD_WORDS.has(w) || SLICE_WORDS.has(w) || DIVISION_WORDS.has(w))) return "names a part of an employer";
  if (!legalName && DEPARTMENT_OF.test(name)) return "names a part of an employer";
  if (SENTENCE.test(name)) return "a sentence, not a name";
  // a full stop inside the name, then another sentence ("arrivia. Go far in the travel industry.")
  if (sentenceBreak(name)) return "a sentence, not a name";
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
const AFFIX_PREFIX = /^(?:(?:(?:potential|current|exciting|available|open|new)\s+)?(?:(?:employment|job|career)\s+opportunities|jobs?|careers?|opportunities|openings|positions|vacancies|work)\s+(?:at|@|with|for)|careers?\s+(?:center|centre|page|site|portal)\s+(?:of|for|at)|candidate\s+experience(?:\s+(?:site|page))?(?:\s+(?:for|of|at)|\s*[-\u2013\u2014:|])?)\s+/i;
const AFFIX_SUFFIX = /(?:^|[\s\-\u2013\u2014|:_]+)(?:(?:(?:support\s+)?staff|faculty|intern(?:ship)?s?|students?|executive|experienced|professionals?|additional|official|training|campus|graduate|hourly|salaried|corporate|external|internal)\s+)?(?:career\s+opportunit(?:y|ies)|job\s+opportunit(?:y|ies)|employment\s+opportunit(?:y|ies)|opportunities|careers?\s+(?:and|&)\s+culture|jobs?\s+postings?|careers?\s+(?:center|centre)\s+page|careers?\s+(?:site|page|portal|center|centre|section)(?:\s+\d{1,2})?|careers?\s+website|careersite|candidate\s+experience(?:\s+(?:site|page))?|candidate\s+(?:site|page|portal)|(?:jobs?|careers?)\s+(?:and|&)\s+(?:jobs?|careers?|opportunities)|career|careers|jobs?\s+(?:center|centre)|jobs?(?:\s+portal)?|jobs?\s+board|job\s+openings|jobs?\s+listings?|employment\s+(?:portal|site|page|center|centre)|openings|positions|vacancies|talent\s+community)\s*$/i;
/**
 * In a label field, the tags a vendor's admin screen appends to an asset's
 * name: a version ("NEW", "V2"), a date ("2022", "01/13/2023", "051816"), a
 * brand-asset word ("Branding", "Refresh", "updates"). They come off, and
 * what remains is judged as a name ("CareOne Group NEW" is CareOne Group,
 * "Westminster Brand 051816" is Westminster, "2024 New" is nothing).
 */
const LABEL_TAG_TAIL = /(?:^|[\s\-\u2013\u2014|:_/(]+)(?:new|old|v\d+|copy|draft|updated?|updates|brand|branding|rebrand(?:ing)?|refresh|seasonal|hourly|salaried|interns?|internships?|volunteers?|open|all|all\s+(?:groups|locations|divisions|brands|companies)|current|minimal|templates?|external|internal|english|french|spanish|german|italian|portuguese|dutch|polish|chinese|japanese|korean|arabic|fran[c\u00e7]ais|espa[n\u00f1]ol|deutsch|19[89]\d|20[0-4]\d|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2}|\d{6,8})\)?\s*$/i;
/** A region tag after a separator ("Barnes - US", "Store Opportunities - Canada"). */
/**
 * In a label field, the words a board's label puts after the employer's name
 * to say what the board is for: "Scottish Government Recruitment", "Yanfeng
 * Human Resources", "AICC Internal Site", "Howmet Aerospace Intern Site",
 * "New Courtesy Posting Site". In a company-name field "Robbins Recruiting"
 * is the agency's own name, so they come off only in a label field.
 */
const LABEL_PURPOSE_TAIL = /(?:^|[\s\-\u2013\u2014|:_]+)(?:(?:campus|corporate|global|internal|external)\s+)?(?:recruit(?:ing|ment)(?:\s+(?:team|page|portal|site|centre|center|department))?|human\s+resources?(?:\s+(?:team|department))?|talent\s+acquisition(?:\s+team)?|(?:internal|intern|internship|posting|courtesy(?:\s+posting)?|external|external\s+posting|employee)\s+sites?|(?:and|&)\s+(?:its\s+)?(?:related\s+entities|affiliates|subsidiaries|affiliated\s+companies))\s*$/i;
/** In a label field, an audience or office tag in brackets at the end ("Anning-Johnson Co. (field)"). */
const PAREN_TAG = /\s*\((?:field|office|corporate|hourly|salaried|internal|external|all|us|usa|canada|staff|faculty)\)\s*$/i;
/** A joiner a cut left at the end ("Candidate Experience site for"). */
const TRAILING_JOINER = /\s+(?:for|of|at|and|with|to|in|by|&)$/i;
const REGION_TAIL = /\s*[-\u2013\u2014|]\s*(?:us|usa|u\.s\.?|uk|canada|emea|apac|latam|na|global|international|north\s+america|asia(?:\s+pacific)?|europe|latin\s+america|americas|world-?wide)\s*$/i;
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
  // A segment with contact text, or one saying the board is another
  // company's, leaves the whole text to be judged (and refused) as it is.
  if (parts.some((x) => CONTACT.test(x) || OTHER_COMPANY.test(x))) return text;
  // So does a test or template marker in a label field: "Tiffany - SR
  // Testing" is a test site, not Tiffany's board.
  if (opts.fromLabel && parts.some((x) => TEST_SITE.test(x))) return text;
  // A slogan or an award beside the name is not part of it.
  const kept = parts.filter((x) => !isSlogan(x));
  const named = kept.filter((x) => censusName(x, opts).name);
  if (named.length === 1) return named[0];
  return kept.length === 1 ? kept[0] : text;
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
  // Contact text, a web address and a cut-off bracket are judged on the
  // whole text, before any part of it can be cut out as a name.
  for (const early of [CONTACT, LEADING_WWW]) if (early.test(whole)) return { name: "", reason: censusNameReason(whole, opts) ?? "contact text, not a name", raw: whole };
  if (unbalanced(whole)) return { name: "", reason: "cut off mid-name", raw: whole };
  if (opts.fromLabel && (OTHER_COMPANY_TAIL.test(whole) || PLACE_LABEL.test(whole))) return { name: "", reason: censusNameReason(whole, opts) ?? "names another company's property or family", raw: whole };
  let name = nameSegment(whole, opts);
  for (let pass = 0; pass < 8; pass++) {
    let next = tidy(name.replace(COPY_NUMBER, "").replace(AFFIX_PREFIX, "").replace(AFFIX_SUFFIX, "").replace(TRAILING_JOINER, ""));
    if (opts.fromLabel) next = tidy(next.replace(ALL_OF, "$1").replace(LABEL_LEAD, "").replace(REGION_TAIL, "").replace(PAREN_TAG, "").replace(LABEL_TAG_TAIL, "").replace(LABEL_PURPOSE_TAIL, "").replace(/(?<=s)['\u2019]$/, "").replace(TRAILING_JOINER, ""));
    // a lowercase article left in front ("the US Institute of Peace")
    next = next.replace(/^the\s+(?=\p{Lu})/u, "");
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
 * a company-name field by the tools before 2026-10-25: UKG (board label or
 * logo text), Oracle (career-site names), ADP (welcome prose, logo files,
 * posting prose). The census reads their names in label mode.
 */
export const LABEL_NAMED_VENDORS = new Set(["ukg", "oracle", "adp"]);

/**
 * Whether a census hit's name was read from a label field, by the evidence
 * the verifier wrote beside it (a UKG board's own Name, an Oracle SiteName),
 * rather than from a company-name field (a homepage naming itself, an Oracle
 * SeoOrganizationName, welcome prose, an organization record).
 */
export function nameFromLabel(vendor, nameFrom) {
  if (typeof nameFrom === "string" && nameFrom) return /^(?:jobBoard\.Name|SiteName|label)\b/i.test(nameFrom);
  return LABEL_NAMED_VENDORS.has(String(vendor));
}

/** A recruiting word used as the label of an employer's own hiring portal or team. */
const RECRUITING_LABEL = /\b(?:campus|university|college|graduate|student|internal|external|corporate|global)\s+(?:e-?)?recruit(?:ing|ment)\b|\b(?:e-?)?recruit(?:ing|ment|er)s?\s+(?:portal|team|system|site|page|department|dept|office|centre|center|platform|board|template)\b|\be-recruitment\b/gi;

/**
 * The text of a name that the staffing-vocabulary screen may read, or "" when
 * no word of it may count (a label as a whole names no business).
 *
 * ONLY WHAT A LABEL FIELD ADDS IS TAKEN OUT (the review, 2026-10-26). A name
 * read from a label field (`nameFrom`, or by default a catalogue name of a
 * label-named vendor) is read as the census reads a label: the board's
 * purpose comes off ("Calamos Recruiting" is Calamos, "ENBD Recruitment
 * Team" is ENBD) and the name that remains IS screened, so "Avant Staffing
 * Professionals" stays a staffing agency. A name from a company-name field (a
 * homepage naming itself, an Oracle SeoOrganizationName, welcome prose) is
 * screened as it stands. Exempting the three vendors wholesale let a name
 * like "Acme Staffing Services" through unflagged on any of them. In both, an
 * employer's own recruiting portal is a department: "mthree Recruiting
 * Portal" is screened as "mthree".
 */
export function agencyScreenText(vendor, name, { nameFrom } = {}) {
  const n = tidy(name);
  if (!n) return "";
  const base = nameFromLabel(vendor, nameFrom) ? censusName(n, { fromLabel: true }).name : (censusNameReason(n) ? "" : n);
  if (!base) return "";
  return base.replace(RECRUITING_LABEL, " ").replace(/\s+/g, " ").trim();
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

/**
 * Hosts that are never an employer's own site: the vendor, social networks,
 * job sites, shorteners, a certification badge's site (a footer linking
 * Great Place To Work named TDC's board after it) and a league's site, whose
 * teams live under its domain (houston.astros.mlb.com named the Astros
 * "MLB.com"; the review, 2026-10-26).
 */
const NOT_EMPLOYER_HOST = /(?:^|\.)(?:ultipro\.com|ukg\.com|ultimatesoftware\.com|linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|youtu\.be|vimeo\.com|glassdoor\.com|indeed\.com|google\.com|goo\.gl|forms\.gle|bit\.ly|tinyurl\.com|adp\.com|oraclecloud\.com|ashbyhq\.com|squarespace\.com|squarespace-cdn\.com|wixstatic\.com|buttercms\.com|cloudfront\.net|amazonaws\.com|googleusercontent\.com|sharepoint\.com|hubspotusercontent[\w-]*\.net|e-verify\.gov|uscis\.gov|dol\.gov|eeoc\.gov|greatplacetowork\.com|greatplacetowork\.[a-z.]+|topworkplaces\.com|bestplacestowork\.org|comparably\.com|builtin\.com|equest\.com|mlb\.com|milb\.com|nba\.com|wnba\.com|nfl\.com|nhl\.com|mlssoccer\.com|nwslsoccer\.com|ncaa\.com|icims\.com|jobvite\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|bamboohr\.com|paylocity\.com|paycomonline\.net)$|^(?:cdn|static|assets|media|img|images)\d*\./i;

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

/** The registrable domain of a host: careers.acme.co.uk -> acme.co.uk, www.axiawh.com -> axiawh.com. */
function registrable(host) {
  const parts = String(host).toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return parts.join(".");
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const n = parts.length >= 3 && tld.length === 2 && /^(?:co|com|org|net|ac|gov|edu|or|ne)$/.test(sld) ? 3 : 2;
  return parts.slice(-n).join(".");
}

/**
 * Whether a census read may follow a redirect from one page to the next: only
 * over http(s), and only within the same registrable domain (axiawh.com to
 * www.axiawh.com). An employer's homepage that redirects to another site
 * (signalenergy.com to covolt.com) has left the employer's own words.
 */
export function sameSiteRedirect(fromUrl, toUrl) {
  let from, to;
  try { from = new URL(fromUrl); to = new URL(String(toUrl ?? ""), from); } catch { return false; }
  if (!/^https?:$/.test(to.protocol)) return false;
  return registrable(from.hostname) === registrable(to.hostname);
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
  // Only the abbreviation after the digits is evidence. The three letters in
  // front are the name's first syllable, which any name can share: they let
  // "Diversified Careers - Maine Roots. Global Opportunities." (and would
  // let "Divine Bakery") stand for DIV1004DIVHO (the review, 2026-10-26).
  // The abbreviation often ends in the legal form's letter, which the board
  // Name leaves off: RMI is Redner's Markets Inc, CONPC Continental
  // Properties Company.
  const abbr = m[2].toLowerCase();
  if (abbr.length < 2) return false;
  const forms = abbr.length >= 3 && /[icl]$/.test(abbr) ? [abbr, abbr.slice(0, -1)] : [abbr];
  const words = wordsOf(name).map((w) => w.replace(/'/g, "")).filter((w) => w && !NAME_STOP.has(w));
  const initials = words.map((w) => w[0]).join("");
  return forms.some((f) => initials === f || (f.length >= 3 && nameAgreesWithLabel(name, f)));
}

/**
 * The name a homepage gives itself, cut to the segment that names its own
 * domain ("RREMC Restaurants | American ..."), and only when it agrees with
 * that domain. A homepage name that does not spell the domain is another
 * organisation's (a badge, a parent, a page the site redirected to), so the
 * board is left unnamed (the review, 2026-10-26).
 */
function siteNameFor(siteName, host) {
  const whole = censusName(siteName, { fromSite: true });
  const parts = String(siteName ?? "").split(/\s+[|\u2013\u2014-]\s+/).map((x) => censusName(x, { fromSite: true }).name).filter(Boolean);
  if (parts.length < 2) return whole.name && nameAgreesWithHost(whole.name, host) ? whole.name : "";
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
  return ranked[0] ?? (whole.name && nameAgreesWithHost(whole.name, host) ? whole.name : "");
}

/**
 * Whether two names plausibly name one employer: a distinctive word in
 * common ("Snell & Wilmer Business" and "Law Offices of Snell & Wilmer"), or
 * one spelled by the other's initials ("WES", "World Education Services").
 */
function namesAgree(a, b) {
  const wordsA = wordsOf(a).map((w) => w.replace(/'/g, "")).filter((w) => w && !NAME_STOP.has(w));
  const wordsB = wordsOf(b).map((w) => w.replace(/'/g, "")).filter((w) => w && !NAME_STOP.has(w));
  if (!wordsA.length || !wordsB.length) return false;
  const distinctive = new Set(wordsB.filter((w) => w.length >= 3 && !COMMON_NAME_WORDS.has(w) && !LABEL_WORDS.has(w)));
  if (wordsA.some((w) => distinctive.has(w))) return true;
  const initialsA = wordsA.map((w) => w[0]).join("");
  const initialsB = wordsB.map((w) => w[0]).join("");
  return (initialsA.length >= 2 && initialsA === wordsB.join("")) || (initialsB.length >= 2 && initialsB === wordsA.join(""));
}

export function pickUkgName({ boardName, footerUrl, siteName, tenant = "" }) {
  const host = employerHost(footerUrl);
  const board = censusName(boardName, { fromLabel: true });
  // A board Name is never taken on its own say-so: the employer's footer
  // domain or the tenant code UKG built from its legal name must agree with
  // it. With no footer link, "eQuest" named OCI Alabama (the review,
  // 2026-10-26).
  if (board.name && host && nameAgreesWithHost(board.name, host)) return { name: board.name, evidence: `jobBoard.Name, agrees with ${host}` };
  if (board.name && nameAgreesWithTenant(board.name, tenant)) return { name: board.name, evidence: `jobBoard.Name, agrees with tenant ${tenant}${host ? "" : " (no footer link)"}` };
  const site = host ? siteNameFor(siteName, host) : "";
  // The homepage stands in for a board Name that is a label. When the board
  // Name IS a name and the homepage names someone else, the footer may point
  // at a parent ("CedarCreek Estate Winery" on markanthony.com, whose page
  // names The Mark Anthony Group of Companies): which one employs the
  // board's hires is for a person, so neither is written (the review,
  // 2026-10-26).
  if (site && board.name && !namesAgree(board.name, site)) {
    return { name: "", evidence: `jobBoard.Name "${board.raw}" and ${host}'s own name "${site}" name different organisations; review` };
  }
  if (site) return { name: site, evidence: `${host} names itself` };
  const why = board.name
    ? `jobBoard.Name "${board.raw}" agrees with neither ${host || "a footer link (there is none)"} nor tenant ${tenant || "(none)"}`
    : `jobBoard.Name "${board.raw}": ${board.reason}`;
  return { name: "", evidence: host ? `${why}; ${host} gave no name that agrees with it` : why };
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
 * An Ashby board's name. The organization record's name wins when it plainly
 * names the board's own slug's employer.
 *
 * WHEN THE TWO DISAGREE, NEITHER IS WRITTEN OVER THE OTHER (the review,
 * 2026-10-26). Which one is the employer's name cannot be told from the page:
 * "OnePay" on oneapp and "ChipAgents" on alpha-design-ai-inc are the brands
 * and the slugs are stale, while "Armitage Labs" on creem is the legal
 * entity. Writing the slug replaced eleven correct catalogue names. So the
 * catalogue's name (`known`) stands where there is one, and a new board is
 * left unnamed for a person, with both candidates in the evidence.
 *
 * With no organization record the catalogue's name stands when the census
 * rule passes it, and otherwise the slug made readable is the name, unless
 * it keeps a label word ("Aso Careers" is a slug, not a name).
 */
export function pickAshbyName(orgName, slug, known = "") {
  const prettify = (t) => String(t).replace(/^eu~/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim().slice(0, 60);
  const org = String(orgName ?? "").trim();
  const kept = String(known ?? "").trim();
  const keptOk = !!kept && !censusNameReason(kept);
  if (org && nameAgreesWithSlug(org, slug)) return { name: org.slice(0, 60), from: "organization.name" };
  // A slug that names no one (a generated id, or nothing but label words and
  // hex: "jobs-page-4dc2685b-...") is no evidence against the record.
  const slugWords = wordsOf(prettify(slug));
  const slugNamesNoOne = /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(slug)) || slugWords.every((w) => LABEL_WORDS.has(w) || (/^[0-9a-f]+$/.test(w) && /\d/.test(w)));
  if (org && slugNamesNoOne && !censusNameReason(org)) return { name: org.slice(0, 60), from: "organization.name (the slug names no one)" };
  if (org) {
    return keptOk
      ? { name: kept, from: `catalogue (organization.name "${org}" does not match the slug "${slug}"; review)` }
      : { name: "", from: `review: organization.name "${org}" does not match the slug "${slug}"` };
  }
  if (keptOk) return { name: kept, from: "catalogue (no organization record)" };
  const fallback = prettify(slug);
  if (wordsOf(fallback).some((w) => LABEL_WORDS.has(w))) return { name: "", from: `slug "${slug}" keeps a label word (no organization record)` };
  return { name: fallback, from: "slug (no organization record)" };
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
    // the prose turns to the reader ("... Brands Careers We're hiring",
    // "Concept Careers Join the Concept family of companies")
    if (/^(?:we|we're|we\u2019re|our|you|your|you're|i|us)$/i.test(tok.replace(/[^\w'\u2019]/g, ""))) break;
    // An instruction verb ends the name only where a sentence follows it
    // ("Join the ..."): "Pine View Care Center" and "Discover Financial" are names.
    if (kept.length && /^(?:join|apply|start|explore|discover|find|search|view|browse|click|see|learn)$/i.test(tok.replace(/[^\w]/g, ""))
      && /^(?:the|our|us|a|an|your|today|now|here|more|all)$|^\p{Ll}/u.test(toks[i + 1] ?? "")) break;
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

/** Words that, after a possessive, name the page rather than the employer ("Authority's Career Center Page"). */
const PAGE_WORDS = new Set([...LABEL_WORDS, "center", "centre", "website", "family", "home", "homepage", "section", "community"]);
/** A possessor that is plainly an organisation ("Prosperity Bank's", "The Doe Fund's"). */
const ORG_WORD = /\b(?:bank|bancorp|authority|fund|foundation|association|society|council|district|county|city|hospital|center|centre|institute|university|college|school|company|corporation|corp|group|agency|department|services|church|trust|partnership|alliance|league|union|museum|library|network|systems?|america|credit|cooperative|co-op|inc|llc)\b/i;

/**
 * A welcome sentence's possessive ("Welcome to Prosperity Bank's career
 * website"): the page words after it go, and the possessive itself goes when
 * the possessor is plainly an organisation or an acronym ("EDC's"). A name
 * that IS a possessive keeps it ("Trader Joe's", "Denny's").
 */
function withoutPossessive(run) {
  const toks = String(run).split(/\s+/).filter(Boolean);
  const at = toks.findIndex((t) => /['\u2019]s$/i.test(t));
  if (at < 0) return run;
  const rest = toks.slice(at + 1);
  if (rest.length && !rest.every((t) => PAGE_WORDS.has(t.toLowerCase().replace(/[^\p{L}]/gu, "")))) return run;
  const head = toks.slice(0, at + 1).join(" ");
  const base = head.replace(/['\u2019]s$/i, "");
  return ORG_WORD.test(base) || /^[\p{Lu}\d&]{2,6}$/u.test(base) ? base : head;
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
    const run = withoutPossessive(leadingNameRun(m[1].replace(/^the\s+(?=\p{Lu})/u, "")));
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
export function oracleSiteName(site, { institutionOk = false } = {}) {
  const seo = censusName(site?.SeoOrganizationName);
  if (seo.name) return seo.name;
  const label = censusName(site?.SiteName, { fromLabel: true, institutionOk });
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
  const decide = (named, evidence) => {
    const names = [...new Set(named.map((x) => x.name.toLowerCase()))];
    if (names.length > 1) return { status: "ambiguous", names: named.map((x) => x.name) };
    return { status: "resolved", name: named[0].name, activeSite: siteNumber(named[0].site), evidence: `${named.length} ${evidence}` };
  };
  const named = active.map((s) => ({ site: s, name: oracleSiteName(s) })).filter((x) => x.name);
  if (named.length) return decide(named, "active named site(s)");
  // A hospital, a school or a clinic is a part of an employer only beside
  // another named site; as the tenant's only name it is the employer
  // ("Community Hospital", the review 2026-10-26).
  const institutions = active.map((s) => ({ site: s, name: oracleSiteName(s, { institutionOk: true }) })).filter((x) => x.name);
  if (institutions.length) return decide(institutions, "active site(s) named for an institution, the tenant's only name");
  // A NAME ONLY RETIRED SITES CARRY IS A LEAD, NOT A RESOLUTION (the review,
  // 2026-10-26). Honeywell's aerospace tenant kept the pre-spin-off
  // "Honeywell" on its inactive sites; that is another tenant's catalogue
  // name, and this tenant is Honeywell Aerospace. A person decides.
  const retired = list.filter((s) => s?.StatusCode !== "ORA_ACTIVE")
    .map((s) => ({ site: s, name: censusName(s?.SeoOrganizationName).name })).filter((x) => x.name);
  const names = [...new Set(retired.map((x) => x.name.toLowerCase()))];
  if (names.length === 1) {
    return {
      status: "review",
      name: retired[0].name,
      activeSite: siteNumber(active[0] ?? retired[0].site),
      evidence: `SeoOrganizationName of ${retired.length} inactive site(s) (${retired.map((x) => siteNumber(x.site)).join(", ")}); no active site carries a name, so a person decides`,
    };
  }
  if (names.length > 1) return { status: "ambiguous", names: retired.map((x) => x.name) };
  return { status: "unresolved" };
}
