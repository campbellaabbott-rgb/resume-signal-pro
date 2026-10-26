/**
 * A count's stamp in UTC: "17 Oct 2026" and "22:45", for "counted
 * {date}, {time} UTC". src/lib/format.ts prints dateTime in the reader's own
 * time zone, which a line that says "UTC" cannot use; the locale mapping is
 * format.ts's (English reads day, month, year; Tagalog formats as fil).
 */
function dateLocale(lng: string): string {
  if (!lng || lng === "en") return "en-GB";
  if (lng === "tl") return "fil";
  return lng;
}

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function utcDate(v: string | number | Date | null | undefined, lng: string): string {
  const d = toDate(v);
  if (!d) return "";
  return new Intl.DateTimeFormat(dateLocale(lng), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export function utcTime(v: string | number | Date | null | undefined, lng: string): string {
  const d = toDate(v);
  if (!d) return "";
  return new Intl.DateTimeFormat(dateLocale(lng), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(d);
}

/** "SmartRecruiters and USAJOBS", joined in the reader's language. */
export function listOf(items: readonly string[], lng: string): string {
  try {
    const LF = (Intl as unknown as { ListFormat?: new (l: string, o: object) => { format: (x: readonly string[]) => string } }).ListFormat;
    if (LF) return new LF(lng === "tl" ? "fil" : lng || "en", { style: "long", type: "conjunction" }).format(items);
  } catch {
    /* fall through to a plain join */
  }
  return items.join(", ");
}
