/**
 * LETTER CASE FOR THE KEYWORD PAGES, DECIDED BY WHAT A WORD IS (SEO-019, S13-089).
 *
 * Two rules printed the 58 /industries and 174 /roles pages, and both were
 * guesses about every word:
 *
 *   - role titles and industry labels upper-cased the first letter of every
 *     word, so real acronyms read "Rn", "Cpa", "Hr Manager", "Vp Of Product",
 *     "Ui Designer" in the <title>, the H1 and the JSON-LD name;
 *   - keyword chips upper-cased every token of four letters or fewer, so plain
 *     words read "WIND", "SPAY", "MENU", "CODE", "TURF" and plural acronyms
 *     "SOPS", "APIS", "RFIS".
 *
 * Here a word is upper-cased only when it is on a reviewed list of acronyms
 * (the lists below; every short keyword token the scanner's tables carry is
 * either on one of them or on PLAIN_WORDS, held by
 * seo-react-keyword-pages-case-acronyms-only), a plural acronym keeps its
 * lower-case s ("SOPs"), and nothing else is changed blindly.
 *
 * Pure and dependency-free: the React pages and the bake (scripts/prerender-seo.mjs)
 * print through the same functions.
 */

/** Acronyms in the keyword tables and in job titles alike. */
const ACRONYMS = new Set<string>([
  // keyword tables
  "3pl", "5g", "5s", "acv", "adr", "aed", "aht", "ai", "aov", "api", "arr", "atc", "aum", "aws", "beo", "bi", "bim", "bom",
  "cad", "cbt", "cma", "cms", "cpa", "cpr", "crm", "csat", "cve", "dau", "dbt", "dcf", "dfar", "dfars", "dsl", "dtc", "dwdm",
  "eda", "edr", "ehr", "ehs", "elisa", "elt", "emr", "esg", "etl", "f2p", "faa", "far", "fcr", "fda", "fmea", "ftl", "gaap",
  "gcp", "ghg", "glp", "gmp", "haccp", "hipaa", "hplc", "hse", "hvac", "iam", "icu", "ids", "ifr", "ifrs", "ind", "ips",
  "kpi", "lbo", "lca", "llm", "lte", "ltl", "ltv", "mau", "mls", "mrr", "msha", "mvp", "nec", "nepa", "ngo", "ngs", "nih",
  "nlp", "noi", "nps", "nsf", "oee", "okr", "osha", "osp", "otdr", "otif", "pbx", "pcr", "pdp", "prd", "pstn", "qpcr",
  "rag", "rca", "rfi", "rfp", "rfq", "rlhf", "seo", "siem", "sip", "sla", "soc", "solas", "sonet", "sop", "sox", "tcv",
  "vfr", "voip", "xdr",
  // job titles
  "bdr", "cdl", "ceo", "cfi", "cfo", "cfp", "chro", "cio", "ciso", "clo", "cmo", "cna", "cnc", "cno", "coo", "cpo", "cra",
  "crna", "cro", "cso", "csm", "cto", "cx", "dba", "dei", "emt", "esl", "evs", "grc", "gtm", "hr", "hrbp", "hris", "ip",
  "lpn", "lvn", "md", "ml", "msl", "noc", "np", "ot", "otr", "ppc", "pt", "qa", "qc", "rda", "rf", "ria", "rn", "rt",
  "rte", "sdet", "sdr", "slp", "sre", "tpm", "tv", "ui", "ux", "vc", "vp",
]);

/** Acronyms only in a job title or an industry label ("IT manager", "STEM teacher", "PE teacher", "GC"). */
const TITLE_ONLY_ACRONYMS = new Set<string>(["it", "stem", "pe", "gc"]);

/** Spellings that are neither all-capitals nor title case. */
const SPECIAL: Record<string, string> = {
  ios: "iOS",
  web3: "Web3",
  "3d": "3D",
  a11y: "a11y",
  "a&p": "A&P",
  "f&b": "F&B",
  "fp&a": "FP&A",
  "l&d": "L&D",
  "r&d": "R&D",
  "p&l": "P&L",
  "p&c": "P&C",
  "m&a": "M&A",
  "ci/cd": "CI/CD",
  "a/b": "A/B",
};

/**
 * Short keyword tokens reviewed as ordinary words, never acronyms: the chips
 * print them as words ("wind", "spay", "menu"), not "WIND".
 */
export const PLAIN_WORDS: ReadonlySet<string> = new Set([
  "aula", "code", "copy", "cuts", "demo", "feed", "gel", "git", "grid", "jet", "law", "lean", "menu", "menú", "ore", "rig",
  "ship", "sod", "spay", "turf", "wind", "wrap",
]);

/** A token a board of the given industry spells its own way (dbt the data tool is lower case; DBT the therapy is not). */
const INDUSTRY_SPELLING: Record<string, Record<string, string>> = {
  data_engineering: { dbt: "dbt" },
};

/** Little words a title keeps lower-case after its first word ("Director of Product", "Jefe de Obra"). */
const MINOR = new Set(["a", "an", "and", "as", "at", "by", "de", "del", "for", "in", "of", "on", "or", "the", "to", "with", "y"]);

const isAcronym = (w: string, title: boolean) => ACRONYMS.has(w) || (title && TITLE_ONLY_ACRONYMS.has(w));

/** One lower-case token as an acronym, a plural acronym or a special spelling; null when it is a plain word. */
function acronymForm(w: string, title: boolean): string | null {
  if (SPECIAL[w]) return SPECIAL[w];
  if (isAcronym(w, title)) return w.toUpperCase();
  // A plural acronym keeps a lower-case s: SOPs, APIs, RFIs, KPIs. Stems of
  // three letters or more only, so "its" never reads "ITs".
  if (w.length >= 4 && w.endsWith("s") && isAcronym(w.slice(0, -1), title) && w.slice(0, -1).length >= 3) {
    return `${w.slice(0, -1).toUpperCase()}s`;
  }
  return null;
}

/** Splits on spaces, keeping the separators, so a phrase is rebuilt exactly. */
const tokens = (s: string) => s.split(/(\s+)/);

/**
 * A keyword chip's text. Acronyms (and plural acronyms) are upper-cased, a
 * token the scanner's table already capitalises is kept, and every other
 * word is left as the table spells it: the chip's CSS title-cases words for
 * the eye, and the text a crawler reads says "wind", not "WIND".
 */
export function displayKeyword(k: string, industry?: string): string {
  const own = industry ? INDUSTRY_SPELLING[industry] : undefined;
  const parts = tokens(k);
  // A chip that is only "or" is the operating room, not the conjunction.
  if (parts.length === 1 && k.toLowerCase() === "or") return "OR";
  return parts
    .map((t) => {
      if (/^\s+$/.test(t) || t !== t.toLowerCase()) return t;
      if (own && own[t]) return own[t];
      if (SPECIAL[t]) return SPECIAL[t];
      return t.split("/").map((p) => acronymForm(p, false) ?? p).join("/");
    })
    .join("");
}

/** Title case for one plain word, hyphenated parts each capitalised ("E-Commerce"). */
const capitalise = (w: string) => w.replace(/(^|-)(\p{L})/gu, (_, a: string, c: string) => `${a}${c.toUpperCase()}`);

/**
 * A job title or an industry label as a heading: acronyms upper-case ("RN",
 * "VP of Product", "UI Designer", "HR Manager"), little words lower-case after
 * the first word, every other word capitalised. A word the source already
 * spells with a capital is kept as it is.
 */
export function displayTitle(raw: string): string {
  let first = true;
  return tokens(raw.replace(/_/g, " "))
    .map((t) => {
      if (/^\s+$/.test(t) || !t) return t;
      const isFirst = first;
      first = false;
      if (t !== t.toLowerCase()) return t;
      const form = t.split("/").map((p) => acronymForm(p, true)).every(Boolean)
        ? t.split("/").map((p) => acronymForm(p, true)).join("/")
        : null;
      if (form) return form;
      if (!isFirst && MINOR.has(t)) return t;
      return capitalise(t);
    })
    .join("");
}

/** An industry slug ("hr", "customer_success") as its label ("HR", "Customer Success"). */
export const industryLabel = (slug: string): string => displayTitle(slug);

/**
 * CERTIFICATION NAMES, AS THEIR BODIES SPELL THEM. The industry FAQ upper-cased
 * every certification whole ("CERTIFIED ADMINISTRATIVE PROFESSIONAL",
 * "DATABRICKS CERTIFIED"): a certification is a name, so its plain words are
 * capitalised, its acronyms upper-cased (the reviewed list above plus the
 * certification bodies' own below) and a few spelled their own way.
 */
const CERT_ACRONYMS = new Set<string>([
  "abr", "ace", "acf", "acls", "acrp", "acsm", "aia", "ains", "airs", "ap", "apics", "arm", "ata", "atp", "bant", "bcop", "bcps",
  "bicsi", "bls", "cap", "cca", "ccim", "ccm", "ccna", "ccra", "ccrn", "ccrp", "cchi", "cda", "cep", "ceh", "cfa", "cfe", "cfii",
  "cfre", "cgfm", "cha", "chha", "chia", "chmm", "cia", "cic", "cims", "cips", "cissp", "cka", "ckad", "clu", "cltd", "cmc",
  "cmp", "cnp", "cpcu", "cpe", "cpht", "cpim", "cpl", "cqm", "crde", "crs", "cscp", "cscs", "csep", "cspo", "cvt", "cwep",
  "dau", "dbia", "dds", "dele", "dga", "dmcp", "dmd", "dvm", "ece", "efda", "eit", "epa", "fe", "gmdss", "gpc", "gphr", "gri",
  "gsec", "gwo", "hdi", "ibm", "ire", "isa", "issa", "itil", "jd", "lcsw", "leed", "lmft", "lmhc", "lmsw", "lmt", "lpc", "lvt",
  "mba", "meddic", "meddpicc", "mlis", "msw", "nabcep", "nasm", "nbcmi", "nbct", "ncaa", "ncarb", "ncidq", "nrp", "nsca",
  "oscp", "pals", "pca", "phr", "pi", "pmp", "post", "ppl", "psm", "pspo", "ptcb", "ra", "rac", "rcdd", "rdh", "rvt", "socra",
  "spj", "sphr", "stcw", "tesol", "tncc", "twic", "uscg", "vmd",
]);
const CERT_SPECIAL: Record<string, string> = {
  "a+": "A+", chfc: "ChFC", comptia: "CompTIA", datacamp: "DataCamp", "deeplearning.ai": "DeepLearning.AI", edd: "EdD",
  hubspot: "HubSpot", mdiv: "MDiv", "network+": "Network+", pharmd: "PharmD", phd: "PhD", prince2: "PRINCE2", rph: "RPh",
  safe: "SAFe", "sag-aftra": "SAG-AFTRA", "security+": "Security+", servsafe: "ServSafe", "shrm-cp": "SHRM-CP",
  "shrm-scp": "SHRM-SCP", tensorflow: "TensorFlow",
};
export function displayCertification(name: string): string {
  return tokens(name)
    .map((t) => {
      if (/^\s+$/.test(t) || !t) return t;
      if (t !== t.toLowerCase()) return t;
      if (CERT_SPECIAL[t]) return CERT_SPECIAL[t];
      if (SPECIAL[t]) return SPECIAL[t];
      if (CERT_ACRONYMS.has(t) || isAcronym(t, true)) return t.toUpperCase();
      if (/^\d/.test(t)) return t;
      return capitalise(t);
    })
    .join("");
}

/**
 * "a" or "an" before a word, by its sound: "an administrative", "a
 * healthcare", "an HR" (aitch), "a UX". One template printed "on a
 * administrative resume".
 */
export function withArticle(phrase: string): string {
  const first = String(phrase).trim().split(/[\s/]+/)[0] ?? "";
  const acronym = first.length > 1 && first === first.toUpperCase() && /\p{L}/u.test(first);
  const an = acronym
    ? /^[AEFHILMNORSX]/.test(first)
    : /^[aeiou]/i.test(first) && !/^(?:uni|use|usu|ure|eu|one|once)/i.test(first);
  return `${an ? "an" : "a"} ${phrase}`;
}

/**
 * A heading-cased name inside a sentence: plain words lower-case, acronyms
 * kept ("analyze HR resumes", "on RN resumes", "customer success resumes").
 * It replaces name.toLowerCase(), which printed "hr resumes".
 */
export function inSentence(name: string): string {
  return tokens(name)
    .map((t) => {
      if (/^\s+$/.test(t) || !t) return t;
      const parts = t.split("/");
      if (parts.every((p) => SPECIAL[p.toLowerCase()] === p || (p === p.toUpperCase() && /\p{L}/u.test(p) && acronymForm(p.toLowerCase(), true) !== null))) return t;
      if (/^[A-Z0-9&]+s$/.test(t) && acronymForm(t.toLowerCase(), true)) return t;
      return t.toLowerCase();
    })
    .join("");
}

/**
 * A JOB TITLE ITS EMPLOYER TYPED IN CAPITALS, IN TITLE CASE (SEO check
 * 2026-11-15, F12). Job markup carried titles such as "MFG PEE PH PR TECH",
 * "REGISTERED NURSE- HOME CARE" and "PRODEJNÍ ASISTENT V PRODEJNĚ JYSK
 * OLOMOUC", and Google's content policy for job postings asks for no all
 * caps. Only a title with no lower-case letter at all is touched; any other
 * title is the employer's own casing and is returned as it came.
 *
 * Capitals are evidence of nothing in such a title, so each word is judged
 * by what it is, from 142 shouted titles and the 7,688 titles beside them on
 * the board (corpora of 2026-11-08 and 2026-11-15):
 *   - a word of five letters or more is a word ("Registered Nurse"), unless it
 *     is on the reviewed acronym lists above;
 *   - a word of four letters or fewer stays in capitals unless it is a plain
 *     word the board's own mixed-case titles write as one (SHOUTED_PLAIN):
 *     short words in a shouted title are mostly initialisms and call signs
 *     ("MRI", "NICU", "WAND", "KTIV", "PEE"), so the safe default is to leave
 *     them, never to print "Mri";
 *   - a vowelless word is an initialism ("MFG" is printed "Mfg" only because
 *     it is on the short forms below, "PH" stays);
 *   - a letter run touching a digit is a code ("25HH", "MI3", "3D"), except an
 *     ordinal ending ("2nd");
 *   - a single letter stays ("CLASS A", "H/F"), except a gendered ending on
 *     the word before it ("ENFERMERA/O" is "Enfermera/o");
 *   - little words after the first are lower case in the languages the board
 *     carries ("Manager in Training", "Auxiliar de Calidad", "Especialista em
 *     Governança"); "OR" is the operating room and stays.
 */
const SHOUTED_PLAIN = new Set<string>([
  // Read capitalised at least three times as often as in capitals in the board's mixed-case titles.
  "time", "part", "lead", "full", "care", "team", "data", "tech", "days", "day", "tax", "city", "unit", "area", "diem", "post",
  "mall", "tier", "risk", "food", "york", "lab", "week", "head", "rep", "near", "test", "site", "cook", "visa", "west", "bank",
  "non", "vice", "sign", "aide", "med", "park", "chef", "line", "real", "pool", "room", "shop", "surg", "auto", "key", "desk",
  "san", "case", "hour", "fire", "cost", "crew", "only", "host", "java", "work", "vaga", "road", "gas", "mid", "meat", "call",
  "end", "club", "fine", "open", "east", "oil", "air", "your", "deli", "must", "ops", "fee", "tire", "high", "loss", "grad",
  "cash", "town", "core", "cell", "year", "cast", "loan", "math", "car", "term", "pre", "hill", "life", "run", "pay", "free",
  "web", "due", "all", "lane", "hrs", "prep", "main", "yard", "fund", "sous", "wash", "eye", "mass", "lake", "fort", "role",
  "load", "body", "bell", "back", "flex", "bar", "dock", "bus", "sun", "lift", "ads", "spec", "hair", "corp", "talk", "prod",
  "wear", "deal", "paid", "spa", "são", "van", "inn", "fuel", "art", "live", "bulk", "self", "kids", "oak", "rail", "two",
  "user", "mail", "lean", "plan", "pain", "low", "card", "help", "bay", "long", "will", "base", "task", "duty", "tele", "peer",
  "ramp", "next", "pest", "flow", "golf", "lot", "safe", "gold", "fair", "temp", "ear", "epic", "wine", "zone", "mile", "die",
  "paes", "beer", "face", "mech", "grid", "job", "trim", "taco", "hire", "stay", "edge", "blue", "old", "wall", "men", "tag",
  "meal", "join", "hall", "demo", "late", "hand", "path", "down", "seed", "bid", "half", "deep", "king", "tow", "tool", "pump",
  "law", "more", "age", "off", "peds", "rock", "mens", "pick", "nail",
  // Read in the 142 shouted titles themselves.
  "beca", "cake", "debt", "drop", "drug", "gen", "gray", "heme", "home", "jump", "neo", "news", "own", "perú", "pro", "ray",
  "rica", "teen",
]);

/** Short forms of plain words, printed as the board's mixed-case titles print them. */
const SHOUTED_SHORT_FORMS: Record<string, string> = {
  sr: "Sr", jr: "Jr", mgr: "Mgr", asst: "Asst", mfg: "Mfg", dept: "Dept", mgmt: "Mgmt", mktg: "Mktg", acct: "Acct", svc: "Svc",
  svcs: "Svcs", whse: "Whse", mdse: "Mdse", liqr: "Liqr", hwy: "Hwy", st: "St", ave: "Ave", ltd: "Ltd", inc: "Inc",
};

/** Initialisms of five letters or more that a shouted title carries and the lists above do not. */
const SHOUTED_LONG_ACRONYMS = new Set<string>(["ssoma", "scada", "cissp", "navsea", "navair", "usace"]);

/** Little words written in lower case after a title's first word, in the board's languages. */
const SHOUTED_MINOR = new Set<string>([
  "an", "and", "as", "at", "by", "for", "in", "of", "on", "the", "to", "with",
  "de", "del", "y", "el", "los", "las", "con", "para", "por", "en",
  "em", "da", "do", "das", "dos", "na", "no", "nas", "nos", "com",
  "des", "du", "et", "au", "aux", "le", "les",
  "bei", "als", "mit", "für", "im", "und", "zur", "zum", "von", "ve",
]);

const ROMAN = /^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii)$/;
const VOWEL = /[aeiouy]/;
const plainLetters = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "");
/** Letters only Turkish writes (its dotless i lower-cases differently), and only Czech. */
const TURKISH = /[ŞĞİ]/;
const CZECH = /[ĚŠČŘŽŮŤĎŇ]/;
/** Czech one-letter prepositions and conjunctions ("PRODEJNÍ ASISTENT V PRODEJNĚ" is "v prodejně"). */
const CZECH_MINOR = new Set(["v", "s", "z", "k", "u", "o", "a", "i"]);

/**
 * Endings a French, Spanish or Portuguese title writes onto a word for its
 * other gender or its plural, in brackets or after a slash, with no space
 * ("ADMINISTRATIF(VE)", "VENDEUR(EUSE)", "CONSEILLER/ÈRE", "TECHNICIEN(NE)").
 * One letter ("INFIRMIER(E)", "ENFERMERA/O") is read the same way below.
 */
const GENDER_ENDINGS = new Set<string>([
  "ne", "nne", "ve", "le", "lle", "se", "te", "re", "fe", "ère", "ière", "euse", "rice", "trice", "as", "es", "os",
]);
/** Prepositions after which "la" is the article ("À LA DIRECTION", "DE LA CALIDAD"); "SALES REP LA" keeps Los Angeles. */
const ARTICLE_AFTER = new Set<string>(["à", "de"]);
/** A word whose first letter is a capital and whose others are not: what a plain word comes out as. */
const TITLE_CASED = /^\p{Lu}[\p{Ll}\p{M}'’]+$/u;

export function titleFromCapitals(raw: string | null | undefined): string {
  const s = String(raw ?? "");
  // Only a title with no lower-case letter, and at least one letter that has a case.
  if (s !== s.toUpperCase() || s === s.toLowerCase()) return s;
  const locale = TURKISH.test(s) ? "tr" : undefined;
  const czech = CZECH.test(s);
  const upper = (c: string) => c.toLocaleUpperCase(locale);
  const titled = (lower: string) => {
    const chars = [...lower];
    // "O'REILLY" is O'Reilly.
    if (chars.length > 2 && /['’]/.test(chars[1])) return `${upper(chars[0])}${chars[1]}${upper(chars[2])}${chars.slice(3).join("")}`;
    return `${upper(chars[0])}${chars.slice(1).join("")}`;
  };
  type Word = { start: number; end: number; lower: string; out: string; kept: boolean };
  const words: Word[] = [];

  // One word, judged by what it is. `kept` marks a short word left in
  // capitals only because nothing says it is a word (the default below).
  const judge = (word: string, lower: string, at: { inside: boolean; before: string; after: string; gap: string; runBefore: number; previous: string }): { out: string; kept: boolean } => {
    const { inside, before, after, gap, runBefore, previous } = at;
    // A letter run touching a digit is a code, except an ordinal ending.
    if (/\d/.test(before) || /\d/.test(after)) return { out: /\d/.test(before) && /^(?:st|nd|rd|th)$/.test(lower) ? lower : word, kept: false };
    // An ending for the other gender, written onto the word before it with no
    // space: "ENFERMERA/O", "INGENIERO(A)", "ADMINISTRATIF(VE)".
    const attached = (before === "/" || before === "(") && gap === before && runBefore >= 3;
    if (attached && (word.length === 1 || (GENDER_ENDINGS.has(lower) && (before === "/" || after === ")")))) return { out: lower, kept: false };
    if (word.length === 1) {
      if (inside && (lower === "y" || lower === "à" || (czech && CZECH_MINOR.has(lower)))) return { out: lower, kept: false };
      return { out: word, kept: false };
    }
    if (SPECIAL[lower]) return { out: SPECIAL[lower], kept: false };
    const acronym = acronymForm(lower, true);
    if (acronym) return { out: acronym, kept: false };
    if (ROMAN.test(lower) || SHOUTED_LONG_ACRONYMS.has(lower)) return { out: word, kept: false };
    if (inside && SHOUTED_MINOR.has(lower)) return { out: lower, kept: false };
    if (inside && lower === "la" && ARTICLE_AFTER.has(previous)) return { out: lower, kept: false };
    if (SHOUTED_SHORT_FORMS[lower]) return { out: SHOUTED_SHORT_FORMS[lower], kept: false };
    // A little word of three letters or more that starts a part is a word ("-
    // The Ritz"); a two-letter one there is as likely an initialism ("EM APP").
    if (SHOUTED_MINOR.has(lower) && [...lower].length >= 3) return { out: titled(lower), kept: false };
    if (!VOWEL.test(plainLetters(lower))) return { out: word, kept: false };
    if (plainLetters(lower).length <= 4 && !SHOUTED_PLAIN.has(lower)) return { out: word, kept: true };
    return { out: titled(lower), kept: false };
  };

  let previousEnd = -1;
  let previousLength = 0;
  let previousCased = false;
  let previousLower = "";
  const re = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const word = m[0];
    const offset = m.index;
    const gap = previousEnd < 0 ? "" : s.slice(previousEnd, offset);
    // A little word is one between two cased words with only spaces around it:
    // after a dash, a bar, a bracket or a word with no case it starts a part.
    const inside = previousEnd >= 0 && previousCased && /^[),.]?\s+$/.test(gap);
    const at = { inside, before: s[offset - 1] ?? "", after: s[offset + word.length] ?? "", gap, runBefore: previousLength, previous: previousLower };
    const lower = word.toLocaleLowerCase(locale);
    previousEnd = offset + word.length;
    previousLength = word.length;
    previousCased = word !== word.toLowerCase();
    previousLower = lower;
    // "PCA'S" is PCA's and "SPRING'S" is Spring's: the stem is judged on its
    // own and the possessive or plural 's follows it in lower case.
    const own = /^(.+)(['’])s$/u.exec(lower);
    if (own && [...own[1]].length >= 2) {
      const stem = word.slice(0, word.length - 2);
      const judged = judge(stem, own[1], { ...at, after: own[2] });
      words.push({ start: offset, end: previousEnd, lower, out: `${judged.out}${own[2]}s`, kept: false });
      continue;
    }
    const judged = judge(word, lower, at);
    words.push({ start: offset, end: previousEnd, lower, ...judged });
  }

  // A hyphen joins parts of one word: a short part left in capitals only by
  // default is a word when the part it is joined to came out as one
  // ("LIVE-IN", "IN-HOME", "FOLLOW-UP", "CO-MANAGER"), and "CO-" before a
  // hyphen is the prefix. An initialism keeps its capitals ("PA-C",
  // "NON-CDL", "IT-SUPPORT"): only a part that reached the default changes.
  const joined = (a: Word, b: Word) => s.slice(a.end, b.start) === "-";
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w.kept) continue;
      const prev = i > 0 && joined(words[i - 1], w) ? words[i - 1] : null;
      const next = i + 1 < words.length && joined(w, words[i + 1]) ? words[i + 1] : null;
      const word = (x: Word | null) => !!x && TITLE_CASED.test(x.out);
      if (word(prev) || word(next) || (next && w.lower === "co")) {
        w.out = titled(w.lower);
        w.kept = false;
        changed = true;
      }
    }
  }

  let out = "";
  let from = 0;
  for (const w of words) {
    out += s.slice(from, w.start) + w.out;
    from = w.end;
  }
  return out + s.slice(from);
}
