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
 * WORK THAT EXISTS NOWHERE ELSE (S14X-097). The builder's résumé and Freelance
 * Boost's intake have no copy on the server: a sign-out that deleted them
 * without a word deleted the only copy. Sign-out asks first when either holds
 * something typed (src/components/auth/SignOutChoice.tsx), and "keep it" keeps
 * exactly these two keys.
 */
export const LOCAL_WORK_KEYS: readonly string[] = [LOCAL_RESUME_COPY_KEYS.builderDraft, LOCAL_RESUME_COPY_KEYS.freelanceDraft];

/** Fields that hold no typed work: entry ids and the two Freelance Boost choices that always have a value. */
const NOT_TYPED = new Set(["id", "situation", "workMode"]);
function typed(v: unknown, key = ""): boolean {
  if (NOT_TYPED.has(key)) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some((x) => typed(x));
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).some(([k, x]) => typed(x, k));
  return false;
}

/** Which of the two hold something typed (an empty form Freelance Boost saved on a visit is nothing). Never throws. */
export function localWork(): { builder: boolean; freelance: boolean } {
  const has = (key: string) => {
    try {
      const raw = localStorage.getItem(key);
      return !!raw && typed(JSON.parse(raw));
    } catch {
      return false;
    }
  };
  return { builder: has(LOCAL_RESUME_COPY_KEYS.builderDraft), freelance: has(LOCAL_RESUME_COPY_KEYS.freelanceDraft) };
}

/**
 * Removes every key above from this browser's local storage and returns how
 * many it removed. Never throws: storage that is blocked or unavailable has
 * nothing to clear. keepWork leaves the two LOCAL_WORK_KEYS (the person chose
 * to keep them on this device).
 */
export function clearLocalResumeCopies(opts?: { keepWork?: boolean }): number {
  try {
    const exact = new Set<string>(Object.values(LOCAL_RESUME_COPY_KEYS));
    if (opts?.keepWork) for (const k of LOCAL_WORK_KEYS) exact.delete(k);
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
