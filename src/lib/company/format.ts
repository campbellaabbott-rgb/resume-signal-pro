/**
 * HOW THE COMPANY PAGE PRINTS A NUMBER, A DATE AND AN AGE.
 *
 * The design spec (2026-10-12, section 2.5) gives the job, company and
 * pricing surfaces one formatter, src/lib/format.ts, built by the design
 * system group in parallel with this one. This module has the same five
 * signatures (count, money, date, ago, percent) so the company page can
 * ship before that file lands, and so the wiring pass can swap the import
 * without touching a call site. Every function defaults to the language the
 * page is showing (i18next's current language).
 *
 * Three rules every figure on the company page obeys through here:
 *   - a count is grouped in the reader's language, and a count we know is a
 *     floor carries "+" ("10,000+"), never an exact-looking figure;
 *   - a calendar date that arrived as YYYY-MM-DD is printed as that day in
 *     every timezone (it is read at UTC noon, never at local midnight, which
 *     would move it a day west of Greenwich);
 *   - an age is our read's age ("46 min ago", "3 hr 32 min ago"), and a
 *     timestamp in the future reads as now, never as a negative age.
 */
import i18n from "i18next";

const lang = (l?: string) => l || i18n.language || "en";

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** "1,653", or "10,000+" when the figure is a floor. */
export function count(n: number, opts: { floor?: boolean; lng?: string } = {}): string {
  if (!isNum(n)) return "";
  const s = new Intl.NumberFormat(lang(opts.lng), { maximumFractionDigits: 0 }).format(Math.round(n));
  return opts.floor ? `${s}+` : s;
}

/** "$14.5B" compact, or "$33,280" in full; the currency's own symbol and the reader's grouping. */
export function money(n: number, currency: string, opts: { compact?: boolean; lng?: string } = {}): string {
  if (!isNum(n)) return "";
  const cur = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat(lang(opts.lng), {
      style: "currency",
      currency: cur,
      notation: opts.compact ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 1 : 0,
    }).format(n);
  } catch {
    return `${cur} ${Math.round(n).toLocaleString()}`;
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A Date for a calendar day or a timestamp; a plain day is read at UTC noon so it never shifts. */
function toDate(iso: string): Date | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = DATE_ONLY.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "12 Oct 2026" (en-GB), "Oct 12, 2026" (en), "12. Okt. 2026" (de). The input when it is not a date. */
export function date(iso: string, opts: { lng?: string } = {}): string {
  const d = toDate(iso);
  if (!d) return String(iso ?? "");
  const plain = DATE_ONLY.test(iso);
  try {
    return new Intl.DateTimeFormat(lang(opts.lng), {
      day: "numeric", month: "short", year: "numeric", ...(plain ? { timeZone: "UTC" } : {}),
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

/** A date and a time of day, in the reader's language and timezone. */
export function dateTime(iso: string, opts: { lng?: string } = {}): string {
  const d = toDate(iso);
  if (!d) return String(iso ?? "");
  try {
    return new Intl.DateTimeFormat(lang(opts.lng), {
      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function unit(n: number, u: "minute" | "hour" | "day", l: string): string {
  try {
    return new Intl.NumberFormat(l, { style: "unit", unit: u, unitDisplay: "short", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n} ${u}`;
  }
}

/**
 * The length of time since `iso`, without the word "ago": "46 min",
 * "3 hr 32 min", "3 days". Under a minute is "0 min", and a time in the
 * future is "0 min" too: an age is never negative.
 */
export function duration(iso: string, opts: { lng?: string; now?: number } = {}): string {
  const d = toDate(iso);
  if (!d) return "";
  const l = lang(opts.lng);
  const ms = Math.max(0, (opts.now ?? Date.now()) - d.getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 60) return unit(min, "minute", l);
  const h = Math.floor(min / 60);
  if (h < 48) {
    const m = min % 60;
    return m > 0 ? `${unit(h, "hour", l)} ${unit(m, "minute", l)}` : unit(h, "hour", l);
  }
  return unit(Math.floor(h / 24), "day", l);
}

/**
 * "46 min ago" in the reader's language. The sentence around the duration
 * comes from the company shard (companyProfile.ago), so word order is the
 * translator's, not ours.
 */
export function ago(iso: string, opts: { lng?: string; now?: number } = {}): string {
  const span = duration(iso, opts);
  if (!span) return "";
  return i18n.t("companyProfile.ago", { duration: span, defaultValue: "{{duration}} ago", lng: opts.lng });
}

/** "53%", from a 0..1 share. */
export function percent(x: number, opts: { lng?: string; digits?: number } = {}): string {
  if (!isNum(x)) return "";
  return new Intl.NumberFormat(lang(opts.lng), { style: "percent", maximumFractionDigits: opts.digits ?? 0 }).format(x);
}
