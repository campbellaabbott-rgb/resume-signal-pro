// THE CONFIRMED PROFILE, FOR THIS TAB ONLY.
//
// An anonymous reader's profile lives in sessionStorage (gone when the tab
// closes), behind try/catch everywhere: a private window, blocked storage or a
// full quota simply means nothing is remembered. Never localStorage, never the
// server. Work authorisation is kept here with the rest because this is the
// device; it is never synced (owner decision 5), and the synced profile of
// phase 3 leaves it out by construction (syncableProfile).

import type { MatchProfile } from "../../../supabase/functions/_shared/resume-profile";

export const SESSION_KEY = "rb_match_profile";

export function saveSessionProfile(p: MatchProfile, store: Pick<Storage, "setItem"> | null = safeSession()): boolean {
  if (!store) return false;
  try { store.setItem(SESSION_KEY, JSON.stringify(p)); return true; } catch { return false; }
}

export function loadSessionProfile(store: Pick<Storage, "getItem"> | null = safeSession()): MatchProfile | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as MatchProfile;
    return p && Array.isArray(p.roles) ? p : null;
  } catch {
    return null;
  }
}

export function clearSessionProfile(store: Pick<Storage, "removeItem"> | null = safeSession()): void {
  if (!store) return;
  try { store.removeItem(SESSION_KEY); } catch { /* nothing to clear */ }
}

/** What a signed-in reader's opted-in sync may store: the derived facts minus work authorisation and the quoted lines. */
export function syncableProfile(p: MatchProfile): Omit<MatchProfile, "workAuth" | "basis"> {
  const { workAuth: _w, basis: _b, ...rest } = p;
  return rest;
}

function safeSession(): Storage | null {
  try { return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null; } catch { return null; }
}
