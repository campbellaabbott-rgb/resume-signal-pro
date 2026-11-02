/**
 * THE GAP REPORT, MEASURED AGAINST THE RÉSUMÉ MATCHING USES NOW (S13-093).
 *
 * WHAT WAS WRONG. /account's "What to fix next" and "Your skill gaps" counted
 * each tracked posting's fit_missing as it was stored: measured against
 * whichever résumé was newest when the job was saved (or the version a manual
 * check used), however long ago. Pin another résumé, or scan a better one, and
 * the report still listed the old gaps and handed them to the builder with the
 * new text. And a posting the résumé fully matched (fit_missing empty) was
 * dropped from "of N roles", so every share read higher than it was.
 *
 * WHAT HOLDS NOW. A row's stored fit counts only when it was measured against
 * the résumé matching uses now: the row's scan_id is the version its fit was
 * computed from (a board save stamps the latest scan, a manual check the
 * version it checked), so it counts when that is the matching scan. Every
 * other row with a stored posting is measured again against the matching
 * résumé (application-fit, deterministic keyword coverage), held for this tab
 * only, never written over the row (the stored fit is what the application
 * was SENT with, which appIntel reads). A row that can be measured neither
 * way is left out. The denominator is every row measured, fully matched ones
 * included.
 */

export type GapRow = {
  id: string;
  scan_id: string | null;
  fit_pct?: number | null;
  fit_missing?: string[] | null;
  job_posting?: string | null;
};

export type Fit = { pct: number | null; missing: string[] };

/** A posting long enough for application-fit to measure (its own floor is 100 characters). */
export const MIN_POSTING_CHARS = 100;
/** How many rows one page load re-measures, newest first. */
export const REMEASURE_PER_LOAD = 12;
/** After a refusal (the fit check's hourly limit, an outage), how long the page waits before asking again. */
export const REMEASURE_PAUSE_MS = 10 * 60 * 1000;

/**
 * What a re-measurement depends on, per row: its id, the version it was
 * measured against, its stored fit and how much posting it holds. A status
 * change or a note leaves it the same, so it starts nothing again.
 */
export function remeasureKey(rows: ReadonlyArray<GapRow>): string {
  return rows.map((r) => `${r.id}:${r.scan_id ?? ""}:${r.fit_pct ?? ""}:${(r.job_posting ?? "").length}`).join("|");
}

/**
 * The scan whose stored fits count: the pinned scan if it is in the history
 * with its text, otherwise the latest. Pasted text has no scan, so no stored
 * fit counts against it (null).
 */
export function gapBasisScanId(
  matching: { scanId: string | null; text: string | null },
  scans: ReadonlyArray<{ id: string; resume_text?: string | null }>,
): string | null {
  if (matching.text) return null;
  if (matching.scanId && scans.some((s) => s.id === matching.scanId && s.resume_text)) return matching.scanId;
  return scans[0]?.id ?? null;
}

/** The fit a row contributes now, or null when it has none measured against the basis. */
export function currentFit(row: GapRow, basis: string | null, fresh: Readonly<Record<string, Fit>>): Fit | null {
  if (fresh[row.id]) return fresh[row.id];
  if (basis !== null && row.scan_id === basis && typeof row.fit_pct === "number") {
    return { pct: row.fit_pct, missing: Array.isArray(row.fit_missing) ? row.fit_missing : [] };
  }
  return null;
}

/** Rows to measure again against the matching résumé: no current fit, and a posting to measure. */
export function rowsToRemeasure(rows: ReadonlyArray<GapRow>, basis: string | null, fresh: Readonly<Record<string, Fit>>, max = REMEASURE_PER_LOAD): GapRow[] {
  return rows
    .filter((r) => !currentFit(r, basis, fresh) && (r.job_posting ?? "").trim().length >= MIN_POSTING_CHARS)
    .slice(0, max);
}

/**
 * The keywords most often missing across the rows measured against the
 * matching résumé: at least 3 rows measured, a keyword missing from at least
 * 2, the top 5. withFit counts every measured row, fully matched ones too.
 */
export function skillGapOf(rows: ReadonlyArray<GapRow>, basis: string | null, fresh: Readonly<Record<string, Fit>>): { top: Array<[string, number]>; withFit: number } | null {
  const counts = new Map<string, number>();
  let withFit = 0;
  for (const r of rows) {
    const fit = currentFit(r, basis, fresh);
    if (!fit || fit.pct === null) continue;
    withFit++;
    for (const k of new Set(fit.missing)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (withFit < 3) return null;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 2).slice(0, 5);
  return top.length > 0 ? { top, withFit } : null;
}

/** Which résumé a cached re-measurement was made against: a short hash of its text. */
export function resumeFingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/**
 * HOW MANY AUTOMATIC RE-MEASUREMENTS AN HOUR, ACROSS EVERY LOAD AND TAB (the
 * fixer's review). application-fit allows one address 60 checks an hour, and
 * the page ran up to REMEASURE_PER_LOAD of them on every open, in every new
 * tab: opening /account a few times spent the checks a person runs
 * themselves on the board, which then failed as rate-limited. Now the page
 * spends at most this many an hour on its own, and a row measured once is
 * kept for the tab (readGapFits), so a reload repeats nothing. The rest are
 * measured over the next hours.
 */
export const AUTO_REMEASURE_PER_HOUR = 6;
/** When the page's automatic checks were spent (times only, no personal data; this browser). */
export const GAP_AUTO_SPEND_KEY = "rb_gap_auto_spend";
const HOUR_MS = 60 * 60 * 1000;

function spentThisHour(now: number): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(GAP_AUTO_SPEND_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((t): t is number => typeof t === "number" && t > now - HOUR_MS && t <= now) : [];
  } catch { return []; }
}

/** How many automatic re-measurements the page may still start this hour. */
export function autoRemeasureAllowance(now: number = Date.now()): number {
  return Math.max(0, AUTO_REMEASURE_PER_HOUR - spentThisHour(now).length);
}

/** Records one automatic re-measurement; false when the hour's allowance is already spent. */
export function spendAutoRemeasure(now: number = Date.now()): boolean {
  const spent = spentThisHour(now);
  if (spent.length >= AUTO_REMEASURE_PER_HOUR) return false;
  try { localStorage.setItem(GAP_AUTO_SPEND_KEY, JSON.stringify([...spent, now])); } catch { /* storage blocked: this load's own cap still holds */ }
  return true;
}

/** This tab's re-measurements (one key, cleared at sign-out with the other personal copies). */
export const GAP_FITS_KEY = "rb_gap_fits";

export function readGapFits(fingerprint: string): Record<string, Fit> {
  try {
    const v = JSON.parse(sessionStorage.getItem(GAP_FITS_KEY) ?? "null") as { fp?: string; fits?: Record<string, Fit> } | null;
    return v && v.fp === fingerprint && v.fits && typeof v.fits === "object" ? v.fits : {};
  } catch { return {}; }
}

export function writeGapFits(fingerprint: string, fits: Record<string, Fit>): void {
  try { sessionStorage.setItem(GAP_FITS_KEY, JSON.stringify({ fp: fingerprint, fits })); } catch { /* storage blocked: measured again next load */ }
}
