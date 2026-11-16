// Proxy-variable exclusion for employer-side screening (Shortlist).
//
// Facially neutral scoring can still produce disparate impact through proxies
// for protected classes (Title VII / ADEA / ADA / FEHA / LL144). This module
// strips or masks those proxies BEFORE any text reaches the scoring model,
// and returns an audit of exactly which exclusions fired — that audit is
// stored with every evaluation as compliance evidence, so a count is only
// recorded for a replacement that actually happened.
//
// Two failure directions are both discrimination risks:
// - a proxy that survives (an accented or ALL-CAPS name, a contact line);
// - a rule that eats job evidence (CPT coding, "Temple University", hotel
//   accommodations, the next line's employer), which scores the candidate
//   as if the skill were absent.
// So no value class crosses a newline, and identity words are redacted in
// membership or self-description phrasing, never inside an institution name.
//
// The scored text carries one neutral mark, [REDACTED]: the category hidden
// is named only in the audit (S14X-023).

export interface RedactionResult {
  redacted: string;
  exclusionsApplied: Array<{ feature: string; count: number }>;
  /** false when no line read as the candidate's name, so it may have reached the model (S14X-072). */
  nameFound: boolean;
}

type Replacer = string | ((match: string, ...rest: unknown[]) => string | null);

interface Rule {
  feature: string;
  pattern: RegExp;
  /** A string, or a callback returning the replacement (null keeps the match, uncounted). */
  replacement: Replacer;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive source for a phrase, so a rule can keep \p{Lu} case-sensitive. */
function ci(words: string[]): string {
  return "(?:" + words.map((w) =>
    [...w].map((ch) => {
      if (ch === " ") return "[ \\t]+";
      const lo = ch.toLowerCase();
      const up = ch.toUpperCase();
      return lo !== up ? `[${lo}${up}]` : escapeRe(ch);
    }).join("")
  ).join("|") + ")";
}

const MONTHS = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTHS_ANY = MONTHS.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
// A calendar date or a bare year, in the shapes résumés use, months in any case ("March 3, 1958").
const DATE = `(?:\\d{1,4}[./-]\\d{1,2}[./-]\\d{1,4}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS_ANY}\\.?,?\\s+\\d{4}|${MONTHS_ANY}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|${MONTHS_ANY}\\.?,?\\s+\\d{4}|(?:19|20)\\d{2})`;
// A birth date in the site's other languages ("15 mars 1970", "3. März 1970", "15 de marzo de 1970").
const DATE_LOOSE = `(?:${DATE}|\\d{1,2}\\.?(?:[ \\t]+de)?[ \\t]+\\p{L}{3,10}\\.?,?(?:[ \\t]+de)?[ \\t]+(?:19|20)\\d{2})`;
const YEAR_RE = /(?<!\d)(?:19|20)\d{2}(?!\d)|(?<![\p{L}\d])['’]\d{2}(?!\d)/gu;

const US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|PR|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
const US_STATE_NAMES = "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia|Puerto Rico";
// Region codes after "City, " (US, Canada, Australia). The ones that are also
// post-nominals ("Jane Doe, MD") are decided by the segment itself.
const REGION_CODES = `${US_STATES}|AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT|NSW|VIC|QLD|TAS|ACT`;
const CREDENTIAL_REGIONS = new Set(["MD", "MS", "MA", "PA", "DC", "PE"]);
const PLACE_NAMES = new RegExp(`^(?:${US_STATE_NAMES}|Ontario|Quebec|Québec|British Columbia|Alberta|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Newfoundland|New South Wales|Victoria|Queensland|Tasmania|` +
  "USA|U\\.S\\.A?\\.?|US|UK|U\\.K\\.|UAE|United States(?: of America)?|United Kingdom|United Arab Emirates|England|Scotland|Wales|Northern Ireland|Ireland|Canada|Mexico|Brazil|Brasil|Argentina|Chile|Colombia|Peru|Venezuela|Ecuador|Uruguay|" +
  "Spain|España|Portugal|France|Germany|Deutschland|Italy|Italia|Netherlands|Belgium|Switzerland|Austria|Sweden|Norway|Denmark|Finland|Poland|Czechia|Czech Republic|Hungary|Romania|Greece|Turkey|Türkiye|Ukraine|Russia|Israel|" +
  "Egypt|Morocco|Nigeria|Ghana|Kenya|Ethiopia|South Africa|Saudi Arabia|Qatar|Kuwait|Bahrain|Oman|Jordan|Lebanon|Pakistan|India|Bangladesh|Sri Lanka|Nepal|China|Hong Kong|Taiwan|Japan|Korea|South Korea|" +
  "Vietnam|Viet Nam|Thailand|Malaysia|Singapore|Indonesia|Philippines|Australia|New Zealand|" +
  "Maharashtra|Karnataka|Tamil Nadu|Kerala|Telangana|Andhra Pradesh|Gujarat|Rajasthan|Punjab|Haryana|Uttar Pradesh|West Bengal|Madhya Pradesh|Odisha|Bihar|Goa|Delhi|NCR|" +
  "Bavaria|Bayern|Hesse|Hessen|Saxony|Sachsen|Berlin|Hamburg|Catalonia|Catalunya|Cataluña|Andalusia|Andalucía|Madrid|Lombardy|Lombardia|Île-de-France|Ile-de-France|" +
  "São Paulo|Sao Paulo|Minas Gerais|Rio de Janeiro|Jalisco|Nuevo León|Nuevo Leon)\\.?$", "iu");
// Multi-word cities that read like a name when they head the page.
const CITY_NAMES = new Set(("new york|new york city|los angeles|san francisco|san diego|san jose|san antonio|las vegas|salt lake city|kansas city|oklahoma city|" +
  "st. louis|saint louis|st. paul|new orleans|fort worth|el paso|long beach|virginia beach|colorado springs|santa clara|santa monica|santa barbara|" +
  "palo alto|mountain view|redwood city|menlo park|silver spring|jersey city|baton rouge|grand rapids|ann arbor|rio de janeiro|são paulo|sao paulo|" +
  "buenos aires|mexico city|hong kong|kuala lumpur|new delhi|tel aviv|cape town|abu dhabi|ho chi minh city|bay area|washington dc|washington d.c.").split("|"));
// Words that make a "Two Words, MD" segment a town, not a person.
const PLACE_WORD = /^(?:city|springs?|park|heights|beach|falls|hills?|port|fort|ft\.?|mount|mt\.?|lake|bay|harbou?r|haven|village|valley|grove|ridge|creek|point|junction|river|township|station|center|centre|north|south|east|west|new|saint|st\.?|san|santa|los|las|el|college|state)$/i;

// ── Contact details: nothing that identifies or locates the person ─────────
const URL_STOP = "[^\\s|,;<>()\\[\\]\"'·•]";
const CONTACT_RULES: Rule[] = [
  { feature: "email", pattern: /[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu, replacement: "[REDACTED-EMAIL]" },
  { feature: "profile_url", pattern: new RegExp(`(?:https?:\\/\\/|www\\.)${URL_STOP}+`, "giu"), replacement: "[REDACTED-URL]" },
  {
    feature: "profile_url",
    pattern: new RegExp(`(?<![\\p{L}\\p{N}@./-])(?:[a-z0-9-]+\\.)*(?:linkedin|github|gitlab|bitbucket|twitter|x|behance|dribbble|medium|instagram|facebook|stackoverflow|kaggle|about|wellfound|angel|substack|youtube|tiktok|codepen|leetcode|hackerrank|orcid|researchgate|xing|scholar\\.google)\\.(?:com|me|io|net|org|co|social)(?:\\/${URL_STOP}*)?`, "giu"),
    replacement: "[REDACTED-URL]",
  },
  // Telephone numbers: international (+CC), US (NXX) NXX-XXXX, trunk-0, and labelled.
  { feature: "phone", pattern: /(?<![\p{N}\p{L}])\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){1,4}(?!\p{N})/gu, replacement: phoneOrKeep },
  { feature: "phone", pattern: /(?<![\p{N}\p{L}])(?:1[\s.-]?)?\(\d{3}\)\s?\d{3}[\s.-]?\d{4}(?!\p{N})/gu, replacement: "[REDACTED-PHONE]" },
  { feature: "phone", pattern: /(?<![\p{N}\p{L}.-])(?:1[\s.-])?\d{3}[.\s-]\d{3}[.\s-]\d{4}(?!\p{N}|[.-]\d)/gu, replacement: "[REDACTED-PHONE]" },
  { feature: "phone", pattern: /(?<![\p{N}\p{L}.\/-])0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\p{N})/gu, replacement: phoneOrKeep },
  {
    feature: "phone",
    pattern: /(?<!\p{L})(?:(?:phone|tel|telephone|mobile|mob|cell|whatsapp|contact|ph|tél|téléphone|teléfono|telefono|telefone|telefon|móvil|movil|celular|telemóvel|telemovel|portable|handy|mobiel|mobil|gsm)\.?(?:\s*(?:no\.?|number|#|nº))?\s*[:\-–]?|(?:m|t|p|h)\s*:)\s*[+(\d][\d\s().-]{5,18}\d/giu,
    replacement: (m) => {
      const lead = m.match(/^\D*/)?.[0] ?? "";
      return phoneOrKeep(m.slice(lead.length)) === null ? null : `${lead}[REDACTED-PHONE]`;
    },
  },
  // Postcodes: a US ZIP after a state code, UK and Canadian postcodes.
  { feature: "zip_code", pattern: new RegExp(`\\b((?:${US_STATES}|${US_STATE_NAMES})\\.?,?\\s+)\\d{5}(?:-\\d{4})?(?!\\d)`, "g"), replacement: (_m, pre) => `${pre}[REDACTED-ZIP]` },
  { feature: "zip_code", pattern: /(?<!\p{L})((?:zip(?:\s*code)?|postal\s*code|postcode)\s*[:\-–]?\s*)[A-Z0-9][A-Z0-9 -]{2,8}[A-Z0-9](?![\p{L}\p{N}])/giu, replacement: (_m, pre) => `${pre}[REDACTED-ZIP]` },
  { feature: "zip_code", pattern: /\b[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2}\b/g, replacement: "[REDACTED-ZIP]" },
  { feature: "zip_code", pattern: /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/g, replacement: "[REDACTED-ZIP]" },
  // A Japanese postcode carries its own mark.
  { feature: "zip_code", pattern: /〒\s?\d{3}-?\d{4}(?!\d)/gu, replacement: "[REDACTED-ZIP]" },
  // A handle after a platform label ("GitHub: jdoe-dev"); a capitalised word is prose.
  {
    feature: "profile_url",
    pattern: /(?<![\p{L}])((?:github|gitlab|bitbucket|linkedin|twitter|instagram|telegram|skype|discord|kaggle|behance|dribbble|leetcode|hackerrank|codepen|medium|stack\s?overflow)\s*[:：]\s*)(@?[A-Za-z0-9][A-Za-z0-9_.:\/-]{1,60})(?![\p{L}\p{N}])/giu,
    replacement: (_m, pre, handle) => /^\p{Lu}\p{Ll}+$/u.test(String(handle)) || !/\p{L}/u.test(String(handle)) ? null : `${pre}[REDACTED-URL]`,
  },
];

function phoneOrKeep(m: string): string | null {
  const digits = m.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15 ? "[REDACTED-PHONE]" : null;
}

// A bare personal domain ("mariagonzalez.dev") is only treated as contact
// detail in the header block, where it is the candidate's site; in the body
// a lowercase domain is usually a product or employer.
const BARE_DOMAIN = /(?<![\p{L}\p{N}@./-])(?:[a-z0-9-]+\.)*[a-z0-9][a-z0-9-]{2,}\.(?:com|dev|io|me|net|org|co|ai|app|page|site|design|info|xyz|tech|blog|online)(?:\/[^\s|,;<>()]*)?(?![\p{L}\p{N}])/gu;
// In the header block an "@handle" is the candidate's, and so is any run of
// 10 to 15 digits, with or without single separators ("98765 43210").
const HEADER_HANDLE = /(?<![\p{L}\p{N}._@-])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?(?![\p{L}\p{N}@])/gu;
const HEADER_DIGITS = /(?<![\p{L}\p{N}])\+?\d(?:[\s.-]?\d){9,14}(?!\p{N})/gu;
const HEADER_LINES = 8;
// Read only in the header block, above the first section heading, in the
// shapes of the site's own locales: a 9-digit mobile (es, pt), a street
// written number-last or with a Romance word first, and a postcode beside its
// city. In the body the same shapes are metrics and employers.
const STREET_EN = `(?<![\\p{L}\\p{N}])\\d{1,6}[A-Za-z]?\\s+(?:[NSEW]\\.?\\s+)?(?:(?:\\p{Lu}[\\p{L}'’&-]*|\\d{1,4}(?:st|nd|rd|th))\\s+){1,4}(?:${ci(["street", "avenue", "road", "boulevard", "drive", "lane", "court", "place", "terrace", "circle", "parkway", "highway", "square", "trail", "crescent", "close", "way"])}|St|ST|Ave|AVE|Rd|RD|Blvd|BLVD|Dr|DR|Ln|LN|Ct|CT|Pl|PL|Ter|Cir|Pkwy|Hwy|Sq)\\b\\.?(?:,?\\s*(?:${ci(["apt", "apartment", "unit", "suite", "ste", "flat"])}|#)\\.?\\s*[\\w-]+)?`;
const HEADER_RULES: Rule[] = [
  { feature: "street_address", pattern: new RegExp(STREET_EN, "gu"), replacement: "[REDACTED-ADDRESS]" },
  // "Hauptstraße 12", "Keizersgracht 123", "Berliner Straße 4a".
  { feature: "street_address", pattern: /(?<![\p{L}\p{N}])(?:\p{Lu}[\p{L}\p{M}-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|gracht|laan|straat|plein|kade|singel|steeg|dijk|vej|gade|gatan|gata|veien|vegen)|\p{Lu}[\p{L}\p{M}-]*\s+(?:Straße|Strasse|Str\.|Weg|Gasse|Platz|Allee|Ring|Damm|Ufer|Laan|Straat|Plein|Kade))\s+\d{1,4}\s?[A-Za-z]?(?:[-/]\d{1,4})?(?![\p{L}\p{N}])/gu, replacement: "[REDACTED-ADDRESS]" },
  // "12 rue de Rivoli", "28, Calle Mayor".
  { feature: "street_address", pattern: new RegExp(`(?<![\\p{L}\\p{N}])\\d{1,4}(?:\\s?(?:bis|ter|[A-Za-z]))?,?\\s+${ci(["rue", "avenue", "av.", "boulevard", "bd", "chemin", "allée", "impasse", "quai", "cours", "route", "place", "calle", "avenida", "paseo", "rua", "via", "viale", "corso", "piazza"])}\\s+[^\\n,|·•;]{1,40}?(?=\\s*(?:[,|·•;]|$))`, "gmu"), replacement: "[REDACTED-ADDRESS]" },
  // "Calle Gran Vía 28", "Rua Augusta, 100", "Via Roma 10, 3º B".
  { feature: "street_address", pattern: /(?<![\p{L}])(?:Calle|C\/|Avenida|Avda\.?|Av\.|Paseo|Plaza|Pza\.|Carrer|Rua|Travessa|Largo|Alameda|Via|Viale|Corso|Piazza|Rue|Avenue|Boulevard)\s+[^\n,|·•;\d]{1,40}?,?\s*(?:n[º°o.]\s*)?\d{1,4}[A-Za-z]?(?![\p{L}\p{N}])(?:\s*,\s*\d{1,2}\s*[º°ª]\s*[A-Za-z]?(?![\p{L}]))?/gu, replacement: "[REDACTED-ADDRESS]" },
  // "Flat 4B", "House No. 12", "Piso 3".
  { feature: "street_address", pattern: /(?<![\p{L}])(?:Flat|Apt\.?|Apartment|House\s+No\.?|H\.\s?No\.?|Plot\s+No\.?|Door\s+No\.?|Piso|Wohnung|Appartement)\s*#?\s*[A-Za-z]?\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?(?![\p{L}\p{N}])/gu, replacement: "[REDACTED-ADDRESS]" },
  // A street with no number, as its own segment of a header line ("MG Road").
  { feature: "street_address", pattern: /(?<=^|[,|·•;]\s*)(?:\p{Lu}[\p{L}.'’-]*\s+){1,3}(?:Road|Street|Marg|Nagar|Layout|Colony|Lane|Avenue)(?=\s*(?:[,|·•;]|$))/gmu, replacement: "[REDACTED-ADDRESS]" },
  // A 9-digit number in 3-3-3 or 3-2-2-2 groups ("612 345 678").
  { feature: "phone", pattern: /(?<![\p{L}\p{N}+.,-])\d{3}([ .-])(?:\d{3}\1\d{3}|\d{2}\1\d{2}\1\d{2})(?!\p{N}|[ .-]\d)/gu, replacement: "[REDACTED-PHONE]" },
  // Postcodes: AU "NSW 2000", NL "1015 CJ", a 6-digit PIN after its city, five digits beside a city, four (never a year) before one.
  { feature: "zip_code", pattern: /(?<![\p{L}])((?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\.?,?[ \t]+)\d{4}(?!\d)/gu, replacement: (_m, pre) => `${pre}[REDACTED-ZIP]` },
  { feature: "zip_code", pattern: /(?<![\p{L}\p{N}.,$€£-])[1-9]\d{3}[ \t]?(?!SA|SD|SS|GB|MB|KB|TB|AM|PM|BC|AD)[A-Z]{2}(?![\p{L}\p{N}])/gu, replacement: "[REDACTED-ZIP]" },
  { feature: "zip_code", pattern: /(\p{Lu}\p{Ll}+[ \t]*[,–-]?[ \t]*)[1-9]\d{2}[ \t]?\d{3}(?![\p{N}])/gu, replacement: (_m, pre) => `${pre}[REDACTED-ZIP]` },
  { feature: "zip_code", pattern: /(?<![\p{L}\p{N}.,$€£-])\d{5}(?=[ \t]+\p{Lu}\p{Ll})|(?<=\p{Lu}\p{Ll}+[ \t]+)\d{5}(?![\p{N}])/gu, replacement: "[REDACTED-ZIP]" },
  { feature: "zip_code", pattern: /(?<![\p{L}\p{N}.,$€£-])(?!(?:19|20)\d{2})[1-9]\d{3}(?=[ \t]+\p{Lu}\p{Ll})/gu, replacement: "[REDACTED-ZIP]" },
];
// Whole-line section headings in German, French, Spanish, Portuguese, Dutch,
// Chinese, Japanese and Korean (S14X-022, S14X-105): a whole line only, so
// "Ausbildung zum Fachinformatiker, IHK Berlin" is still a line of evidence.
const LOCAL_EDU = /^(?:ausbildung|bildung|bildungsweg|schulbildung|studium|akademische[ \t]+ausbildung|formation(?:[ \t]+acad[ée]mique)?|[ée]ducation|[ée]tudes|formaci[óo]n(?:[ \t]+acad[ée]mica)?|educaci[óo]n|forma[çc][ãa]o(?:[ \t]+acad[êe]mica)?|educa[çc][ãa]o|opleiding(?:en)?|教育背景|教育经历|教育經歷|学歴|学历|학력)$/iu;
const LOCAL_HEADING = /^(?:berufserfahrung|beruflicher[ \t]+werdegang|werdegang|praxiserfahrung|kenntnisse|f[äa]higkeiten|sprachen|sprachkenntnisse|interessen|hobbys|exp[ée]riences?(?:[ \t]+professionnelles?)?|comp[ée]tences|langues|centres[ \t]+d['’]int[ée]r[êe]t|experiencia(?:[ \t]+(?:laboral|profesional))?|habilidades|idiomas|experi[êe]ncia(?:[ \t]+profissional)?|compet[êe]ncias|werkervaring|vaardigheden|talen|工作经[历验]|工作經歷|项目经[历验]|实习经历|自我评价|自我介绍|专业技能|技能特长|获奖情况|求职意向|職歴|職務経歴|資格|免許・資格|自己PR|志望動機|경력|자기소개)$/iu;
const isLocalHeading = (t: string) => LOCAL_HEADING.test(t) || LOCAL_EDU.test(t);
// A section heading ends the header block; a contact heading does not.
const CONTACT_HEADING = /(?<![\p{L}])(?:contact\p{L}*|kontakt|contato|personal|persönlich\p{L}*|details|address|adresse|dirección|endereço|coordonnées|información|informações|information|datos)(?![\p{L}])/iu;
function endsHeader(line: string): boolean {
  const t = line.trim().replace(/[:：\s]+$/, "");
  if (t.length === 0 || t.length > 40 || /[\d|·•,@]/.test(t) || CONTACT_HEADING.test(t)) return false;
  if (isLocalHeading(t)) return true;
  const words = t.split(/\s+/);
  if (words.length > 4) return false;
  const last = words[words.length - 1];
  return SECTION_WORDS.test(last) || EDU_HEADING.test(last);
}

// ── The candidate's name ───────────────────────────────────────────────────
const PARTICLES = new Set(["de", "da", "del", "della", "der", "den", "di", "du", "dos", "das", "la", "le", "van", "von", "bin", "binti", "bint", "al", "el", "y", "e", "ter", "ten", "ibn", "st.", "mac"]);
// Words that make a line a heading or a job title, never a name.
const NOT_NAME = new Set(("resume résumé cv curriculum vitae profile summary contact information details personal objective " +
  "experience education skills references portfolio page confidential senior junior lead principal staff chief head " +
  "software engineer engineering developer development manager management director analyst analytics consultant specialist " +
  "coordinator assistant associate administrator administrative nurse nursing registered designer design scientist science " +
  "data product project program marketing sales account accounting accountant executive officer president vice intern " +
  "technician teacher professor lecturer representative architect full stack frontend backend web mobile cloud devops " +
  "quality operations business financial finance human resources customer service support success graphic research " +
  "researcher medical clinical legal paralegal attorney lawyer certified licensed professional practitioner therapist " +
  "physician pharmacist supervisor owner founder partner recruiter writer editor student graduate candidate career " +
  "phone email mobile address linkedin github website available upon request street avenue road city state core " +
  "competencies key highlights achievements accomplishments qualifications technical areas expertise about overview " +
  "background interests hobbies languages certifications awards projects publications volunteer activities employment " +
  "history work training courses coursework relevant selected additional other honors affiliations memberships " +
  "leadership strengths tools technologies inc llc ltd corp gmbh plc").split(" "));
// Credentials and suffixes that trail a name ("Jane Doe, PMP", "JANE DOE RN").
const CREDENTIAL = /^(?:pmp|mba|rn|bsn|msn|cpa|phd|ph\.?d\.?|md|m\.d\.|do|jd|j\.d\.|esq\.?|cfa|cissp|pe|p\.e\.|shrm-c?s?cp|phr|sphr|csm|ms|m\.s\.|ma|m\.a\.|ba|b\.a\.|bs|b\.s\.|msc|bsc|mph|msw|lcsw|np|pa-c|dds|dmd|pharmd|lpn|cna|emt|acca|cma|cisa|ccna|ceng|frcs|mrcp|jr\.?|sr\.?|ii|iii|iv|cpsm|cscp|six|sigma)$/i;
const NAME_TOKEN = /^(?:\p{Lu}[\p{L}\p{M}'’.-]*|\p{Lu}\.)$/u;
const CASELESS_TOKEN = /^[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Bengali}\p{Script=Tamil}\p{M}]+$/u;
const CJK = "[\\p{Script=Han}\\p{Script=Hangul}\\p{Script=Hiragana}\\p{Script=Katakana}]";
const CJK_NAME = new RegExp(`^${CJK}(?:[ \\t\\u3000]?${CJK}){1,3}$`, "u");
// A CJK title, heading or labelled line reads like a name and never is one (S14X-105).
const CJK_NOT_NAME = /^(?:(?:个人|求职)?简历|履歴書|職務経歴書|工作经[历验]|项目经[历验]|实习经历|教育(?:背景|经历)|自我评价|(?:基本|个人)信息|求职意向|专业技能|技能特长|获奖情况|联系方式|学歴|職歴|이력서|자기소개서|경력|학력|(?:国籍|性[别別]|民族|籍贯|年[龄齢]|出生|婚姻|宗教|政治面貌|生年月日|配偶者|扶養家族|住所|电话|電話|邮箱).*)$/u;
// A job title is not a name: "软件工程师", "项目经理", "営業部長".
const CJK_ROLE = /(?:师|師|员|員|经理|經理|主管|总监|總監|专员|助理|顾问|顧問|会计|會計|医生|醫生|护士|老师|教授|部長|課長|社長|社員)$/u;
const HONORIFIC_PREFIX = /^(?:dr|prof|mr|mrs|ms|mx|miss|sir|dame|rev)\.?\s+/i;

interface FoundName { name: string; aliases: string[] }

const labelOf = (l: string) => l.match(/^(?:(?:full\s+)?name\s*[:\-–：]|(?:姓|氏)[ \t　]*名[ \t　]*[:：]?|お?名[ \t　]*前[ \t　]*[:：]?|(?:이[ \t]*름|성[ \t]*명)[ \t]*[:：]?)[ \t　]*(.+)$/iu)?.[1];

/**
 * The candidate's name from the header block (every line of it, S14X-072), or
 * a file name's words when the text holds them; null when nothing reads as one.
 */
function findName(text: string, hint?: string): FoundName | null {
  const all = text.split("\n");
  const head = all.slice(0, headerLineCount(text)).filter((l) => l.trim()).length;
  const lines = all.map((l) => l.trim()).filter((l) => l.length > 0).slice(0, Math.max(6, head));
  for (let i = 0; i < lines.length; i++) {
    const found = readLine(labelOf(lines[i]) ?? lines[i], i);
    if (found) return found;
  }
  for (const line of text.split("\n")) {
    const labelled = labelOf(line.trim());
    if (labelled) {
      const found = readLine(labelled, 0);
      if (found) return found;
    }
  }
  // "Senior Software Engineer | Jane Doe": read only when no line led with a name.
  for (const line of lines) {
    const flat = line.replace(/[ \t]+/g, " ");
    const segs = flat.split(HARD_SPLIT);
    if (segs.length < 2 || !segs[0].split(/\s+/).some((t) => NOT_NAME.has(t.toLowerCase().replace(/[.,:]$/, "")))) continue;
    const at = flat.indexOf(segs[1], segs[0].length);
    const name = at < 0 ? null : nameFromLine(flat.slice(at), HARD_SPLIT, { cut: true, employer: true });
    if (name) return { name, aliases: [] };
  }
  return hint ? hintName(text, hint) : null;
}

const HINT_JUNK = /^(?:resume|résumé|cv|curriculum|vitae|lebenslauf|curr[ií]culo|final|updated?|new|copy|draft|version|v)$/i;
/** "Jane_Okafor_CV.pdf": two to four of its words, each written in the text, as the text writes them. */
function hintName(text: string, hint: string): FoundName | null {
  const words = hint.replace(/\.[a-z0-9]{2,5}$/i, "").split(/[_\-.\s]+/)
    .filter((w) => letters(w) >= 2 && !/\d/.test(w) && !HINT_JUNK.test(w) && !NOT_NAME.has(w.toLowerCase()));
  if (words.length < 2 || words.length > 4) return null;
  const seen: string[] = [];
  for (const w of words) {
    const m = text.match(new RegExp(`(?<![\\p{L}\\p{M}])${tokenSource(w, "any")}(?![\\p{L}\\p{M}])`, "iu"));
    if (!m) return null;
    seen.push(m[0]);
  }
  return { name: seen.join(" "), aliases: [] };
}

// Separators that end a name. The first reading also splits on a tab or a
// run of spaces (columns: "Jane Doe     Engineer"); the second reads a
// letter-spaced header ("CARLOS   MENDES", "Maria\tGonzalez") with each
// whitespace run as one space, and only real separators split.
const SEG_SPLIT = /\s*(?:[|·•\t]|\s[-–—/]\s|,|\s{2,}|\()\s*/u;
const HARD_SPLIT = /\s*(?:[|·•]|\s[-–—/]\s|,|\()\s*/u;
const letters = (t: string) => t.replace(/[.'’-]/g, "").length;
const isUpper = (s: string) => { const l = s.replace(/[^\p{L}]/gu, ""); return l.length > 0 && l === l.toUpperCase() && l !== l.toLowerCase(); };
// Words that make a segment after a title an employer, not a person.
const EMPLOYER_WORD = new Set(("labs lab group systems solutions technologies technology tech partners capital bank health healthcare " +
  "consulting holdings ventures studio studios media networks software global international industries enterprises company " +
  "agency institute university college school hospital clinic payments digital interactive games motors energy pharma " +
  "therapeutics biosciences insurance logistics robotics ai remote hybrid onsite contract freelance").split(" "));

const LATIN_CJK = new RegExp(`^(\\p{Lu}[\\p{L}'’-]+(?:[ \\t]+\\p{Lu}[\\p{L}'’-]+){1,3})[ \\t]+(${CJK}(?:[ \\t\\u3000]?${CJK}){1,3})$|^(${CJK}(?:[ \\t\\u3000]?${CJK}){1,3})[ \\t]+(\\p{Lu}[\\p{L}'’-]+(?:[ \\t]+\\p{Lu}[\\p{L}'’-]+){1,3})$`, "u");

function readLine(line: string, index: number): FoundName | null {
  // "Wang Xiaoming 王小明": both forms are the name.
  const mix = line.match(LATIN_CJK);
  if (mix) {
    const latin = nameFromLine(mix[1] ?? mix[4], SEG_SPLIT, { index });
    const cjk = (mix[2] ?? mix[3]).replace(/\s+/g, "");
    if (latin && !CJK_NOT_NAME.test(cjk) && !isLocalHeading(cjk) && !CJK_ROLE.test(cjk)) return { name: latin, aliases: [cjk] };
  }
  const { line: plain, aliases } = liftNickname(line);
  const name = nameFromLine(plain, SEG_SPLIT, { index }) ??
    nameFromLine(plain.replace(/[ \t]+/g, " "), HARD_SPLIT, { index, cut: true });
  return name ? { name, aliases } : null;
}

/** "Elizabeth (Liz) Warren", 'Robert "Bob" Jones': the bracketed word is the name too. */
function liftNickname(line: string): { line: string; aliases: string[] } {
  const hon = line.match(HONORIFIC_PREFIX)?.[0] ?? "";
  const body = line.slice(hon.length);
  const m = body.match(/^(\p{Lu}[\p{L}\p{M}'’.-]*(?:[ \t]+\p{Lu}[\p{L}\p{M}'’.-]*)?)[ \t]+[("“‘']\s*(\p{Lu}[\p{L}\p{M}'’-]+)\s*[)"”’'][ \t]+(?=\p{Lu})/u);
  if (!m) return { line, aliases: [] };
  const nick = m[2];
  if (letters(nick) < 2 || CREDENTIAL.test(nick) || NOT_NAME.has(nick.toLowerCase()) || PLACE_NAMES.test(nick)) return { line, aliases: [] };
  return { line: `${hon}${m[1]} ${body.slice(m[0].length)}`, aliases: [nick] };
}

/** A trailing token is a post-nominal only when it cannot be a surname ("Jack Ma", "Anh Do"). */
function isTrailingCredential(tok: string, tokens: string[], allCaps: boolean): boolean {
  if (/^(?:resume|résumé|cv)$/i.test(tok)) return true;
  if (!CREDENTIAL.test(tok)) return false;
  const remaining = tokens.slice(0, -1).filter((t) => !PARTICLES.has(t.toLowerCase()) && letters(t) >= 2).length;
  if (allCaps) return remaining >= 2;
  if (tok.includes(".")) return true;
  if (/^\p{Lu}\p{Ll}$/u.test(tok)) return false;
  return true;
}

/** "Boston, MA", "New York, NY 10001", "Rio de Janeiro, Brazil" head a page as often as a name does. */
function isPlace(seg: string, rest: string): boolean {
  if (CITY_NAMES.has(seg.toLowerCase().replace(/\s+/g, " "))) return true;
  const after = rest.match(/^\s*,\s*([^,|·•\t(]+?)\s*(?=$|[,|·•\t(]|\s[-–—/]\s|\s{2,})/u)?.[1];
  if (!after) return false;
  if (PLACE_NAMES.test(after)) return true;
  const code = after.match(new RegExp(`^(${REGION_CODES})\\.?(\\s+\\d{4,5}(?:-\\d{4})?)?$`));
  if (!code) return false;
  if (code[2] || !CREDENTIAL_REGIONS.has(code[1])) return true;
  // "Jane Doe, MD" is a doctor; "Silver Spring, MD" is a town.
  return seg.split(/\s+/).some((t) => PLACE_WORD.test(t));
}

// "Sydney NSW 2000", "Austin TX": a town, a region code, maybe a postcode, no comma.
const REGION_TAIL = new RegExp(`^\\p{Lu}[\\p{L}.'’ -]*\\s(?:(?:${REGION_CODES})\\.?\\s+\\d{4,5}(?:-\\d{4})?|(?!${[...CREDENTIAL_REGIONS].join("|")})(?:${REGION_CODES}))$`, "u");
const notGiven = (t: string) => NOT_NAME.has(t.toLowerCase()) || CREDENTIAL.test(t) || PLACE_NAMES.test(t) || new RegExp(`^(?:${REGION_CODES})$`).test(t);

/** "GONZALEZ, Maria", "Gonzalez, Maria", "DOE, JANE": a surname, a comma, then the given name. */
function surnameFirst(surname: string, rest: string, index: number): string | null {
  if (letters(surname) < 2 || !NAME_TOKEN.test(surname) || notGiven(surname) || CITY_NAMES.has(surname.toLowerCase())) return null;
  const m = rest.match(/^\s*,\s*(\p{Lu}[\p{L}\p{M}'’-]+(?:\s+\p{Lu}[\p{L}\p{M}'’.-]*)?)\s*(?=$|[,|·•\t(]|\s[-–—/]\s|\s{2,})/u);
  if (!m) return null;
  const given = m[1];
  const parts = given.split(/\s+/);
  if (parts.some(notGiven) || PLACE_NAMES.test(given)) return null;
  if (isUpper(surname)) {
    // An ALL-CAPS surname takes a title-case or an ALL-CAPS given name.
    if (!isUpper(given) && !/^\p{Lu}\p{Ll}/u.test(given)) return null;
  } else {
    // A title-case surname: only on the page's first lines, never in a list ("Python, Java, SQL").
    if (index > 1 || isUpper(given) || !/^\p{Lu}\p{Ll}/u.test(given)) return null;
    const next = rest.slice(m[0].length).match(/^\s*,\s*([^,|·•\t(]+)/u)?.[1]?.trim();
    if (next && !next.split(/\s+/).every((t) => CREDENTIAL.test(t))) return null;
  }
  return `${given} ${surname}`;
}

function nameFromLine(line: string, split: RegExp, opts: { index?: number; cut?: boolean; employer?: boolean } = {}): string | null {
  // The first segment before a separator: "Jane Doe | Engineer", "Jane Doe, PMP".
  let seg = line.split(split)[0].trim();
  const rest = line.slice(line.indexOf(seg) + seg.length);
  if (isPlace(seg, rest) || REGION_TAIL.test(seg)) return null;
  seg = seg.replace(/^(?:(?:resume|résumé|cv|curriculum vitae)\s+(?:of|for|[-–:])\s+)/i, "");
  seg = seg.replace(HONORIFIC_PREFIX, "");
  let tokens = seg.split(/\s+/).filter(Boolean);
  // A header read as one line ends the name at the first title word or digit.
  if (opts.cut) {
    const stop = tokens.findIndex((t) => /\d/.test(t) || NOT_NAME.has(t.toLowerCase().replace(/[.,:]$/, "")));
    if (stop >= 0) tokens = tokens.slice(0, stop);
  }
  const allCaps = isUpper(tokens.join(" "));
  while (tokens.length > 0 && isTrailingCredential(tokens[tokens.length - 1], tokens, allCaps)) tokens = tokens.slice(0, -1);
  if (tokens.length === 0) return null;
  const joined = tokens.join(" ");
  if (CJK_NAME.test(joined)) {
    const compact = joined.replace(/\s+/g, "");
    return CJK_NOT_NAME.test(compact) || isLocalHeading(compact) || CJK_ROLE.test(compact) ? null : joined;
  }
  if (tokens.length === 1) return surnameFirst(tokens[0], rest, opts.index ?? 0);
  if (/\d/.test(joined)) return null;
  const core = tokens.filter((t) => !PARTICLES.has(t.toLowerCase()));
  if (core.length < 2 || core.length > 5) return null;
  if (!core.every((t) => NAME_TOKEN.test(t) || CASELESS_TOKEN.test(t))) return null;
  // Two full words, or initials and one ("J. R. Smith").
  const full = core.filter((t) => letters(t) >= 2).length;
  if (full < 2 && !(full === 1 && core.every((t) => letters(t) >= 2 || /^\p{Lu}\.$/u.test(t)))) return null;
  if (tokens.some((t) => NOT_NAME.has(t.toLowerCase().replace(/[.,:]$/, "")))) return null;
  if (opts.employer && tokens.some((t) => EMPLOYER_WORD.has(t.toLowerCase().replace(/[.,:]$/, "")))) return null;
  return joined;
}

// Accent-folding classes so "García" also masks "Garcia" (and the reverse).
const FOLD: Record<string, string> = {
  a: "aàáâãäåāăąǎạảấầẩẫậắằẳẵặ", c: "cçćčĉċ", d: "dďđ", e: "eèéêëēĕėęěẹẻẽếềểễệ", g: "gğĝġģ",
  i: "iìíîïĩīĭįıỉị", l: "lĺļľŀł", n: "nñńņň", o: "oòóôõöøōŏőơọỏốồổỗộớờởỡợ", r: "rŕŗř",
  s: "sśŝşšș", t: "tţťț", u: "uùúûüũūŭůűųưụủứừửữự", y: "yýÿŷỳỵỷỹ", z: "zźżž",
};
const FOLD_OF = new Map<string, string>();
for (const [, set] of Object.entries(FOLD)) for (const ch of set) FOLD_OF.set(ch, set);

// Name tokens that are also everyday words are masked only when capitalised,
// so "Will Brown" does not turn every "will" into a marker.
const COMMON_WORDS = new Set(("will may mark bill grace hope faith joy rose young king long brown green white black gray grey " +
  "rich price page case chase hunter mason cook baker miller fisher carter walker park hall bell stone wood field lane hill " +
  "ford frank sterling pierce drew art dean major summer dawn april june august sky star love best early wise sharp small " +
  "strong gold silver fox wolf swift noble duke earl prince bishop law rice post day knight ray guy pat sue jack bob rob " +
  "sunny penny ruby amber jade crystal river forest storm win wing lee").split(" "));

function tokenSource(tok: string, shape: "any" | "title" | "upper" | "written"): string {
  return [...tok].map((ch, idx) => {
    if (ch === "'" || ch === "’") return "['’]";
    const lower = ch.toLowerCase();
    // "written": each letter in the case the header wrote it ("McDonald").
    const upper = shape === "upper" || (shape === "title" && idx === 0) || (shape === "written" && ch !== lower);
    const set = FOLD_OF.get(lower);
    if (!set) return escapeRe(shape === "any" ? ch : upper ? ch.toUpperCase() : lower);
    if (shape === "any") return `[${set}]`;
    return upper ? `[${set.toUpperCase()}]` : `[${set}]`;
  }).join("");
}

/**
 * Lines of the header block: the first HEADER_LINES non-empty lines, up to the
 * first section heading (the same rule the contact rules use, step 2).
 */
function headerLineCount(text: string): number {
  const lines = text.split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue;
    if (seen >= HEADER_LINES || endsHeader(lines[i])) return i;
    seen++;
  }
  return lines.length;
}

// Two-letter English words are never masked on their own ("An" in "Nguyễn
// Văn An" is masked through the full name instead).
const FUNCTION_WORDS = new Set("an as at be by do go he if in is it me my no of on or so to up us we".split(" "));

/** A nickname from the header ("Liz"), masked as a name token is. */
function maskAlias(text: string, alias: string): { text: string; count: number } {
  let count = 0;
  const out = maskTokens(text, new Set([alias]), () => { count++; });
  return { text: out, count };
}

function maskName(text: string, name: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  if (CJK_NAME.test(name)) {
    const compact = name.replace(/\s+/g, "");
    for (const variant of new Set([name, compact])) {
      out = out.split(variant).join("\u0000");
    }
    out = out.replace(/\u0000/g, () => { count++; return "[CANDIDATE]"; });
    return { text: out, count };
  }
  const B = "(?<![\\p{L}\\p{M}])", E = "(?![\\p{L}\\p{M}])";
  const parts = name.split(/\s+/);
  const full = parts.map((p) => tokenSource(p, "any")).join("[\\s.-]+");
  out = out.replace(new RegExp(`${B}${full}${E}`, "giu"), () => { count++; return "[CANDIDATE]"; });
  const tokens = new Set<string>();
  const core: string[] = [];
  for (const p of parts) {
    if (PARTICLES.has(p.toLowerCase())) continue;
    if (p.replace(/[.'’]/g, "").length >= 2) core.push(p.replace(/[.'’-]/g, ""));
    for (const sub of [p, ...p.split(/[-]/)]) if (sub.replace(/[.'’]/g, "").length >= 2) tokens.add(sub.replace(/\.$/, ""));
  }
  // Handles and hosts built from the name: "@mariagonzalez", "maria_gonzalez.dev", "mgonzalez".
  if (core.length >= 2) {
    const first = core[0], last = core[core.length - 1];
    const joins = [core.map((t) => tokenSource(t, "any")).join("[._-]?"), `${tokenSource(last, "any")}[._-]?${tokenSource(first, "any")}`];
    if (last.length >= 4) joins.push(`${tokenSource(first[0], "any")}[._-]?${tokenSource(last, "any")}`);
    out = out.replace(new RegExp(`${B}(?:${joins.join("|")})(?![\\p{L}\\p{M}])`, "giu"), () => { count++; return "[CANDIDATE]"; });
  }
  out = maskTokens(out, tokens, () => { count++; });
  return { text: out, count };
}

/**
 * A NAME'S SINGLE WORDS ARE MASKED WHERE THEY ARE WRITTEN AS A NAME (register
 * S11-057). Case-insensitive matching of every token turned a candidate named
 * John Wells into "40 horizontal [CANDIDATE]" and erased "banks", "grant",
 * "mills", "glass" and "English" from résumés whose owners carry those
 * surnames: job evidence lost before scoring, and logged as name redaction,
 * in an employer compliance product. Inside the header block a token is
 * still masked in any case; below it, only Title case, UPPER case or the case
 * the header wrote it in. The full name and the handles built from it stay
 * case-insensitive everywhere (maskName).
 */
function maskTokens(text: string, tokens: Set<string>, hit: () => void): string {
  const B = "(?<![\\p{L}\\p{M}])", E = "(?![\\p{L}\\p{M}])";
  const split = (t: string) => {
    const lines = t.split("\n");
    const k = headerLineCount(t);
    return { head: lines.slice(0, k).join("\n"), body: lines.slice(k).join("\n"), joiner: k > 0 && k < lines.length ? "\n" : "" };
  };
  let out = text;
  for (const tok of [...tokens].sort((a, b) => b.length - a.length)) {
    const plain = tok.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (FUNCTION_WORDS.has(plain)) continue;
    // A given name that is also a month ("June Lee") keeps "June 2012" and "May – Dec 2017".
    const guard = new RegExp(`^${MONTHS}$`).test(plain) ? `(?!\\.?,?[ \\t]*(?:\\d{1,2}(?:st|nd|rd|th)?,?[ \\t]+)?(?:(?:19|20)\\d{2}|['’]\\d{2})(?!\\d)|[ \\t]*(?:[-–—/]|to)[ \\t]*(?:${MONTHS_ANY}|(?:19|20)\\d{2}))(?<!(?<!\\d)\\d{1,2}(?:st|nd|rd|th)?[ \\t]+${tokenSource(tok, "any")})` : "";
    const cased = new RegExp(`${B}(?:${tokenSource(tok, "title")}|${tokenSource(tok, "upper")}|${tokenSource(tok, "written")})${E}${guard}`, "gu");
    const mark = () => { hit(); return "[CANDIDATE]"; };
    if (COMMON_WORDS.has(plain) || plain.length <= 2) {
      out = out.replace(cased, mark);
      continue;
    }
    const anyCase = new RegExp(`${B}${tokenSource(tok, "any")}${E}${guard}`, "giu");
    const { head, body, joiner } = split(out);
    out = head.replace(anyCase, mark) + joiner + body.replace(cased, mark);
  }
  return out;
}

// ── Labelled personal fields: keep the label, drop the value ───────────────
// In every language the site serves, and Chinese and Japanese (S14X-022).
const LABEL_FEATURES: Array<{ labels: string[]; feature: string; tag: string }> = [
  { labels: ["gender", "sex", "gender identity", "pronouns", "geschlecht", "sexe", "sexo", "género", "genero", "gênero", "geslacht", "kasarian", "性别", "性別"], feature: "gendered_terms", tag: "GENDER" },
  { labels: ["marital status", "civil status", "marital", "spouse", "spouse's name", "spouse name", "children", "number of children", "no. of children", "dependents", "father's name", "mother's name", "father name", "mother name",
    "familienstand", "kinder", "situation familiale", "état civil", "etat civil", "enfants", "estado civil", "hijos", "filhos", "burgerlijke staat", "kinderen", "婚姻状况", "婚姻狀況", "婚姻", "配偶者", "配偶", "扶養家族"], feature: "family_status", tag: "FAMILY" },
  { labels: ["religion", "religious affiliation", "faith", "caste", "sect", "denomination", "konfession", "religión", "religião", "religie", "宗教", "宗教信仰"], feature: "religion", tag: "RELIGION" },
  { labels: ["nationality", "citizenship", "country of origin", "country of citizenship", "place of birth", "birthplace", "birth place", "passport", "passport no", "passport number", "national id", "national id no", "domicile", "hometown", "native place", "mother tongue",
    "staatsangehörigkeit", "nationalität", "geburtsort", "nationalité", "lieu de naissance", "nacionalidad", "lugar de nacimiento", "nacionalidade", "naturalidade", "local de nascimento", "nationaliteit", "geboorteplaats", "国籍", "籍贯", "籍貫", "出生地", "户籍", "本籍"], feature: "national_origin", tag: "ORIGIN" },
  { labels: ["ethnicity", "race", "ethnic origin", "race/ethnicity", "ethnic group", "tribe", "ethnie", "etnia", "民族"], feature: "race_ethnicity", tag: "ETHNICITY" },
  { labels: ["date of birth", "birth date", "birthdate", "birthday", "born", "d.o.b", "d.o.b.", "dob", "geburtsdatum", "geburtstag", "date de naissance", "fecha de nacimiento", "data de nascimento", "geboortedatum", "出生日期", "出生年月日", "出生年月", "生年月日"], feature: "date_of_birth", tag: "DOB" },
  { labels: ["age", "alter", "âge", "edad", "idade", "leeftijd", "年龄", "年齡", "年齢"], feature: "explicit_age", tag: "AGE" },
  { labels: ["height", "weight", "blood group", "blood type", "physical status", "größe", "gewicht", "身高", "体重", "血型", "身長", "血液型"], feature: "physical_characteristics", tag: "PHYSICAL" },
  { labels: ["visa", "visa status", "visa type", "work authorization", "work authorisation", "work permit", "immigration status", "residency status", "residence permit", "right to work", "sponsorship", "aufenthaltstitel", "arbeitserlaubnis", "titre de séjour", "permiso de trabajo", "verblijfsvergunning", "werkvergunning", "在留資格"], feature: "citizenship_status", tag: "CITIZENSHIP" },
  { labels: ["health status", "medical condition", "medical history", "disability", "disability status", "behinderung", "schwerbehinderung", "handicap", "discapacidad", "deficiência", "健康状况"], feature: "disability_mention", tag: "ADA" },
  { labels: ["veteran status", "military status", "protected veteran"], feature: "veteran_status", tag: "VETERAN" },
  { labels: ["political affiliation", "政治面貌"], feature: "political_affiliation", tag: "POLITICAL" },
];
const ALL_LABELS = LABEL_FEATURES.flatMap((f) => f.labels).sort((a, b) => b.length - a.length);
const LABEL_ALT = ci(ALL_LABELS);
const LABEL_SEP = "\\s*[:：=–]\\s*|\\s+-\\s+";
const VALUE_END = `(?=\\s*(?:[|;•·\\n]|$)|\\s{2,}|\\s\\/\\s|\\.(?:\\s|$)|,\\s*${LABEL_ALT}(?:${LABEL_SEP}))`;
const LABELLED_FIELD = new RegExp(
  `(?<![\\p{L}])(${LABEL_ALT})(${LABEL_SEP})(${DATE}(?=\\s*(?:[|;•·,.\\n]|$|\\s))|[^\\n|;•·]{1,60}?${VALUE_END}|[^\\s|;•·]+(?:[ \\t]+[^\\s|;•·]+){0,3})`,
  "gu",
);
// A label that starts a line, then a tab, two spaces or an ideographic space ("Geburtsdatum<TAB>15.03.1970").
const LABELLED_COLUMN = new RegExp(`(?<=^|\\n)([ \\t]*)(${LABEL_ALT})(\\t[ \\t]*|[ ]{2,}|\\u3000+)([^\\n|;•·\\t]{1,60}?)(?=[ \\t]*(?:[|;•·\\n]|$)|[ ]{2,}|\\t)`, "gu");
// An unlabelled birth date ("D.O.B. 15.03.1970", "born in 1970", "née le 15 mars 1970").
const DOB_INLINE: Rule = { feature: "date_of_birth", pattern: new RegExp(`(?<![\\p{L}])(${ci(["date of birth", "birth date", "birthdate", "born on", "born in", "born", "d.o.b.", "d.o.b", "dob", "geboren am", "geboren op", "geboren", "geb.", "née le", "né le", "née", "né", "nacida el", "nacido el", "nacida", "nacido", "nascida em", "nascido em", "nascida", "nascido"])}|[dD]\\.[ \\t]*[oO]\\.[ \\t]*[bB]\\.?)(\\s*[:\\-–]?\\s*)${DATE_LOOSE}(?![\\p{N}])`, "gu"), replacement: (_m, label, sep) => `${label}${sep}[REDACTED-DOB]` };
const LABEL_LOOKUP = new Map<string, { feature: string; tag: string }>();
for (const f of LABEL_FEATURES) for (const l of f.labels) LABEL_LOOKUP.set(l, { feature: f.feature, tag: f.tag });

function redactLabelledFields(text: string, bump: (f: string, n: number) => void): string {
  const value = (m: string, label: string, sep: string, v: string, pre = "") => {
    if (/^\[REDACTED-|^\[CANDIDATE\]/.test(v.trim())) return m;
    const hit = LABEL_LOOKUP.get(label.toLowerCase().replace(/\s+/g, " "));
    if (!hit) return m;
    // "Age: 34" only — never "Age: Bronze" style prose.
    if (hit.tag === "AGE" && !/\d/.test(v)) return m;
    bump(hit.feature, 1);
    return `${pre}${label}${sep}[REDACTED-${hit.tag}]`;
  };
  return text.replace(LABELLED_FIELD, (m, label: string, sep: string, v: string) => value(m, label, sep, v))
    .replace(LABELLED_COLUMN, (m, pre: string, label: string, sep: string, v: string) => value(m, label, sep, v, pre));
}

// ── Education years (age proxy) ────────────────────────────────────────────
const DEGREE = new RegExp(
  "(?<![\\p{L}])(?:" + [
    "bachelor(?:'s|’s|s)?", "master(?:'s|’s|s)?\\s+(?:of|in|degree)", "master(?:'s|’s)", "mba", "emba", "ph\\.?\\s?d\\.?", "d\\.?phil", "doctorate", "doctor of", "ed\\.d\\.?",
    "b\\.\\s?[as]\\.?", "m\\.\\s?[as]\\.?", "a\\.\\s?[as]\\.?", "b\\.?\\s?sc\\.?", "m\\.?\\s?sc\\.?", "b\\.?\\s?eng\\.?", "m\\.?\\s?eng\\.?",
    "bba", "b\\.?\\s?com", "m\\.?\\s?com", "b\\.?\\s?tech", "m\\.?\\s?tech", "ll\\.?\\s?[bm]\\.?", "mph", "msw", "mfa", "bfa", "mpa", "m\\.d\\.", "j\\.d\\.",
    "(?:ba|bs|ma|ms|aa|as)\\s+(?:in|of)\\b", "associate(?:'s|’s)?\\s+(?:degree|of|in)", "diploma", "high school", "secondary school",
    "ged", "a-levels?", "gcses?", "baccalaur\\p{L}*", "licenciatura", "abitur", "hnd", "btec",
  ].join("|") + ")(?![\\p{L}])",
  "iu",
);
const SCHOOL = /(?<![\p{L}])(?:university|universidad|université|universität|università|universidade|college|school|institute|academy|polytechnic|politecnico|hochschule|conservatory|seminary|lycée|gymnasium)(?![\p{L}])/iu;
const SECTION_WORDS = /(?<![\p{L}])(?:other|additional|personal|experience|employment|history|career|certifications?|certificates?|licen[cs]es?|awards?|honou?rs?|volunteer\p{L}*|publications?|skills|projects?|summary|profile|objective|languages|interests|activities|leadership|references|research|teaching|affiliations|memberships|courses|training|work|positions?|appointments?)(?![\p{L}])/iu;
const EDU_HEADING = /(?<![\p{L}])(?:education|academic|academics|qualifications?|schooling|studies)(?![\p{L}])/iu;
const YEAR_RANGE = /(?:19|20)\d{2}\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present|current|now|date|today)/iu;

function isHeadingLine(line: string): boolean {
  const t = line.trim().replace(/[:：\s]+$/, "");
  if (t.length === 0 || t.length > 60 || /\d/.test(t)) return false;
  if (isLocalHeading(t)) return true;
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  const letters = t.replace(/[^\p{L}]/gu, "");
  const allCaps = letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  // Short all-caps lines like "MIT" or "NYU" are school names, not headings.
  if (allCaps) return letters.length >= 6 || SECTION_WORDS.test(t) || EDU_HEADING.test(t);
  return (SECTION_WORDS.test(t) || EDU_HEADING.test(t)) && /^[\p{Lu}]/u.test(t);
}

function redactEducationYears(text: string): { text: string; count: number } {
  let count = 0;
  let inEducation = false;
  const maskYears = (line: string) => line.replace(YEAR_RE, () => { count++; return "[YEAR]"; });
  const out = text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (isHeadingLine(trimmed) && !DEGREE.test(trimmed) && !SCHOOL.test(trimmed)) {
      inEducation = EDU_HEADING.test(trimmed) || LOCAL_EDU.test(trimmed.replace(/[:：\s]+$/, ""));
      return line;
    }
    if (inEducation) {
      const dateOnly = trimmed.replace(YEAR_RE, "").replace(new RegExp(MONTHS, "giu"), "").replace(/[\s.,\-–—/()]|to|present|expected/giu, "") === "";
      if (DEGREE.test(trimmed) || SCHOOL.test(trimmed) || (dateOnly && YEAR_RE.test(trimmed))) {
        YEAR_RE.lastIndex = 0;
        return maskYears(line);
      }
      YEAR_RE.lastIndex = 0;
      return line;
    }
    // Outside an Education section: a degree with a single year ("MBA,
    // Wharton (1994)") is a graduation year; a degree line with a range is
    // usually a job ("Taught MBA courses, 2015–2020") and keeps its tenure.
    if (DEGREE.test(trimmed) && !YEAR_RANGE.test(trimmed)) return maskYears(line);
    return line;
  }).join("\n");
  return { text: out, count };
}

// ── Inline proxies ─────────────────────────────────────────────────────────
const IDENTITY = ci([
  "hispanic", "latino", "latina", "latinx", "latine", "latinos", "chicano", "chicana", "black", "african american", "african-american",
  "asian", "asian american", "asian-american", "korean", "korean american", "chinese", "chinese american", "japanese", "filipino", "filipina",
  "vietnamese", "indian", "south asian", "desi", "arab", "arab american", "persian", "iranian", "jewish", "muslim", "islamic", "christian",
  "catholic", "hindu", "sikh", "buddhist", "native american", "american indian", "indigenous", "first nations", "lgbt", "lgbtq",
  "lgbtq+", "lgbtqia+", "queer", "gay", "lesbian", "transgender", "women", "women's", "womens", "female",
]);
const ORG = ci([
  "association", "society", "network", "alliance", "club", "council", "federation", "union", "fellowship", "chamber of commerce",
  "chamber", "foundation", "professionals", "engineers", "coalition", "caucus", "collective", "sorority", "fraternity", "organization",
  "organisation", "committee", "student association", "students association", "employee resource group", "erg", "affinity group",
  "scholars", "scholarship", "leadership program", "conference", "summit", "mentorship program", "bar association", "student union",
]);
const PROPER_WORD = "\\p{Lu}[\\p{L}'’&-]*";
// "Black Hat", "Black Belt", "Black Friday": named things, not identity (S14X-025).
const NOT_IDENTITY_NEXT = `(?![ \\t]+${ci(["hat", "belt", "friday", "box", "swan", "book", "duck", "rock"])}(?![\\p{L}]))`;
const IDENTITY_WORD = `${IDENTITY}${NOT_IDENTITY_NEXT}`;
const GREEK = "(?:Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi|Omicron|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega)";
const GREEK_NAME = `${GREEK}(?:[ \\t]+${GREEK}){1,2}`;
// Gendered role nouns read as the role (S14X-106); the case is kept.
const NEUTRAL_ROLE: Record<string, string> = {
  chairman: "chair", chairwoman: "chair", chairmen: "chairs", chairwomen: "chairs",
  spokesman: "spokesperson", spokeswoman: "spokesperson", spokesmen: "spokespeople", spokeswomen: "spokespeople",
  businessman: "businessperson", businesswoman: "businessperson", businessmen: "businesspeople", businesswomen: "businesspeople",
  salesman: "salesperson", saleswoman: "salesperson", salesmen: "salespeople", saleswomen: "salespeople",
  councilman: "council member", councilwoman: "council member", councilmen: "council members", councilwomen: "council members",
  congressman: "member of Congress", congresswoman: "member of Congress", anchorman: "anchor", anchorwoman: "anchor",
  waitress: "server", waitresses: "servers", actress: "actor", actresses: "actors", hostess: "host", hostesses: "hosts",
  stewardess: "flight attendant", stewardesses: "flight attendants", headmistress: "head teacher", headmaster: "head teacher",
  alumna: "alum", alumnae: "alums", alumnus: "alum",
};
const keepCase = (src: string, word: string) =>
  src === src.toUpperCase() ? word.toUpperCase() : /^\p{Lu}/u.test(src) ? word[0].toUpperCase() + word.slice(1) : word;

const INLINE_RULES: Rule[] = [
  // Age proxies
  { feature: "explicit_age", pattern: /(?<![\p{L}])(?:age|aged)\s*[:\-]?\s*\d{2}(?!\d)/giu, replacement: "[REDACTED-AGE]" },
  {
    feature: "explicit_age",
    pattern: /(?<!\d)\d{2}[\s-]?(?:years?|yrs?)[\s-]old(?![\p{L}])(?!\s+(?:company|firm|business|brand|system|systems|codebase|platform|product|building|organi[sz]ation|startup|website|app|application|infrastructure|network|plant|facility|fleet|program|legacy|bank|institution|tradition|code|monolith|software|stack))/giu,
    replacement: "[REDACTED-AGE]",
  },
  { feature: "explicit_age", pattern: /(?<![\p{L}])(?:i am|i'm|i’m)\s+\d{2}(?=\s*(?:years|yrs|[,.;]|$))/giu, replacement: "[REDACTED-AGE]" },
  // "54 Jahre alt", "âgée de 54 ans", "54 años de edad", "54 jaar oud", "54岁", "満54歳" (S14X-022)
  { feature: "explicit_age", pattern: /(?<![\p{N}])\d{2}[ \t]+(?:jahre[ \t]+alt|jaar[ \t]+oud|años[ \t]+de[ \t]+edad|anos[ \t]+de[ \t]+idade)(?![\p{L}])|(?<![\p{L}])âgée?[ \t]+de[ \t]+\d{2}[ \t]+ans(?![\p{L}])|[満满]?(?<![\p{N}])\d{1,2}[ \t]?周?[歳岁歲]/giu, replacement: "[REDACTED-AGE]" },
  // "Over-50 professional", "60 years young", "in my fifties" (S14X-106)
  { feature: "explicit_age", pattern: /(?<![\p{L}])over-\d{2}s?(?![\p{N}%\p{L}])|(?<![\p{N}])\d{2}[ \t]+years?[ \t]+young(?![\p{L}])|(?<![\p{L}])in[ \t]+(?:my|her|his|their)[ \t]+(?:(?:early|late)[ \t]+|mid-?[ \t]?)?(?:twenties|thirties|forties|fifties|sixties|seventies|[2-7]0['’]?s)(?![\p{L}])/giu, replacement: "[REDACTED-AGE]" },
  {
    feature: "graduation_year",
    pattern: new RegExp(`(?<![\\p{L}])(${ci(["class of", "graduated", "graduating", "graduation date", "graduation year", "graduation", "grad year", "expected graduation", "year of passing"])})(\\s*(?:[:\\-–]\\s*)?(?:(?:in|on)\\s+)?(?:${MONTHS}\\.?,?\\s+)?)((?:19|20)\\d{2}|['’]\\d{2})(?!\\d)`, "giu"),
    replacement: (_m, label, mid) => `${label}${mid}[REDACTED-YEAR]`,
  },
  // "Graduated from Ohio State in 1980": words between the verb and the year (S14X-106)
  { feature: "graduation_year", pattern: /(?<![\p{L}])(graduated[ \t]+from[ \t]+(?:[\p{L}&.'’-]+[ \t]+){1,6}?in[ \t]+)((?:19|20)\d{2})(?!\d)/giu, replacement: (_m, pre) => `${pre}[REDACTED-YEAR]` },
  // Citizenship and immigration status (never inside job evidence such as CPT coding)
  {
    feature: "citizenship_status",
    pattern: /(?<![\p{L}])(?:(?:u\.\s?s\.|us|usa|united states|american|canadian|british|uk|eu|indian|dual|naturali[sz]ed)\s+citizen(?:ship)?|citizen(?:ship)?\s+of\s+(?:the\s+)?\p{L}+(?:\s+\p{Lu}\p{L}+){0,2}|permanent\s+resident(?:\s+card)?|green\s+card(?:\s+holder)?|(?:h-?1b|h-?4|l-?1|tn|f-?1|j-?1|o-?1|e-?3)\s+(?:visa|status|holder|transfer)|h-?1b|(?:work|employment)\s+(?:authori[sz]ation|permit|visa)|visa\s+(?:status|sponsorship|holder|type)|(?:requires?|needs?|will\s+require)\s+(?:visa\s+)?sponsorship|sponsorship\s+(?:is\s+)?(?:required|needed|not\s+required)|authori[sz]ed\s+to\s+work(?:\s+in\s+(?:the\s+)?[\p{L}.]+)?|refugee\s+status|asylee|asylum\s+seeker)(?![\p{L}])(?!\s*[:：=–]\s*\[REDACTED)/giu,
    replacement: "[REDACTED-CITIZENSHIP]",
  },
  { feature: "citizenship_status", pattern: /\b(?:STEM\s+)?(?:OPT|CPT)(?:\s+EAD)?\b|\bEAD\b/g, replacement: (m, ...rest) => immigrationContext(m, rest) },
  { feature: "national_origin", pattern: /(?<![\p{L}])national\s+of\s+(?:the\s+)?\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?/gu, replacement: "[REDACTED-ORIGIN]" },
  { feature: "national_origin", pattern: /(?<![\p{L}])\p{Lu}\p{Ll}+(?:an|ese|ish|i|ic)\s+national(?=\s*(?:[,.;|)\n]|$)|\s+(?:with|seeking|currently|residing|based|living|holding|and)\b)/gu, replacement: "[REDACTED-ORIGIN]" },
  // "Born and raised in Lagos", "grew up in Kerala", "native of Kerala" (S14X-106); never a bare "raised in" ("Raised in Series A")
  {
    feature: "national_origin",
    pattern: new RegExp(`(?<![\\p{L}])(${ci(["born and raised in", "born in", "grew up in", "native of"])}[ \\t]+)\\p{Lu}[\\p{L}\\p{M}'’.-]*(?:[ \\t]+\\p{Lu}[\\p{L}\\p{M}'’.-]*){0,2}(?:,[ \\t]*\\p{Lu}[\\p{L}\\p{M}'’.-]*(?:[ \\t]+\\p{Lu}[\\p{L}\\p{M}'’.-]*){0,2})?`, "gu"),
    replacement: (_m, pre) => `${pre}[REDACTED-ORIGIN]`,
  },
  // A leave is a career break: the gap stays, the reason goes (S14X-023).
  // A leave POLICY is HR work and stays.
  {
    feature: "family_status",
    pattern: /(?<![\p{L}])(?:(?:maternity|paternity|parental|adoption|family)[ \t]+leave|elternzeit|mutterschutz|karenz|cong[ée][ \t]+(?:de[ \t]+)?(?:maternit[ée]|paternit[ée]|parental)|baja[ \t]+(?:por[ \t]+)?(?:maternidad|paternidad)|licen[çc]a[- ](?:maternidade|paternidade)|zwangerschapsverlof|ouderschapsverlof|bevallingsverlof)(?![\p{L}])(?![ \t]+(?:polic(?:y|ies)|programm?e?s?|requests?|administration|claims?|compliance|laws?|act|benefits?|cases?|process(?:es|ing)?|tracking|management|reporting|reports?|dashboards?|data|records?))|产假|育儿假|育児休業|産休|育休/giu,
    replacement: (m) => /^\p{Lu}/u.test(m) ? "Career break" : "career break",
  },
  { feature: "disability_mention", pattern: /(?<![\p{L}])(?:medical|disability|sick)[ \t]+leave(?![\p{L}])(?![ \t]+(?:polic(?:y|ies)|programm?e?s?|requests?|administration|claims?|compliance|laws?|act|benefits?|cases?|process(?:es|ing)?|tracking|management|reporting|reports?|dashboards?|data|records?))/giu, replacement: (m) => /^\p{Lu}/u.test(m) ? "Career break" : "career break" },
  // Disability: the term, never the surrounding job evidence (ADA)
  {
    feature: "disability_mention",
    pattern: /(?<![\p{L}])(?:disabilit(?:y|ies)|disabled|chronic(?:ally)?\s+ill(?:ness)?|chronic\s+illness|wheelchair(?:\s+user)?|neurodivergen\p{L}*|neurodiverse|autis(?:m|tic)|asperger(?:'s|’s|s)?|adhd|dyslexi\p{L}*|dyspraxi\p{L}*|epilep\p{L}*|cerebral\s+palsy|multiple\s+sclerosis|amputee|hard[- ]of[- ]hearing|hearing[- ]impaired|visually[- ]impaired|legally\s+blind|deaf|ptsd|post[- ]traumatic\s+stress(?:\s+disorder)?|bipolar(?:\s+disorder)?|schizophreni\p{L}*|cancer\s+survivor|hiv[- ]positive)(?![\p{L}])/giu,
    replacement: "[REDACTED-ADA]",
  },
  // ... and in German, French, Spanish, Portuguese, Dutch, Chinese and Japanese (S14X-022); never a bare 障害 ("システム障害対応" is IT work).
  {
    feature: "disability_mention",
    pattern: /(?<![\p{L}])(?:schwerbehindert\p{L}*|schwerbehinderung|behinderung|gd[bs][ \t]*\d{2,3}|handicap(?:é|ée|és|ées|ped)?|rqth|discapacidad|discapacitad[oa]s?|minusválid[oa]s?|deficiência|gehandicapt|arbeidsbeperking)(?![\p{L}])|残疾|障害者|障碍者/giu,
    replacement: "[REDACTED-ADA]",
  },
  // Veteran status (military service itself is job evidence and stays)
  { feature: "veteran_status", pattern: /(?<![\p{L}])(?:(?:protected|disabled)\s+)?veterans?(?![\p{L}])(?!\s+(?:affairs|administration|health|hospital|day|services|benefits))/giu, replacement: "[REDACTED-VETERAN]" },
  // Family / marital status (sex-discrimination proxies); a maternity ward is job evidence
  {
    feature: "family_status",
    pattern: /(?<![\p{L}])(?:married|divorced|widowed|single\s+(?:mother|father|parent|mom|dad)|(?:great-)?(?:grand)?(?:mother|father|mom|dad|parent)\s+of\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})|stay[- ]at[- ]home\s+(?:mom|mother|dad|father|parent)|maternity(?![ \t]+(?:ward|unit|hospital|nursing|care|services|wing|clinic|nurse|leave))|paternity(?![ \t]+(?:test|testing|tests|lab|leave))|pregnan\p{L}*|children:?\s*\d|dependents:?\s*\d)(?![\p{L}])/giu,
    replacement: "[REDACTED-FAMILY]",
  },
  // "Raising my children", "caring for my parents", "primary caregiver" (S14X-106)
  {
    feature: "family_status",
    pattern: /(?<![\p{L}])(?:(?:raising|raised|caring[ \t]+for|cared[ \t]+for|care[ \t]+for|looking[ \t]+after|looked[ \t]+after)[ \t]+(?:my|our)[ \t]+(?:\p{L}+[ \t]+){0,2}?(?:children|kids|child|sons?|daughters?|twins|toddlers?|baby|newborn|family|parents?|mother|father|mum|mom|dad|grandchildren|husband|wife|spouse)|primary[ \t]+caregiver(?:[ \t]+(?:for|to)[ \t]+(?:my|our)[ \t]+\p{L}+)?|caregiver[ \t]+(?:for|to)[ \t]+(?:my|our)[ \t]+\p{L}+)(?![\p{L}])/giu,
    replacement: "[REDACTED-FAMILY]",
  },
  // Affinity / protected-group memberships; no rule reads past the line it starts on (S14X-024)
  { feature: "affinity_group", pattern: new RegExp(`(?<![\\p{L}])(?:${ci(["national ", "the "])})?${ORG}[ \\t]+(?:of|for)[ \\t]+(?:${PROPER_WORD}[ \\t]+){0,2}?${IDENTITY_WORD}(?:[ \\t]+${PROPER_WORD}){0,3}`, "gu"), replacement: "[REDACTED-AFFINITY]" },
  { feature: "affinity_group", pattern: new RegExp(`(?<![\\p{L}])${IDENTITY_WORD}(?:[ \\t]+${PROPER_WORD}){0,3}[ \\t]+${ORG}(?![\\p{L}])`, "gu"), replacement: "[REDACTED-AFFINITY]" },
  { feature: "affinity_group", pattern: new RegExp(`(?<![\\p{L}])${ci(["women in"])}[ \\t]+\\p{L}+`, "gu"), replacement: "[REDACTED-AFFINITY]" },
  {
    feature: "affinity_group",
    pattern: /(?<![\p{L}])(?:NSBE|SHPE|AISES|SACNAS|NAAAP|ALPFA|MAES|SASE|NSHMBA|Prospanica|oSTEM|Out in Tech|Lesbians Who Tech|Hillel|Chabad|NPHC|HBCU|NAACP|UnidosUS|LULAC|Urban League|Girls Who Code|Black Girls Code|Grace Hopper Celebration|AnitaB\.org|Society of Women Engineers|Alpha Phi Alpha|Alpha Kappa Alpha|Kappa Alpha Psi|Omega Psi Phi|Delta Sigma Theta|Phi Beta Sigma|Zeta Phi Beta|Sigma Gamma Rho|Iota Phi Theta|Lambda Theta Alpha|Lambda Theta Phi|Sigma Lambda Beta|Sigma Lambda Gamma|Divine Nine|Jack and Jill of America|Women Who Code)(?![\p{L}])/gu,
    replacement: "[REDACTED-AFFINITY]",
  },
  // Sororities and fraternities: "Kappa Kappa Gamma sorority", "Sigma Chi Fraternity", "Panhellenic" (S14X-106).
  // Greek letters alone stay: "Phi Beta Kappa" and "Tau Beta Pi" are academic honours.
  {
    feature: "affinity_group",
    pattern: new RegExp(`(?<![\\p{L}])(?:${GREEK_NAME}[ \\t]+${ci(["sorority", "fraternity"])}|${ci(["sorority", "fraternity"])}[ \\t]*[:,–-]?[ \\t]*${GREEK_NAME}|${ci(["panhellenic council", "panhellenic association", "panhellenic", "interfraternity council", "sororities", "sorority", "fraternities", "fraternity"])})(?![\\p{L}])`, "gu"),
    replacement: "[REDACTED-AFFINITY]",
  },
  // Religion: membership or self-description, never an institution's name
  {
    feature: "religion",
    pattern: new RegExp(`(?<![\\p{L}])${ci(["member", "congregant", "parishioner", "deacon", "elder", "usher", "choir member", "choir director", "choir", "worship leader", "youth group", "youth pastor", "youth minister", "youth leader", "sunday school teacher", "sunday school", "altar server", "lector", "bible study leader", "bible study", "volunteer"])}(?:,|[ \\t]+${ci(["at", "of", "with", "for", "in"])})?(?:[ \\t]+${ci(["the", "my", "our", "a", "local"])})?(?:[ \\t]+${PROPER_WORD}){0,4}[ \\t]+(?:Church|Mosque|Masjid|Synagogue|Temple|Parish|Gurdwara|Congregation|Chapel|Cathedral|Ministries|Mandir|Shul|Kingdom Hall)(?![\\p{L}])(?![ \\t]+(?:University|College|School|Hospital|Health|Medical|Bank|Street|St\\b|Avenue|Road))`, "gu"),
    replacement: "[REDACTED-RELIGION]",
  },
  { feature: "religion", pattern: /(?<![\p{L}])(?:devout|practicing|practising|observant|born-again|committed|proud)[ \t]+(?:christian|catholic|muslim|jew|jewish|hindu|buddhist|sikh|mormon|evangelical)(?![\p{L}])|(?<![\p{L}])of[ \t]+the[ \t]+(?:christian|muslim|jewish|hindu|buddhist|sikh|catholic)[ \t]+faith(?![\p{L}])/giu, replacement: "[REDACTED-RELIGION]" },
  { feature: "religion", pattern: /(?<![\p{L}])(?:LDS(?:[ \t]+(?:mission|missionary|church))?|Latter[- ]day[ \t]+Saints?|Mormon(?:[ \t]+mission)?|mission[ \t]+trip|missions[ \t]+trip|church[ \t]+(?:choir|youth[ \t]+group|volunteer))(?![\p{L}])/giu, replacement: "[REDACTED-RELIGION]" },
  // Race / ethnicity self-identification ("Hispanic market" is job evidence and stays).
  // "I am a / proud" + identity; "as a / as an" + identity only before a person noun or the clause's end,
  // so "worked as a Japanese interpreter" is a role (S14X-025).
  { feature: "identity_self_description", pattern: new RegExp(`(?<![\\p{L}])(?:${ci(["i am a", "i am an", "i am", "i'm a", "i'm an", "proud"])})[ \\t]+${IDENTITY_WORD}(?:[ \\t]+(?:${ci(["woman", "man", "female", "male", "professional", "candidate", "engineer", "leader", "immigrant"])}))?(?![\\p{L}])`, "gu"), replacement: "[REDACTED-IDENTITY]" },
  { feature: "identity_self_description", pattern: new RegExp(`(?<![\\p{L}])(?:${ci(["as a", "as an"])})[ \\t]+${IDENTITY}(?:[ \\t]+(?:${ci(["woman", "man", "female", "male", "immigrant", "person"])})(?![\\p{L}])|(?![\\p{L}])(?=[ \\t]*(?:[,.;:!?)\\n]|$)))`, "gu"), replacement: "[REDACTED-IDENTITY]" },
  // Street address (redlining proxy); city-level location stays
  {
    feature: "street_address",
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])\\d{1,6}[A-Za-z]?\\s+(?:[NSEW]\\.?\\s+)?(?:(?:${PROPER_WORD}|\\d{1,4}(?:st|nd|rd|th))\\s+){1,4}(?:${ci(["street", "avenue", "road", "boulevard", "drive", "lane", "court", "place", "terrace", "circle", "parkway", "highway", "square", "trail", "crescent", "close", "way"])}|St|ST|Ave|AVE|Rd|RD|Blvd|BLVD|Dr|DR|Ln|LN|Ct|CT|Pl|PL|Ter|Cir|Pkwy|Hwy|Sq)\\b\\.?(?:,?\\s*(?:${ci(["apt", "apartment", "unit", "suite", "ste", "flat"])}|#)\\.?\\s*[\\w-]+)?`, "gu"),
    replacement: "[REDACTED-ADDRESS]",
  },
  // Photos (references in parsed text)
  { feature: "photo_reference", pattern: /(?<![\p{L}])(?:photo|photograph|headshot|profile picture)\s*[:\-]?\s*(?:attached|included|enclosed|\.(?:jpe?g|png))(?![\p{L}])/giu, replacement: "[REDACTED-PHOTO]" },
  // Gender markers: honorifics before a name ("Ms Okafor" with no stop, "Frau", "Mme", "Sra.", "Mevr.": S14X-022, S14X-106), and pronoun sets.
  // "MS Office" stays: the stop-less forms are title case, and Microsoft's products are named.
  {
    feature: "gendered_terms",
    pattern: /(?<![\p{L}])(?:(?:Mr|Mrs|Ms|Mx|MR|MRS|MS|Mme|Mlle|Sra|Srta|Mevr|Dhr)\.[ \t]*|(?:Mr|Mrs|Ms|Mx|Miss|MR|MRS|MISS|Frau|Herr|Mme|Mlle|Sra|Srta|Mevr|Dhr)[ \t]+)(?=\p{Lu}|\[CANDIDATE\])(?!(?:Office|Excel|Word|Access|Project|Outlook|PowerPoint|Teams|Visio|Dynamics|SQL|Azure|Windows|Exchange|SharePoint|Edge|Paint|Publisher|Player)(?![\p{L}]))|(?<![\p{L}])(?:Sr|M)\.[ \t]*(?=\[CANDIDATE\])/gu,
    replacement: "[REDACTED-GENDER] ",
  },
  { feature: "gendered_terms", pattern: /(?<![\p{L}])(?:he|she|they|ze|xe)\s*\/\s*(?:him|her|them|hir|zir|xem)(?:\s*\/\s*(?:his|hers|theirs|hirs|zirs|xyrs))?(?![\p{L}])|(?<![\p{L}])pronouns\s*[:\-]\s*[\p{L}/]+/giu, replacement: "[REDACTED-GENDER]" },
  { feature: "gendered_terms", pattern: /(?<![\p{L}])(?:eagle[ \t]+scouts?|boy[ \t]+scouts?(?:[ \t]+of[ \t]+america)?|girl[ \t]+scouts?(?:[ \t]+of[ \t]+the[ \t]+usa)?|girl[ \t]+guides?)(?![\p{L}])/giu, replacement: "[REDACTED-GENDER]" },
  {
    feature: "gendered_terms",
    pattern: new RegExp(`(?<![\\p{L}])(?:${Object.keys(NEUTRAL_ROLE).sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}])`, "giu"),
    replacement: (m) => keepCase(m, NEUTRAL_ROLE[m.toLowerCase()] ?? m),
  },
];

// He, she, him, her, his, hers, himself, herself read as they, them, their (S14X-106).
// Lower or title case only ("HE" is higher education; "HER2" is an assay), never
// "Her Majesty" or a capitalised word after (a surname: "He Wei"), and never
// Spanish "he trabajado".
const PRONOUN = /(?<![\p{L}\p{N}'’-])(he|she|him|her|his|hers|himself|herself|He|She|Him|Her|His|Hers|Himself|Herself)(?![\p{L}\p{N}'’-])(?=([ \t]+[\p{L}'’]+)?)/gu;
const OBJECT_NEXT = new Set("a an the this that these those and or but nor to in on at for with from by as of into onto about after before during since until when while because if so than through over under up down out off again back away well too also very more most is was".split(" "));
const SPANISH_PARTICIPLE = /^\p{L}+(?:ad[oa]s?|id[oa]s?|cho|sto|rto|elto|ito)$/u;
const AGREE: Record<string, string> = { is: "are", was: "were", has: "have", does: "do", "isn't": "aren't", "wasn't": "weren't", "hasn't": "haven't", "doesn't": "don't" };

function neutralPronouns(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(PRONOUN, (m: string, p: string, nextRaw: string | undefined) => {
    const next = (nextRaw ?? "").trim();
    const lower = p.toLowerCase();
    if (p !== lower && /^\p{Lu}/u.test(next) && next !== "I") return m;
    if (lower === "he" && SPANISH_PARTICIPLE.test(next)) return m;
    const nextLower = next.toLowerCase();
    let word: string;
    if (lower === "he" || lower === "she") word = "they\u0001";
    else if (lower === "him") word = "them";
    else if (lower === "her") word = next && !OBJECT_NEXT.has(nextLower) ? "their" : "them";
    else if (lower === "his") word = next && !OBJECT_NEXT.has(nextLower) ? "their" : "theirs";
    else if (lower === "hers") word = "theirs";
    else word = "themself";
    count++;
    return p === lower ? word : word[0].toUpperCase() + word.slice(1);
  });
  return {
    text: out.replace(/(they|They)\u0001([ \t]+)([\p{L}'’]+)/gu, (_m, t: string, sp: string, verb: string) => `${t}${sp}${AGREE[verb.toLowerCase()] ?? verb}`).replace(/\u0001/g, ""),
    count,
  };
}

const IMMIGRATION_CONTEXT = /(?<![\p{L}])(?:visa|f-?1|ead|i-20|sponsor\p{L}*|work\s+authori[sz]\p{L}*|international\s+student|stem|status|immigration|uscis|eligible\s+to\s+work)(?![\p{L}])/iu;
function immigrationContext(m: string, rest: unknown[]): string | null {
  // rest ends with [offset, wholeText]: the words within 40 characters on
  // the same line decide, so "CPT and ICD-10 coding" stays.
  const offset = rest[rest.length - 2] as number;
  const whole = rest[rest.length - 1] as string;
  const lineStart = whole.lastIndexOf("\n", offset) + 1;
  const lineEnd = whole.indexOf("\n", offset);
  const before = whole.slice(Math.max(lineStart, offset - 40), offset);
  const after = whole.slice(offset + m.length, Math.min(lineEnd === -1 ? whole.length : lineEnd, offset + m.length + 40));
  if (/EAD|STEM/.test(m) || IMMIGRATION_CONTEXT.test(before) || IMMIGRATION_CONTEXT.test(after) || /(?<![\p{L}])on\s+$/iu.test(before)) return "[REDACTED-CITIZENSHIP]";
  return null;
}

// "Requires workplace accommodation" is an ADA request; "hotel
// accommodations" is hospitality evidence.
const ACCOMMODATION = /(?<![\p{L}])accommodat(?:e|es|ed|ing|ion|ions)(?![\p{L}])/giu;
const ACCOMMODATION_CONTEXT = /(?<![\p{L}])(?:need|needs|needed|require|requires|required|requesting|requested|request\s+an?|disabilit\p{L}*|medical|ADA|reasonable|workplace|religious|\[REDACTED-ADA\])(?![\p{L}])/iu;

function redactAccommodation(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.split("\n").map((line) => {
    if (!ACCOMMODATION.test(line)) { ACCOMMODATION.lastIndex = 0; return line; }
    ACCOMMODATION.lastIndex = 0;
    if (!ACCOMMODATION_CONTEXT.test(line.replace(ACCOMMODATION, ""))) { ACCOMMODATION.lastIndex = 0; return line; }
    ACCOMMODATION.lastIndex = 0;
    return line.replace(ACCOMMODATION, () => { count++; return "[REDACTED-ADA]"; });
  }).join("\n");
  return { text: out, count };
}

export interface RedactionConfig {
  /**
   * Extra blocklist patterns (feature name → regex source) for a caller inside
   * this codebase. No request body reaches it: shortlist-evaluate stopped
   * reading one (RC-S13-073).
   */
  extraBlocklist?: Array<{ feature: string; pattern: string }>;
  /** The uploaded file's name ("Jane_Okafor_CV.pdf"): its words are the name when the text shows them and no line read as one (S14X-072). */
  nameHint?: string;
}

function applyRule(text: string, rule: Rule, bump: (f: string, n: number) => void): string {
  let count = 0;
  rule.pattern.lastIndex = 0;
  const out = text.replace(rule.pattern, (...args: unknown[]) => {
    const m = args[0] as string;
    if (typeof rule.replacement === "string") { count++; return rule.replacement; }
    const r = rule.replacement(m, ...args.slice(1));
    if (r === null || r === m) return m;
    count++;
    return r;
  });
  bump(rule.feature, count);
  return out;
}

export function redactForScoring(rawText: string, config: RedactionConfig = {}): RedactionResult {
  const exclusions = new Map<string, number>();
  const bump = (feature: string, n: number) => {
    if (n > 0) exclusions.set(feature, (exclusions.get(feature) ?? 0) + n);
  };

  // 1. Find the name on the original header block, before anything moves.
  let text = rawText.normalize("NFC");
  const found = findName(text, config.nameHint);

  // 2. Contact details: emails, profile URLs, phones, postcodes.
  for (const rule of CONTACT_RULES) text = applyRule(text, rule, bump);
  {
    let count = 0, phones = 0;
    const lines = text.split("\n");
    let seen = 0;
    let inHeader = true;
    for (let i = 0; i < lines.length && seen < HEADER_LINES; i++) {
      if (lines[i].trim().length === 0) continue;
      seen++;
      if (inHeader && endsHeader(lines[i])) inHeader = false;
      if (inHeader) for (const rule of HEADER_RULES) lines[i] = applyRule(lines[i], rule, bump);
      lines[i] = lines[i].replace(BARE_DOMAIN, () => { count++; return "[REDACTED-URL]"; });
      lines[i] = lines[i].replace(HEADER_HANDLE, () => { count++; return "[REDACTED-URL]"; });
      lines[i] = lines[i].replace(HEADER_DIGITS, (m) => { if (phoneOrKeep(m) === null || m.split(/[\s.-]/).every((g) => /^(?:19|20)\d{2}$/.test(g))) return m; phones++; return "[REDACTED-PHONE]"; });
    }
    text = lines.join("\n");
    bump("profile_url", count);
    bump("phone", phones);
  }

  // 3. The name, everywhere and in any case.
  if (found) {
    const masked = maskName(text, found.name);
    bump("candidate_name", masked.count);
    text = masked.text;
    for (const alias of found.aliases) {
      // A Chinese or Japanese form is masked as a name is, inside any run of characters (S14X-105).
      const nick = CJK_NAME.test(alias) ? maskName(text, alias) : maskAlias(text, alias);
      bump("candidate_name", nick.count);
      text = nick.text;
    }
  }

  // 4. Labelled personal fields ("Gender: Female", "DOB: 15.03.1970").
  text = redactLabelledFields(text, bump);
  text = applyRule(text, DOB_INLINE, bump);

  // 5. Education years (age proxy) — with section context.
  const edu = redactEducationYears(text);
  bump("education_years", edu.count);
  text = edu.text;

  // 6. Inline proxies.
  for (const rule of INLINE_RULES) text = applyRule(text, rule, bump);
  const acc = redactAccommodation(text);
  bump("disability_mention", acc.count);
  text = acc.text;
  const pronouns = neutralPronouns(text);
  bump("gendered_terms", pronouns.count);
  text = pronouns.text;

  // 7. An extra blocklist: each entry compiled alone (a bad one is dropped),
  // then all of them in ONE pass over whole words, so no entry ever matches
  // another entry's mark and the text cannot grow with the entry count.
  const extras = (Array.isArray(config.extraBlocklist) ? config.extraBlocklist : []).slice(0, 20).flatMap((e) => {
    if (!e || typeof e.pattern !== "string" || typeof e.feature !== "string" || !e.pattern) return [];
    const source = e.pattern.slice(0, 200);
    try {
      return [{ feature: e.feature.slice(0, 40), whole: new RegExp(`^(?:${source})$`, "iu"), source }];
    } catch { return []; /* invalid pattern — skip, never break scoring */ }
  });
  if (extras.length > 0) {
    try {
      const any = new RegExp(`(?<![\\p{L}\\p{N}])(?:${extras.map((e) => `(?:${e.source})`).join("|")})(?![\\p{L}\\p{N}])`, "giu");
      text = text.replace(any, (m) => {
        if (!m) return m;
        const hit = extras.find((e) => e.whole.test(m)) ?? extras[0];
        bump(`custom:${hit.feature}`, 1);
        return "[REDACTED]";
      });
    } catch { /* the entries do not combine — skip, never break scoring */ }
  }

  // 8. One neutral mark: the category is named only in the audit (S14X-023).
  text = text.replace(/\[REDACTED-[A-Z0-9_]+\]/g, "[REDACTED]");

  return {
    redacted: text,
    exclusionsApplied: Array.from(exclusions.entries()).map(([feature, count]) => ({ feature, count })),
    nameFound: found !== null,
  };
}
