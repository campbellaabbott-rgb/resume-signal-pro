/**
 * THE HOMEPAGE'S DATE BASES, IN UTC.
 *
 * A count on the homepage says when it was counted ("counted 17 Oct 2026,
 * 22:45 UTC"). Every reader sees the same moment, so it is printed in UTC
 * with the zone named, never in the reader's own zone without saying so. The
 * day is printed the way src/lib/format.ts prints a day (English reads
 * "17 Oct 2026"), in the interface language.
 */
import i18next from "i18next";

const lang = (lng?: string) => lng || i18next.language || "en";

/** format.ts's date locale: English reads day, month, year; Tagalog is fil. */
function dateLocale(lng: string): string {
  if (lng === "en") return "en-GB";
  if (lng === "tl") return "fil";
  return lng;
}
function numberLocale(lng: string): string {
  if (lng === "en") return "en-US";
  if (lng === "tl") return "fil";
  return lng;
}

export interface UtcStamp {
  /** "17 Oct 2026" */
  date: string;
  /** "22:45" */
  time: string;
  /** The ISO string for <time dateTime>. */
  iso: string;
}

/** The UTC day and 24-hour time of a stamp, or null when it cannot be read. */
export function utcStamp(at: string | number | Date | null | undefined, lng?: string): UtcStamp | null {
  if (at === null || at === undefined || at === "") return null;
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  const l = lang(lng);
  const date = new Intl.DateTimeFormat(dateLocale(l), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return { date, time: `${hh}:${mm}`, iso: d.toISOString() };
}

/**
 * A span of minutes as the language writes a short duration: "2 hr, 52 min"
 * in English, "2 Std., 52 Min." in German. Rounded to the minute; an hour or
 * more keeps hours and minutes, never days (the rail's spans are hours).
 */
export function minutesText(minutes: number, lng?: string): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  const total = Math.max(1, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const parts: { hours?: number; minutes?: number } = hours ? (mins ? { hours, minutes: mins } : { hours }) : { minutes: mins };
  const loc = numberLocale(lang(lng));
  const DF = (Intl as unknown as { DurationFormat?: new (l: string, o: object) => { format: (d: object) => string } }).DurationFormat;
  if (DF) {
    try {
      return new DF(loc, { style: "short" }).format(parts);
    } catch {
      /* fall through to the unit parts */
    }
  }
  const units: string[] = [];
  if (parts.hours) units.push(new Intl.NumberFormat(loc, { style: "unit", unit: "hour", unitDisplay: "short" }).format(parts.hours));
  if (parts.minutes) units.push(new Intl.NumberFormat(loc, { style: "unit", unit: "minute", unitDisplay: "short" }).format(parts.minutes));
  try {
    const LF = (Intl as unknown as { ListFormat?: new (l: string, o: object) => { format: (items: string[]) => string } }).ListFormat;
    if (LF) return new LF(loc, { type: "unit", style: "short" }).format(units);
  } catch {
    /* plain join below */
  }
  return units.join(" ");
}

/** "USAJOBS and SmartRecruiters", joined the way the language joins a list. */
export function andList(items: readonly string[], lng?: string): string {
  const loc = numberLocale(lang(lng));
  try {
    const LF = (Intl as unknown as { ListFormat?: new (l: string, o: object) => { format: (items: string[]) => string } }).ListFormat;
    if (LF) return new LF(loc, { type: "conjunction", style: "long" }).format([...items]);
  } catch {
    /* plain join below */
  }
  return items.join(", ");
}
