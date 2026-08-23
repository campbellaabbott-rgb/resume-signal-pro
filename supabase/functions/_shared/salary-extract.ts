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
  period: "hour" | "week" | "month" | "year" | null;
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

export function parseSalaryStructured(text: string | null | undefined, country?: string | null): ParsedSalary | null {
  if (!text) return null;
  const s = String(text).slice(0, 300);
  const num = (raw: string, k?: string): number | null => {
    const m = raw.match(/^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/);
    const base = m ? Number(m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "")) : Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(base)) return null;
    return k ? base * 1000 : base;
  };
  const period: ParsedSalary["period"] =
    P_HOUR.test(s) ? "hour" : P_WEEK.test(s) ? "week" : P_MONTH.test(s) ? "month" : P_YEAR.test(s) ? "year" : null;

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
  const MULT = { hour: 2080, week: 52, month: 12, year: 1 } as const;
  let annualMin: number | null = null;
  if (period) {
    annualMin = min * MULT[period];
    // magnitude sanity per period — a "$5/hour" or "$9,000/hour" is bad data
    const lo = period === "hour" ? 7 : period === "week" ? 200 : period === "month" ? 800 : 10_000;
    const hi =
      period === "hour" ? 500
      : period === "week" ? 20_000
      : period === "month" ? (currency && PARITY_CURRENCIES.has(currency) ? PARITY_MONTHLY_MAX : 90_000)
      : 2_000_000;
    if (min < lo || min > hi) annualMin = null;
  } else if (min >= 20_000 && min <= 2_000_000) {
    annualMin = min; // unlabeled but unambiguously annual
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
    annualMin = min * 2080;
  }
  // Upper bound follows the SAME honesty rules as the floor: annualized with
  // the floor's multiplier, dropped when the floor was dropped, and dropped
  // when the spread is implausible (a "$50k–$900k" text is not a pay range).
  let annualMax: number | null = null;
  if (annualMin !== null && max !== null && max >= min) {
    // The max side annualizes with WHATEVER multiplier the min side earned —
    // stated period, inferred-hourly (annualMin/min recovers 2080), or 1.
    const mult = period ? { hour: 2080, week: 52, month: 12, year: 1 }[period] : (min > 0 ? annualMin / min : 1);
    const am = max * mult;
    if (max / Math.max(min, 1) <= 6 && am <= 4_000_000) annualMax = am;
  }
  // Whole dollars: 92.24 * 2080 is 191,859.199…, and a stored float tail is
  // noise everywhere the number is displayed or compared.
  if (annualMin !== null) annualMin = Math.round(annualMin);
  if (annualMax !== null) annualMax = Math.round(annualMax);
  return { min, max, period, annualMin, annualMax, currency };
}

/** Extract the posting's own pay text, or null when nothing clearly stated. */
export function extractSalary(text: string | null | undefined): string | null {
  if (!text) return null;
  const hay = text.slice(0, 12_000).replace(/\s+/g, " ");

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
