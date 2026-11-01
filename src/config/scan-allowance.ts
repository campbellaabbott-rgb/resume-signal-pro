/**
 * THE FREE SCAN'S DAILY ALLOWANCE, as the scanner enforces it (register
 * S13-094).
 *
 * MIRRORS FREE_SCANS_PER_DAY and SIGNED_IN_SCANS_PER_DAY in
 * supabase/functions/free-keyword-scan/index.ts (and its stream fallback),
 * which are what refuse the next scan. The page typed "7 free scans per day"
 * into the uploader's footer in all nine locales whatever the sign-in state,
 * while a signed-in account gets 15, and three '|| 7' fallbacks in Index.tsx
 * repeated it. Every sentence that states the allowance now reads it from
 * here, and src/test/the-free-scan-allowance-is-read-from-one-module.test.tsx
 * fails if this drifts from either server.
 */
export const FREE_SCANS_PER_DAY = 7;
export const SIGNED_IN_SCANS_PER_DAY = 15;

/** The free scans a day this visitor gets: more once signed in. */
export function scansPerDayFor(signedIn: boolean): number {
  return signedIn ? SIGNED_IN_SCANS_PER_DAY : FREE_SCANS_PER_DAY;
}
