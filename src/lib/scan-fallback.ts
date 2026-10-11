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
