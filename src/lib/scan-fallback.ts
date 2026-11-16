// THE BACKUP SCANNER, KEPT INSIDE WHAT THE SITE PROMISES (S11-150).
//
// The free scan runs on free-keyword-scan. Only when it fails with an outage
// does the page ask the streaming fork, free-keyword-scan-stream. That fork
// has none of what /methodology describes (no rule-based clamp, no "Why this
// score" audit), and it started only after the primary had spent up to its
// 85-second model clock, with a two-minute clock of its own: a result could
// arrive minutes after the "results within {{seconds}} seconds" the site
// states. Two rules now:
//   - the fork runs only inside the scan's own window, counted from the press,
//     and is aborted at its end; with too little of the window left it is
//     not asked at all and the primary's error is shown;
//   - a report it writes is marked partial, reason "fallback", and the banner
//     says the backup wrote it.
import { SCAN_RESULTS_WITHIN_SECONDS } from "@/config/scan-timing";

/** Less than this much of the window left: the fork could not finish, so it is not asked. */
export const STREAM_FALLBACK_MIN_MS = 15_000;

/**
 * The epoch ms the fork must finish by, or null when too little of the
 * scan's window is left to ask it. Pure.
 */
export function streamFallbackDeadline(scanStartedAt: number, now: number = Date.now()): number | null {
  const deadlineAt = scanStartedAt + SCAN_RESULTS_WITHIN_SECONDS * 1000;
  return deadlineAt - now >= STREAM_FALLBACK_MIN_MS ? deadlineAt : null;
}

/**
 * A report the backup scanner wrote: partial, and says why. When the
 * backup's own reply was thin and it hid the sections it left empty (its
 * reason "thin_unfilled", S11-147), the report keeps that fact as
 * partialHidden, so the banner says both.
 */
export function asFallbackReport<T extends object>(report: T): T & { partialResults: true; partialReason: "fallback"; partialHidden?: true } {
  const hidden = (report as { partialReason?: unknown }).partialReason === "thin_unfilled";
  return { ...report, partialResults: true, partialReason: "fallback", ...(hidden ? { partialHidden: true as const } : {}) };
}

/**
 * THE RÉSUMÉ'S LANGUAGE, as either scanner reports it: the primary sends a
 * code ("de"), the backup an object ({code, name}). Lower-case, or null.
 */
export function resumeLanguageCode(detected: unknown): string | null {
  const raw = typeof detected === "string"
    ? detected
    : detected && typeof detected === "object" && typeof (detected as { code?: unknown }).code === "string"
      ? (detected as { code: string }).code
      : "";
  const code = raw.trim().toLowerCase();
  return code || null;
}

/** One problem the scanner's parse note names, as a translation key. */
export type ParseIssue = { key: "fewWords"; n: number } | { key: "lowLetters" | "garbled" | "noSections" } | { text: string };

/**
 * THE PARSE NOTE ABOVE THE REPORT (NB-6, NB-17): the scanner's parseQuality,
 * read into translation keys, or null when there is nothing to say.
 *
 * The scanner writes its issues as English sentences ("only 80 words
 * extracted", "no standard resume sections found"); each known one becomes a
 * key the page says in the reader's language, and an unknown one is kept as
 * its text. Its section check reads English headings only, so for a résumé
 * the scanner itself detected as another language "no standard sections" is
 * not a finding: it is dropped, and the verdict is counted again from what is
 * left (two or more problems: poor; one: fair; none: no note).
 */
export function parseNoteFor(
  parseQuality: { verdict?: string; wordCount?: number; issues?: unknown } | null | undefined,
  detectedLanguage?: unknown,
): { verdict: "fair" | "poor"; issues: ParseIssue[] } | null {
  if (!parseQuality || parseQuality.verdict === "good" || !Array.isArray(parseQuality.issues)) return null;
  const lang = resumeLanguageCode(detectedLanguage);
  const notEnglish = !!lang && lang !== "en";
  const issues: ParseIssue[] = [];
  for (const raw of parseQuality.issues) {
    const said = String(raw ?? "").trim();
    if (!said) continue;
    const few = /^only (\d+) words extracted$/i.exec(said);
    if (few) issues.push({ key: "fewWords", n: Number(few[1]) });
    else if (/^unusually low text-to-symbol ratio$/i.test(said)) issues.push({ key: "lowLetters" });
    else if (/^garbled characters detected$/i.test(said)) issues.push({ key: "garbled" });
    else if (/^no standard resume sections found$/i.test(said)) { if (!notEnglish) issues.push({ key: "noSections" }); }
    else issues.push({ text: said });
  }
  if (issues.length === 0) return null;
  return { verdict: issues.length >= 2 ? "poor" : "fair", issues };
}
