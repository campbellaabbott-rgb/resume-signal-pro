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
