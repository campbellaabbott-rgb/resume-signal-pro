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
const NOT_PAY = /bonus|sign[- ]?on|stipend|reimburse|referral|allowance|credit|deposit|discount|401|gift/i;

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
}

// Separator-grouped form first ("120,000" / "50.000"), else plain digits with
// optional decimal ("4000", "22.5") — a bare "4000" must parse whole, not "400".
const P_MONEY = /[$€£]?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:\.\d{1,2})?)\s?([kK])?/;
const P_RANGE = new RegExp(P_MONEY.source + String.raw`\s*(?:-|–|—|to|through)\s*` + P_MONEY.source);
const P_HOUR = /per[\s-]?hour|\/\s?hr\b|\/\s?hour|hourly|hour-?wage/i;
const P_WEEK = /per[\s-]?week|\/\s?wk\b|\/\s?week|weekly/i;
const P_MONTH = /per[\s-]?month|\/\s?mo\b|\/\s?month|monthly/i;
const P_YEAR = /per[\s-]?(?:year|annum)|\/\s?yr\b|\/\s?year|annual|yearly|year-?salary/i;

export function parseSalaryStructured(text: string | null | undefined): ParsedSalary | null {
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

  const MULT = { hour: 2080, week: 52, month: 12, year: 1 } as const;
  let annualMin: number | null = null;
  if (period) {
    annualMin = min * MULT[period];
    // magnitude sanity per period — a "$5/hour" or "$9,000/hour" is bad data
    const lo = period === "hour" ? 7 : period === "week" ? 200 : period === "month" ? 800 : 10_000;
    const hi = period === "hour" ? 500 : period === "week" ? 20_000 : period === "month" ? 90_000 : 2_000_000;
    if (min < lo || min > hi) annualMin = null;
  } else if (min >= 20_000 && min <= 2_000_000) {
    annualMin = min; // unlabeled but unambiguously annual
  }
  return { min, max, period, annualMin };
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
