/**
 * THE ONLY WAY A JOB, COMPANY OR PRICING SURFACE PRINTS A NUMBER.
 *
 * The company page audit (2026-10-11) found one page printing "19936+",
 * "10,000+" and "19953" for the same open-role count, "1943 offene Stellen"
 * with no separator in German, money hard-coded as "$14.5B" in every locale,
 * and dates as "2026-09-03" beside "9/18/2026, 4:49:41 PM". Every one of those
 * was a number formatted where it was printed. They are formatted here.
 *
 * Every function defaults to the interface language (i18next's current
 * language, the same instance src/i18n/index.ts configures) and takes an
 * explicit `lng` for tests and for surfaces that print in another language.
 */
import i18next from "i18next";

type Lng = { lng?: string };

const lang = (o?: Lng) => o?.lng || i18next.language || "en";

/** Interface code → Intl locale for numbers and money. */
function numberLocale(lng: string): string {
  if (lng === "en") return "en-US";
  if (lng === "tl") return "fil";
  return lng;
}

/**
 * Interface code → Intl locale for dates. English reads day, month, year
 * ("12 Oct 2026"): one unambiguous order for every English page.
 */
function dateLocale(lng: string): string {
  if (lng === "en") return "en-GB";
  if (lng === "tl") return "fil";
  return lng;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(iso: string | number | Date | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * "1,653"; with `floor`, "10,000+" (a count we stop at, not a census).
 * A non-finite value prints as an empty string, never as "NaN".
 *
 * `compact` prints a large plain figure the short way ("62K"), and `digits`
 * fixes its fraction digits: a range whose two ends would round to one
 * figure asks for one more digit ("61.8K–62.3K", the listing pay estimate).
 */
export function count(n: number | null | undefined, opts: Lng & { floor?: boolean; compact?: boolean; digits?: number } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const s = opts.compact
    ? new Intl.NumberFormat(numberLocale(lang(opts)), {
        notation: "compact",
        minimumFractionDigits: opts.digits ?? 0,
        maximumFractionDigits: opts.digits ?? 1,
      }).format(n)
    : new Intl.NumberFormat(numberLocale(lang(opts)), { maximumFractionDigits: 0 }).format(Math.round(n));
  return opts.floor ? `${s}+` : s;
}

/**
 * Money in the currency the figure was stated in. Compact for headline
 * figures ("$14.5B", German "14,5 Mrd. $"); otherwise whole units, or cents
 * when the figure carries them ($29.92 stays $29.92). `digits` fixes the
 * fraction digits instead (our own rounded estimates: "$62K", or "$61.8K"
 * where two ends of a range would otherwise print one figure).
 */
export function money(
  n: number | null | undefined,
  currency: string = "USD",
  opts: Lng & { compact?: boolean; digits?: number } = {},
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const cur = /^[A-Z]{3}$/.test(String(currency ?? "").toUpperCase()) ? String(currency).toUpperCase() : "USD";
  const hasCents = !opts.compact && Math.round(n * 100) % 100 !== 0;
  const min = opts.digits ?? (hasCents ? 2 : 0);
  const max = opts.digits ?? (opts.compact ? 1 : hasCents ? 2 : 0);
  try {
    return new Intl.NumberFormat(numberLocale(lang(opts)), {
      style: "currency",
      currency: cur,
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    }).format(n);
  } catch {
    return `${cur} ${count(n, { lng: opts.lng })}`;
  }
}

/** "12 Oct 2026". A date-only string is a calendar day and is printed as that day, in no time zone. */
export function date(iso: string | number | Date | null | undefined, opts: Lng = {}): string {
  const d = toDate(iso);
  if (!d) return "";
  const dayOnly = typeof iso === "string" && DATE_ONLY.test(iso);
  return new Intl.DateTimeFormat(dateLocale(lang(opts)), {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(dayOnly ? { timeZone: "UTC" } : {}),
  }).format(d);
}

/** "12 Oct 2026, 14:05" in the reader's own time zone. */
export function dateTime(iso: string | number | Date | null | undefined, opts: Lng = {}): string {
  const d = toDate(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(dateLocale(lang(opts)), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

type DurationParts = { days?: number; hours?: number; minutes?: number };

function durationText(parts: DurationParts, lng: string): string {
  const loc = numberLocale(lng);
  const DF = (Intl as unknown as { DurationFormat?: new (l: string, o: object) => { format: (d: DurationParts) => string } }).DurationFormat;
  if (DF) {
    try {
      return new DF(loc, { style: "short" }).format(parts);
    } catch {
      /* fall through to the unit parts */
    }
  }
  const units: string[] = [];
  const unit = (v: number | undefined, u: "day" | "hour" | "minute") => {
    if (!v) return;
    units.push(new Intl.NumberFormat(loc, { style: "unit", unit: u, unitDisplay: u === "day" ? "long" : "short" }).format(v));
  };
  unit(parts.days, "day");
  unit(parts.hours, "hour");
  unit(parts.minutes, "minute");
  try {
    const LF = (Intl as unknown as { ListFormat?: new (l: string, o: object) => { format: (items: string[]) => string } }).ListFormat;
    if (LF) return new LF(loc, { type: "unit", style: "short" }).format(units);
    return units.join(" ");
  } catch {
    return units.join(" ");
  }
}

/**
 * "46 min ago", "3 hr, 32 min ago", "2 days ago". Inside the localized
 * format.ago sentence, so word order is the language's own ("vor 46 Min.").
 * A time in the future, or under a minute old, reads "just now": a clock
 * skew never prints a negative age.
 */
export function ago(iso: string | number | Date | null | undefined, opts: Lng & { now?: number } = {}): string {
  const d = toDate(iso);
  if (!d) return "";
  const lng = lang(opts);
  const now = opts.now ?? Date.now();
  const mins = Math.floor((now - d.getTime()) / 60_000);
  if (mins < 1) return i18next.t("format.justNow", { lng, defaultValue: "just now" });
  let parts: DurationParts;
  if (mins < 60) parts = { minutes: mins };
  else if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    parts = m ? { hours: h, minutes: m } : { hours: h };
  } else parts = { days: Math.floor(mins / (24 * 60)) };
  const duration = durationText(parts, lng);
  return i18next.t("format.ago", { lng, duration, defaultValue: "{{duration}} ago" });
}

export type PayPeriod = "hour" | "day" | "week" | "month" | "year";

/** "/hr", "/yr", "/mo" in the interface language. */
export function period(p: PayPeriod, opts: Lng = {}): string {
  const fallback: Record<PayPeriod, string> = { hour: "/hr", day: "/day", week: "/wk", month: "/mo", year: "/yr" };
  return i18next.t(`format.period.${p}`, { lng: lang(opts), defaultValue: fallback[p] });
}

/** A share 0..1 as "23%". `digits` for a finer figure; a non-finite share prints nothing. */
export function percent(x: number | null | undefined, opts: Lng & { digits?: number } = {}): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "";
  const digits = opts.digits ?? 0;
  return new Intl.NumberFormat(numberLocale(lang(opts)), {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(x);
}

/** The ISO string a <time dateTime> attribute carries, or undefined. */
export function isoAttr(iso: string | number | Date | null | undefined): string | undefined {
  const d = toDate(iso);
  if (!d) return undefined;
  return typeof iso === "string" && DATE_ONLY.test(iso) ? iso : d.toISOString();
}
