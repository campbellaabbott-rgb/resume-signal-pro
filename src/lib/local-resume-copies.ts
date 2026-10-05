/**
 * EVERY COPY OF A RÉSUMÉ THIS BROWSER KEEPS IN LOCAL STORAGE, AND THE ONE
 * FUNCTION THAT CLEARS THEM.
 *
 * Session storage (the résumé text a tab carries between pages) goes when the
 * tab closes. These do not: they survive closing the browser, so /trust lists
 * them as their own row (trustPage.retention.rows.browserLocal) and promises
 * that the results page's clear-browser-data button removes all of them.
 * src/test/the-browser-copies-of-a-resume-are-listed-and-cleared.test.ts
 * holds each key here equal to the key its writer uses, and runs the clear.
 */

/** Exact keys: each is written by the module named beside it. */
export const LOCAL_RESUME_COPY_KEYS = {
  /** src/pages/ResumeBuilder.tsx: the whole résumé being built. */
  builderDraft: "resumeBuilderDraft",
  /** src/pages/FreelanceBoost.tsx: projects, employment timeline, target role. */
  freelanceDraft: "freelanceBoostIntake",
  /** src/hooks/use-scan-history.ts: name, current role and scores of recent scans. */
  scanHistory: "rb_scan_history",
  /** src/hooks/use-personalization.ts: industry, level and skills read from the résumé. */
  personalization: "rb_personalization_profile",
} as const;

/** Key prefixes: one entry per résumé, under a hash of its text. */
export const LOCAL_RESUME_COPY_PREFIXES = {
  /** src/hooks/use-streaming-scan.ts: a finished report, for an instant rescan. */
  scanReport: "resume_scan_cache",
  /** src/components/AISummary.tsx: the AI-written summary, which can use the name. */
  aiSummary: "ai_summary_",
} as const;

/**
 * Removes every key above from this browser's local storage and returns how
 * many it removed. Never throws: storage that is blocked or unavailable has
 * nothing to clear.
 */
export function clearLocalResumeCopies(): number {
  try {
    const exact = new Set<string>(Object.values(LOCAL_RESUME_COPY_KEYS));
    const prefixes = Object.values(LOCAL_RESUME_COPY_PREFIXES);
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (exact.has(key) || prefixes.some((p) => key.startsWith(p)))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
    return doomed.length;
  } catch {
    return 0;
  }
}
