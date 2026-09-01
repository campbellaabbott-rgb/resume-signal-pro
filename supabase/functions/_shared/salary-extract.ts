// Salary mining: extract a pay range from a posting's own description text.
// Pay-transparency laws mean many postings embed the range as prose even when
// the ATS feed has no structured salary field — this recovers it HONESTLY: the
// returned string is the company's own verbatim text (whitespace-collapsed),
// never a reformatting or an estimate, and extraction is deliberately
// conservative (clear ranges, or a single figure tied to a pay period) so a
// bonus/stipend figure is never presented as compensation.

const K = 1_000;

// "$120,000", "$120k", "€50.000", "£45,000", "$55.50"
const MONEY = String.raw`[$€£]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s?[kK]?`;
// dash/to between two figures
const RANGE_SEP = String.raw`\s*(?:-|–|—|to|through)\s*`;
// pay-period wording that ties a figure to compensation
const PERIOD = String.raw`(?:per\s+(?:hour|year|annum|month|week)|an?\s+(?:hour|year)|hourly|annually|yearly|monthly|\/\s?(?:hr|hour|yr|year|mo|month|wk|week))`;

const RANGE_RE = new RegExp(`(${MONEY})${RANGE_SEP}(${MONEY})(\\s*${PERIOD})?`, "i");
const SINGLE_RE = new RegExp(`(${MONEY})(\\s*${PERIOD})`, "i");

// Figures near these words are one-offs, not compensation.
// Context words that mean the nearby dollar figure is NOT this job's pay.
// Extended 2026-07-26 after live mining incidents: "$500,000 annually" from a
// company's CHARITY boilerplate ("we donate…"), a "£500k quota" (sales target)
// mined as salary, and revenue/funding brags — all of which topped the
// highest-pay sort. The window check runs against ±40 chars of the match, so
// these words only suppress figures they actually describe.
const NOT_PAY = /bonus|sign[- ]?on|stipend|reimburse|referral|allowance|credit|deposit|discount|401|gift|donat\w*|charit\w*|quota|revenue|bookings|funding|raised|valuation|in sales|sales target|budget\w*|grant\w*|scholarship|prize|fundrais\w*/i;

function parseMoney(raw: string): number | null {
  const k = /k\s*$/i.test(raw.trim());
  const digits = raw.replace(/[^0-9.,]/g, "");
  // Disambiguate thousand vs decimal separators: a trailing group of 1-2 digits
  // after . or , is decimal; groups of 3 are thousands ("50.000" = 50000).
  let normalized = digits;
  const m = digits.match(/^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/);
  if (m) normalized = m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "");
  else normalized = digits.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return k ? n * K : n;
}

function plausible(lo: number, hi: number, hourly: boolean): boolean {
  if (lo <= 0 || hi < lo) return false;
  if (hi / Math.max(lo, 1) > 5) return false; // absurd spread = not a pay range
  if (hourly) return lo >= 7 && hi <= 500;
  // annual/monthly/unlabeled magnitudes: a real salary figure
  return lo >= 10_000 && hi <= 2_000_000;
}

// ── structured parsing (for the salary-floor filter + benchmarks) ───────────
// Parses OUR OWN stored salary strings (vendor-structured like lever's
// "$136k–227k/per-year-salary", ashby's "$135K – $180K", recruitee's formatter,
// and the miner's verbatim prose) into a comparable annualized floor. Honest
// annualization: hourly×2080, weekly×52, monthly×12; when no period is stated,
// only values that can't be anything but annual (≥20k) are accepted. Currency
// is NOT converted — the number filters as stated in the posting's own currency.

export interface ParsedSalary {
  min: number;
  max: number | null;
  period: "hour" | "day" | "week" | "month" | "year" | null;
  /** Annualized lower bound, null when the period can't be honestly determined. */
  annualMin: number | null;
  /** Annualized upper bound — only when a real range parsed AND the spread is
      plausible (max ≤ 6× min); otherwise null, never a guess. */
  annualMax: number | null;
  /**
   * Currency as the posting states it: an explicit ISO code wins; else the
   * symbol maps € → EUR, £ → GBP, and a bare $ → USD (documented heuristic —
   * explicit CA$/A$/CAD/AUD are caught first). null when nothing is stated,
   * so aggregates can group by currency instead of mixing € with $.
   */
  currency: string | null;
  /**
   * The factor `min` was multiplied by to get `annualMin` — 2080 for an hourly
   * rate, 260 for a day rate, 52 weekly, 12 monthly, 1 for an already-annual
   * figure; null exactly when annualMin is null.
   *
   * This exists so the annual figure and the salary string the board DISPLAYS
   * can be checked against each other instead of trusted: annualMin is always
   * Math.round(min * annualMultiplier), and when `period` is stated the
   * multiplier is always PERIOD_MULTIPLIER[period]. The "$160-160/per-day-wage"
   * incident was exactly this disagreement — the text said day, the stored
   * annual (332,800) had been computed at 2080 h/yr — and nothing in the
   * returned shape made the contradiction visible.
   */
  annualMultiplier: number | null;
  /**
   * The literal part-time / casual / as-needed signal found in the posting, or
   * null. Reported even when it changed nothing (a stated annual salary is not
   * re-derived from hours), so callers can see WHY a rate went un-annualized.
   */
  partTimeSignal: string | null;
}

// Explicit ISO codes beat symbols; dollar-prefix variants beat the bare $.
// Every known non-US dollar sign (MX$, R$, NZ$, HK$, S$…) MUST be checked
// before the bare-$ fallback — otherwise a peso or real posting gets labeled
// USD and its high nominal value tops the salary ranking (live incident:
// MX$1,152,000 ≈ $63k ranked as $1.15M).
const P_ISO = /\b(USD|EUR|GBP|CAD|AUD|NZD|CHF|SEK|DKK|NOK|PLN|INR|SGD|JPY|BRL|MXN|PHP|HKD)\b/i;
const P_CAD = /C(?:A)?\$/;
const P_AUD = /A(?:U)?\$/;
// Bare-$ countries whose local currency ALSO writes plain "$". A Toronto
// posting saying "$120,000" means CAD — labeling it USD both inflates its
// rank (~1.37x) and lies about the offer. When the caller knows the posting's
// country, the bare $ resolves to that country's dollar; US and unknown stay
// USD (the documented heuristic — most bare-$ postings are US).
const BARE_DOLLAR_BY_COUNTRY: Record<string, string> = {
  CA: "CAD", AU: "AUD", NZ: "NZD", MX: "MXN", SG: "SGD", HK: "HKD",
};

function detectCurrency(s: string, country?: string | null): string | null {
  const iso = s.match(P_ISO);
  if (iso) return iso[1].toUpperCase();
  if (/(?<![A-Za-z])US\$/i.test(s)) return "USD";
  if (P_CAD.test(s)) return "CAD";
  if (P_AUD.test(s)) return "AUD";
  if (/(?<![A-Za-z])NZ\$/i.test(s)) return "NZD";
  if (/(?<![A-Za-z])MX\$/i.test(s)) return "MXN";
  if (/(?<![A-Za-z])HK\$/i.test(s)) return "HKD";
  if (/(?<![A-Za-z])R\$/i.test(s)) return "BRL";
  if (/(?<![A-Za-z])S\$/i.test(s)) return "SGD";
  if (s.includes("€")) return "EUR";
  if (s.includes("£")) return "GBP";
  if (s.includes("₹")) return "INR";
  if (s.includes("₱")) return "PHP";
  if (/zł/i.test(s)) return "PLN";
  // ¥ stays unmapped: JPY vs CNY is a ~20x difference and guessing wrong
  // would misrank those postings badly — unlabeled is honest, mislabeled isn't.
  if (s.includes("$")) return BARE_DOLLAR_BY_COUNTRY[String(country ?? "").toUpperCase()] ?? "USD";
  return null;
}

// Currencies roughly at dollar parity (within ~2x). For these, a "monthly"
// figure above 35k (≥$420k/yr annualized) is almost always an annual salary
// someone mislabeled — annualizing it would amplify the posting's own typo
// 12x and crown it the board's top job. High-nominal currencies (INR, MXN,
// PHP, JPY…) keep the wide cap: ₱90,000/month is a normal wage.
const PARITY_CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SGD"]);
const PARITY_MONTHLY_MAX = 35_000;

// Separator-grouped form first ("120,000" / "50.000"), else plain digits with
// optional decimal ("4000", "22.5") — a bare "4000" must parse whole, not "400".
const P_MONEY = /[$€£]?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:\.\d{1,2})?)\s?([kK])?/;
const P_RANGE = new RegExp(P_MONEY.source + String.raw`\s*(?:-|–|—|to|through)\s*` + P_MONEY.source);
// "an hour"/"a year" are Workday's OWN payRange phrasing ("$29.20 an hour")
// — absent from this vocabulary, 17,641 vendor-stated workday salaries sat
// unannualized (measured 2026-08-24).
const P_HOUR = /per[\s-]?hour|\/\s?hr\b|\/\s?hour|hourly|hour-?wage|\ban?\s+hour\b/i;
const P_WEEK = /per[\s-]?week|\/\s?wk\b|\/\s?week|weekly|\ba\s+week\b/i;
const P_MONTH = /per[\s-]?month|\/\s?mo\b|\/\s?month|monthly|\ba\s+month\b/i;
const P_YEAR = /per[\s-]?(?:year|annum)|\/\s?yr\b|\/\s?year|annual|yearly|year-?salary|\ba\s+year\b/i;
// Day rates ("$160-160/per-day-wage" is lever's own wording for a substitute
// teacher's daily pay). Tested LAST so a posting that says both "annual" and
// "a day" resolves to the annual figure — a day rate mistaken for a salary is
// a 260x error, the reverse is a 1/260x one, and both are worse than the
// conservative reading. Before this existed, "day" matched no period at all,
// fell through to the unlabeled-hourly inference below, and a $160 day rate
// was served as salaryMinAnnual 332,800 (live, 2026-08-25).
const P_DAY = /per[\s-]?day|\/\s?day\b|\bdaily\b|day-?rate|day-?wage|\ba\s+day\b|\bdiem\s+rate\b/i;

// Annualization factors. hour=2080 is 40h x 52w; day=260 is 5d x 52w, chosen
// so the family stays internally CONSISTENT — 2080 / 260 = 8, i.e. a posting
// quoting "$20/hour" and one quoting "$160/day" for the same 8-hour day
// annualize to the same 41,600. 260 is the gross working-day count (paid leave
// sits inside it), not the calendar year (365) and not a net-of-holidays count
// (~250 US, ~228 UK): the hourly factor already uses the gross convention, and
// mixing conventions would make two ways of stating one wage disagree.
export const PERIOD_MULTIPLIER = { hour: 2080, day: 260, week: 52, month: 12, year: 1 } as const;

// Periods whose annualization is an assumption about HOW MUCH the person works
// (a full-time load), not arithmetic on a figure the employer already stated
// per year. Only these are suppressed by the part-time guard below; a stated
// monthly or annual salary is the employer's own number and is left alone.
const LOAD_DEPENDENT = new Set<string>(["hour", "day", "week"]);

// ── part-time / casual guard ────────────────────────────────────────────────
// Every load-dependent factor above silently assumes a full-time schedule. For
// a part-time, casual or as-needed posting that assumption inverts the salary
// floor: measured 2026-08-25, {"q":"teacher","salaryFloor":90000} returned 15
// jobs and 14 were hourly, among them an after-school gymnastics teacher at
// USD 44/hour served as 91,520 (the employer's own page: "part-time, hourly
// positions... clubs are 1.25 to 2.5 hours long") and a substitute teacher at
// $75/hour served as 156,000.
//
// The honest behaviour is to REFUSE the annual figure, not to guess a smaller
// load. A guessed load (say 20h/week) would put a number we invented into a
// filter the user believes is comparing salaries, and it would contradict the
// salary text the board displays beside it — "$44 per hour" next to "$45,760"
// reconciles to no schedule the posting states. A null keeps the row out of
// the salary-floor filter and off the pay sorts while the verbatim rate stays
// visible on the card, which is exactly what the posting supports.
//
// The guard errs toward NOT firing: a false part-time detection hides a real
// full-time job from the filter, so every term below is either an employment
// type stated in a short declarative field, or an unambiguous compound.

export interface SalaryContext {
  /** Posting title. Titles are declarations, not prose — "Substitute Teacher",
   *  "... - Part Time", "Infusion Nurse Practitioner (PRN)". */
  title?: string | null;
  /** Posting description. Prose, so only unambiguous compounds are matched and
   *  every hit must survive the boilerplate window check. */
  description?: string | null;
  /** A vendor employment-type field where one is carried ("Part Time",
   *  "Casual", "Temporary") — iCIMS/Pinpoint expose one. Treated like a title. */
  employmentType?: string | null;
}

// Short declarative fields: a bare employment word here IS the employment type.
const PT_SHORT: RegExp[] = [
  /\bpart[\s-]?time\b/i,
  // "Casual Dining" / "business casual" are cuisine and dress codes, not a
  // contract type — the only forms of the word that are NOT an employment type.
  /\bcasual\b(?!\s*(?:dining|dress|attire|wear|friday))/i,
  /\bsessional\b/i,
  /\bzero[\s-]?hours?\b/i,
  /\bper[\s-]?diem\b/i,
  /\bprn\b/i,
  /\bsubstitute\b/i,
  /\bsupply\s+(?:teacher|staff|work)/i,
  /\bas[\s-]?needed\b|\bas\s+and\s+when\b|\bwhen\s+needed\b/i,
  /\bon[\s-]?call\b/i,
  /\bad[\s-]?hoc\b/i,
  /\bterm[\s-]?time\s+only\b/i,
  /\bbank\s+(?:staff|nurse|worker|shifts?|hours?|contract)\b|\bnhs\s+bank\b/i,
  /\brelief\s+(?:staff|work(?:er)?s?|shifts?|cover|basis|pool)\b/i,
];

// Prose: only forms that cannot mean anything else. "casual" alone is dropped
// here because "casual work environment" and "business casual" are everywhere
// in US descriptions; "as needed" is dropped because live full-time nursing
// descriptions say "evaluates data as frequently as needed" and "seeking
// assistance as needed" (Stanford Clinical Nurse RN 1.0 FTE, checked today) —
// both would have hidden a genuinely full-time $96.35/hour job.
const PT_PROSE: RegExp[] = [
  /\bpart[\s-]?time\b/i,
  /\bcasual\s+(?:hours?|basis|contract|work(?:ers?)?|staff|shifts?|position|role|employment|vacanc)/i,
  /\bzero[\s-]?hours?\s+contract\b/i,
  /\bsessional\b/i,
  /\bterm[\s-]?time\s+only\b/i,
  /\bbank\s+(?:staff|nurse|worker|shifts?|hours?|contract)\b|\bnhs\s+bank\b/i,
  /\brelief\s+(?:staff|work(?:er)?s?|shifts?|cover|basis|pool)\b/i,
];

// A prose hit inside benefits / EEO / pay-policy boilerplate describes the
// employer's POLICY, not this posting's schedule. Every term below was added
// from a real false positive measured against 183 live rows on 2026-08-25:
//   "Part-time employees have access to a wide range of voluntary benefits"
//     (Registered Behavior Technician, $29.00/hr — genuinely part-time, but
//      this sentence is not what says so)
//   "These benefits also apply to part-time employees"
//     (Weld Technician 1st Shift, $29.60/hr — a FULL-TIME job the guard would
//      have hidden from the salary floor)
//   "Salaries for part-time roles will be prorated based upon the agreed upon
//    number of hours" (Capital One Lead Software Engineer, $197,300)
// Checked against +/-80 chars of the hit, the same windowing NOT_PAY uses
// above, and every occurrence is walked — an early boilerplate mention never
// masks a later real one.
// Deliberately shaped, not just the word "benefits": the VI-teacher posting
// says "Job Types: Full-Time, Part-Time, Contract / Pay: $90 per hour /
// Expected Hours: 10-40 per week / Benefits: ..." — a bare `benefit` term put
// that (a real 187,200 overstatement) back into the salary floor.
const PT_BOILERPLATE = /eligib|benefits?\s+(?:package|plan|program|are|also\s+apply|apply|extend|include)|401\(?k|equal\s+opportunit|discriminat|regardless\s+of|reasonable\s+accommodat|paid\s+time\s+off|\bPTO\b|health\s+insurance|pro[\s-]?rate|employees?\s+(?:are|have|has|may|will|receive|also|with|and)/i;

// A stated weekly load below the 30h ACA full-time line is the clearest signal
// there is: the posting itself says how much work there is. Every stated
// figure is collected and the LARGEST wins, so "10-40 hours per week" (a real
// VI-teacher posting, $90/hour) is read as up to full-time and does NOT fire
// here — that posting is caught by its own "Job Types: Full-Time, Part-Time".
const WEEKLY_HOURS = /(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?\s*(?:hours?|hrs?)\s*(?:per|a|each|\/)\s*week/gi;
const FULL_TIME_WEEKLY_HOURS = 30;

function scanShort(s: string): string | null {
  for (const re of PT_SHORT) { const m = s.match(re); if (m) return m[0].toLowerCase(); }
  return null;
}

function scanProse(s: string): string | null {
  for (const re of PT_PROSE) {
    // Walk every occurrence: the first may be boilerplate while a later one is
    // the posting's actual schedule statement.
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of s.matchAll(g)) {
      const i = m.index ?? 0;
      const ctx = s.slice(Math.max(0, i - 80), i + m[0].length + 80);
      if (!PT_BOILERPLATE.test(ctx)) return m[0].toLowerCase();
    }
  }
  let maxHours = 0;
  for (const m of s.matchAll(WEEKLY_HOURS)) {
    maxHours = Math.max(maxHours, Number(m[2] ?? m[1]) || 0, Number(m[1]) || 0);
  }
  if (maxHours > 0 && maxHours < FULL_TIME_WEEKLY_HOURS) return `${maxHours} hours per week`;
  return null;
}

// A title (or vendor employment-type field) that DECLARES full time outranks a
// part-time word found in description prose. Measured 2026-08-25 over 155 live
// rows pulled with their descriptions: exactly one row fired on prose while its
// own title said otherwise — "Genetics Counselor II — … — Full Time"
// ($41.10-$61.65/hour, 85,488), whose only "part-time" sits inside "Eligibility
// for programs listed above may depend on your FTE or status (e.g., full-time,
// part-time, per diem, temporary, etc.)". That word lands 89 chars after
// "Eligibility" — nine characters outside the ±80 boilerplate window — so the
// window alone could not reject it, and the guard hid a declared full-time job
// from the salary floor, which is the one failure this guard must not cause.
// Scoped to the SHORT fields only: a DESCRIPTION reading "Job Types: Full-Time,
// Part-Time" is a posting offering both, not a full-time declaration.
const FT_DECLARED = /\bfull[\s-]?time\b/i;

/**
 * The clearest part-time / casual / as-needed signal in a posting, or null.
 * Exported so the rule can be tested and audited directly against real rows.
 */
export function detectPartTime(ctx: SalaryContext | null | undefined): string | null {
  if (!ctx) return null;
  const short = `${ctx.title ?? ""}\n${ctx.employmentType ?? ""}`;
  // A short-field signal wins outright, including over a full-time word in the
  // same field: "Full Time / Part Time Barista" states both and is ambiguous.
  const stated = scanShort(short);
  if (stated) return stated;
  if (FT_DECLARED.test(short)) return null;
  return scanProse(String(ctx.description ?? "").slice(0, 20_000));
}

export function parseSalaryStructured(
  text: string | null | undefined,
  country?: string | null,
  context?: SalaryContext | null,
): ParsedSalary | null {
  if (!text) return null;
  const s = decodeLegacyEntities(String(text).slice(0, 300));
  const num = (raw: string, k?: string): number | null => {
    const m = raw.match(/^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/);
    const base = m ? Number(m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "")) : Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(base)) return null;
    return k ? base * 1000 : base;
  };
  const period: ParsedSalary["period"] =
    P_HOUR.test(s) ? "hour" : P_WEEK.test(s) ? "week" : P_MONTH.test(s) ? "month"
    : P_YEAR.test(s) ? "year" : P_DAY.test(s) ? "day" : null;

  let min: number | null = null;
  let max: number | null = null;
  const r = s.match(P_RANGE);
  if (r) {
    min = num(r[1], r[2]);
    max = num(r[3], r[4]);
    // "136k–227k" style: the k often marks only one side — normalize magnitude.
    if (min !== null && max !== null && max < min && r[2] && !r[4]) max *= 1000;
    if (min !== null && max !== null && min < max / 900 && !r[2] && r[4]) min *= 1000;
  } else {
    const m1 = s.match(P_MONEY);
    if (m1 && m1[1]) min = num(m1[1], m1[2]);
  }
  if (min === null || min <= 0) return null;

  const currency = detectCurrency(s, country);
  const MULT = PERIOD_MULTIPLIER;
  // `mult` and `annualMin` move together and are never assigned apart, so the
  // returned annualMin cannot drift from the multiplier that produced it.
  let annualMin: number | null = null;
  let mult: number | null = null;
  // The period the annual figure is actually derived from: the stated one, or
  // "hour" when the unlabeled-hourly inference below fires. This — not the
  // stated `period`, which stays null for an inference — is what the part-time
  // guard tests, so a part-time "$44.00 - $52.00" with no period word is
  // suppressed exactly like a part-time "$44 per hour".
  let basis: string | null = period;
  if (period) {
    mult = MULT[period];
    annualMin = min * mult;
    // magnitude sanity per period — a "$5/hour" or "$9,000/hour" is bad data
    const lo = period === "hour" ? 7 : period === "day" ? 40 : period === "week" ? 200 : period === "month" ? 800 : 10_000;
    const hi =
      period === "hour" ? 500
      : period === "day" ? 5_000
      : period === "week" ? 20_000
      : period === "month" ? (currency && PARITY_CURRENCIES.has(currency) ? PARITY_MONTHLY_MAX : 90_000)
      : 2_000_000;
    if (min < lo || min > hi) { annualMin = null; mult = null; basis = null; }
  } else if (min >= 20_000 && min <= 2_000_000) {
    annualMin = min; // unlabeled but unambiguously annual
    mult = 1;
    basis = "year";
  } else if (
    // Unlabeled but unambiguously HOURLY — the symmetric case, same honesty
    // bar. For parity currencies, [7, 200) sits inside ONLY the hourly
    // sanity window: it is below week's floor (200), far below month's
    // (800) and the 20k unlabeled-annual floor. "$22.00 - $24.00" cannot be
    // anything but an hourly rate in USD. 200-500 stays unlabeled — a $300
    // figure is ambiguous with weekly/daily and a wrong period is worse
    // than a missing one. Non-parity currencies (MXN, INR, PHP...) skip the
    // inference entirely: their period windows overlap at these magnitudes.
    currency !== null && PARITY_CURRENCIES.has(currency) &&
    min >= 7 && (max ?? min) < 200 && (max === null || max >= min)
  ) {
    mult = MULT.hour;
    annualMin = min * mult;
    basis = "hour";
  }

  // Part-time / casual guard. Only load-dependent bases are suppressed: a
  // stated monthly or annual figure is the employer's own number, and refusing
  // it would hide a real part-time salary that the posting itself annualized.
  const partTimeSignal = detectPartTime(context);
  if (partTimeSignal && basis !== null && LOAD_DEPENDENT.has(basis)) {
    annualMin = null;
    mult = null;
  }
  // Upper bound follows the SAME honesty rules as the floor: annualized with
  // the floor's multiplier, dropped when the floor was dropped, and dropped
  // when the spread is implausible (a "$50k–$900k" text is not a pay range).
  let annualMax: number | null = null;
  if (annualMin !== null && mult !== null && max !== null && max >= min) {
    // The max side annualizes with the SAME multiplier the min side earned —
    // read off `mult` now rather than re-derived, so the two ends of a range
    // can never be annualized on different assumptions.
    const am = max * mult;
    if (max / Math.max(min, 1) <= 6 && am <= 4_000_000) annualMax = am;
  }
  // Whole dollars: 92.24 * 2080 is 191,859.199…, and a stored float tail is
  // noise everywhere the number is displayed or compared.
  if (annualMin !== null) annualMin = Math.round(annualMin);
  if (annualMax !== null) annualMax = Math.round(annualMax);
  return { min, max, period, annualMin, annualMax, currency, annualMultiplier: mult, partTimeSignal };
}

/** Extract the posting's own pay text, or null when nothing clearly stated. */
// Rows stored before 2026-08-24 can carry literal named entities
// ("$22 &mdash; $24" — greenhouse's own pay footer, un-decoded by the old
// numeric-only entity pass). The ingest decoder is fixed, but stored text is
// immutable until re-fetch, so the miner decodes defensively: 17/200 sampled
// null-salary greenhouse rows held an entity-encoded pay block, every one
// unparseable without this line.
const decodeLegacyEntities = (s: string) =>
  s.replace(/&mdash;/gi, "\u2014").replace(/&ndash;/gi, "\u2013").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");

export function extractSalary(text: string | null | undefined): string | null {
  if (!text) return null;
  const hay = decodeLegacyEntities(text.slice(0, 12_000)).replace(/\s+/g, " ");

  const range = hay.match(RANGE_RE);
  if (range && range.index !== undefined) {
    const ctx = hay.slice(Math.max(0, range.index - 40), range.index + range[0].length + 20);
    if (!NOT_PAY.test(ctx)) {
      const lo = parseMoney(range[1]);
      const hi = parseMoney(range[2]);
      const hourly = /hour|hr|hourly/i.test(range[3] ?? "") ||
        (lo !== null && hi !== null && lo < 1_000 && hi < 1_000 && !/[kK]\s*$/.test(range[1] + range[2]));
      if (lo !== null && hi !== null && plausible(lo, hi, hourly)) {
        return range[0].replace(/\s+/g, " ").trim().slice(0, 200);
      }
    }
    // A money range matched but failed the pay guards (bonus context, absurd
    // spread, wage-floor). The text is ambiguous — do NOT let the single-figure
    // fallback cherry-pick one end of a rejected range. Conservative null.
    return null;
  }

  // Single figure only when explicitly tied to a pay period ("$95,000 per year").
  const single = hay.match(SINGLE_RE);
  if (single && single.index !== undefined) {
    const ctx = hay.slice(Math.max(0, single.index - 40), single.index + single[0].length + 20);
    if (!NOT_PAY.test(ctx)) {
      const v = parseMoney(single[1]);
      const hourly = /hour|hr|hourly/i.test(single[2]);
      if (v !== null && plausible(v, v, hourly)) {
        return single[0].replace(/\s+/g, " ").trim().slice(0, 200);
      }
    }
  }
  return null;
}
