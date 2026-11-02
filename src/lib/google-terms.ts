/**
 * THE TERMS A GOOGLE ACCOUNT AGREED TO (S12-078).
 *
 * A password or code sign-up stores which Terms it agreed to, and when, in
 * the account's own metadata (AuthContext.termsAcceptance). An account made
 * through Google stored nothing: the press leaves for the provider and comes
 * back with a session, and no call carried the acceptance.
 *
 * So the press on the sign-in page, where the Terms line is shown above the
 * Google button, leaves a small mark in this browser: the Terms version and
 * the moment of the press, nothing about the person. When a session arrives
 * whose metadata holds no terms_version and a fresh mark is here, the auth
 * listener writes the acceptance with the moment of the press, and the mark
 * goes. A Google press that showed no Terms (the reset page's way back into
 * a Google-only account) leaves no mark, so nothing is recorded for it.
 */
import { TERMS_VERSION } from "@/config/terms";

export const GOOGLE_TERMS_KEY = "rb_google_terms_shown";
/** A provider round trip takes seconds; a mark older than this is not that press. */
export const GOOGLE_TERMS_TTL_MS = 30 * 60 * 1000;

/** The press on a page that showed the Terms line. */
export function noteTermsShown(now: number = Date.now()): void {
  try { localStorage.setItem(GOOGLE_TERMS_KEY, JSON.stringify({ v: TERMS_VERSION, at: now })); } catch { /* storage blocked: nothing recorded */ }
}

export function clearTermsShown(): void {
  try { localStorage.removeItem(GOOGLE_TERMS_KEY); } catch { /* nothing kept */ }
}

type MaybeUser = { user_metadata?: Record<string, unknown> | null } | null | undefined;

/**
 * What to write on this account, or null: only for an account with no
 * terms_version yet, and only when this browser holds a mark for the current
 * Terms made within the last half hour. The acceptance is dated by the press.
 */
export function termsToRecord(user: MaybeUser, now: number = Date.now()): { terms_version: string; terms_accepted_at: string } | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  if (typeof meta.terms_version === "string" && meta.terms_version) return null;
  let mark: { v?: unknown; at?: unknown } | null = null;
  try { mark = JSON.parse(localStorage.getItem(GOOGLE_TERMS_KEY) ?? "null"); } catch { return null; }
  if (!mark || mark.v !== TERMS_VERSION || typeof mark.at !== "number" || !Number.isFinite(mark.at)) return null;
  if (mark.at > now + 60_000 || now - mark.at > GOOGLE_TERMS_TTL_MS) return null;
  return { terms_version: TERMS_VERSION, terms_accepted_at: new Date(mark.at).toISOString() };
}
