/**
 * PAY, AS A LISTING PRINTS IT — one formatter for the card, the pane and the
 * posting page, so the three cannot print one posting's pay three ways (audit
 * JL5: the page printed "$29.92-$38.07 per hour" while the card beside it
 * printed "≈62k–79k/year as stated" with no period, and a monthly
 * "$1,200-$1,600" became "1k–2k" in the annual fragment).
 *
 * THE RULES, each pinned by src/test/pay-prints-its-period-or-no-annual-estimate.test.ts:
 *   - the employer's text is tidied notationally and never re-computed
 *     (displaySalary): hourly cents survive ("$29.92" stays "$29.92");
 *   - OUR estimate is a separate figure, marked "≈", and it exists only when
 *     the employer's period is known and is not already a year — no annual
 *     figure is ever printed for pay whose period we do not know;
 *   - an amount under 10,000 is never abbreviated to "k" ($1,200 stays $1,200);
 *   - both ends of a range survive the rounding: when the compact form would
 *     print one number twice, a decimal is added rather than an end dropped;
 *   - a currency symbol is printed for our estimate only when the employer's
 *     currency is a stated ISO code — "$" alone is four currencies.
 */
import { displaySalary } from "@/lib/salary-display";
import type { ListingJob } from "./types";

export const PAY_BASIS_KEYS = ["hour", "day", "week", "month", "year"] as const;
export type PayBasisKey = (typeof PAY_BASIS_KEYS)[number];
/** English fallbacks for the main-locale keys jobsPage.payBasis.* (the card's and pane's existing words). */
export const PAY_BASIS_FALLBACK: Record<PayBasisKey, string> = {
  hour: "hourly rate", day: "daily rate", week: "weekly rate", month: "monthly rate", year: "annual rate",
};

const PAY_BASIS_ALREADY_SAID: Record<PayBasisKey, RegExp> = {
  hour: /\bhour|\bhourly\b|\/\s*h(r|our)\b|\bp\/h\b/,
  day: /\bday\b|\bdaily\b|\bper diem\b|\/\s*day\b/,
  week: /\bweek|\bweekly\b|\/\s*w(k|eek)\b/,
  month: /\bmonth|\bmonthly\b|\/\s*mo(nth)?\b/,
  year: /\byear|\byearly\b|\bannual|\bannum\b|\bp\.?a\.?\b|\/\s*(yr|year)\b/,
};

/** The employer's period, or null for anything outside the five. Never inferred from an amount. */
export function statedPeriod(salaryPeriod: string | null | undefined): PayBasisKey | null {
  if (typeof salaryPeriod !== "string") return null;
  const key = salaryPeriod.trim().toLowerCase();
  return (PAY_BASIS_KEYS as readonly string[]).includes(key) ? (key as PayBasisKey) : null;
}

/** The period to NAME beside the pay text: the stated one, unless the text already says it. (Jobs.tsx payBasisToName.) */
export function payBasisToName(salary: string | null | undefined, salaryPeriod: string | null | undefined): PayBasisKey | null {
  const key = statedPeriod(salaryPeriod);
  if (!key) return null;
  return PAY_BASIS_ALREADY_SAID[key].test(String(salary ?? "").toLowerCase()) ? null : key;
}

function containsWord(text: string, word: string): boolean {
  const hay = text.toLowerCase();
  const needle = word.toLowerCase();
  const isLetter = (c: string) => /[a-z]/.test(c);
  let i = hay.indexOf(needle);
  while (i !== -1) {
    if (!isLetter(i === 0 ? "" : hay[i - 1]) && !isLetter(hay[i + needle.length] ?? "")) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

/** A stated three-letter currency code, or null. */
export function statedCurrency(salaryCurrency: string | null | undefined): string | null {
  if (typeof salaryCurrency !== "string") return null;
  const code = salaryCurrency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** The currency code to name beside the pay text when the text does not already name it. (Jobs.tsx statedCurrencyCode.) */
export function statedCurrencyCode(salary: string | null | undefined, salaryCurrency: string | null | undefined): string | null {
  const code = statedCurrency(salaryCurrency);
  if (!code) return null;
  return containsWord(String(salary ?? ""), code) ? null : code;
}

const finitePositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * One amount of OUR estimate. Compact ("$62K", "62.000 €"-style per locale)
 * only from 10,000 up; below that the whole number, grouped.
 */
export function formatAmount(n: number, lng: string, currency: string | null, fractionDigits = 0): string {
  const compact = Math.abs(n) >= 10_000;
  const opts: Intl.NumberFormatOptions = {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? fractionDigits : 0,
    minimumFractionDigits: compact ? fractionDigits : 0,
  };
  try {
    return new Intl.NumberFormat(lng || "en", currency ? { ...opts, style: "currency", currency } : opts).format(n);
  } catch {
    return new Intl.NumberFormat(lng || "en", opts).format(n);
  }
}

/** "62K–79K" with both ends kept: one decimal is added when rounding would print one number twice. */
export function formatAmountRange(min: number, max: number | null, lng: string, currency: string | null): string {
  if (max == null || !(max > min)) return formatAmount(min, lng, currency);
  for (const digits of [0, 1, 2]) {
    const lo = formatAmount(min, lng, currency, digits);
    const hi = formatAmount(max, lng, currency, digits);
    if (lo !== hi) return `${lo}–${hi}`;
  }
  return `${formatAmount(min, lng, currency, 2)}–${formatAmount(max, lng, currency, 2)}`;
}

export interface ListingPay {
  /** The employer's text, tidied notationally (never re-computed). */
  text: string;
  /** Exactly as the feed stored it, for the title attribute. */
  raw: string;
  /** A currency code to print beside the text, when the text does not name it. */
  currencyCode: string | null;
  /** A period to name beside the text, when the text does not name it. */
  basis: PayBasisKey | null;
  /** OUR annual estimate ("62K–79K", currency-marked when the currency is stated), or null. */
  annual: string | null;
}

/**
 * The pay a listing prints, or null when the posting states none we could
 * read (the caller then prints our-reading copy, never "states no pay").
 */
export function listingPay(
  job: Pick<ListingJob, "salary" | "salaryMinAnnual" | "salaryMaxAnnual" | "salaryPeriod" | "salaryCurrency">,
  lng: string,
): ListingPay | null {
  const raw = typeof job.salary === "string" ? job.salary.trim() : "";
  if (!raw) return null;
  const period = statedPeriod(job.salaryPeriod);
  // OUR ARITHMETIC ONLY WHERE THE PERIOD IS KNOWN AND IS NOT A YEAR.
  const annual = period && period !== "year" && finitePositive(job.salaryMinAnnual)
    ? formatAmountRange(job.salaryMinAnnual, finitePositive(job.salaryMaxAnnual) ? job.salaryMaxAnnual : null, lng, statedCurrency(job.salaryCurrency))
    : null;
  return {
    text: displaySalary(raw),
    raw,
    currencyCode: statedCurrencyCode(raw, job.salaryCurrency),
    basis: payBasisToName(raw, job.salaryPeriod),
    annual,
  };
}
