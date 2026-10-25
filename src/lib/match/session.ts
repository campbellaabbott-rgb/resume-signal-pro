// THE CONFIRMED PROFILE, FOR THIS TAB ONLY.
//
// An anonymous reader's profile lives in sessionStorage (gone when the tab
// closes), behind try/catch everywhere: a private window, blocked storage or a
// full quota simply means nothing is remembered. Never localStorage, never the
// server. Work authorisation is kept here with the rest because this is the
// device; it is never synced (owner decision 5), and the synced profile of
// phase 3 is built from an allow-list (syncableProfile) that names no
// work-authorisation field, no quoted line and no held clearance.

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

/** A licence as it may sync: kind and where it is held, never the line it was read from. */
export interface SyncedLicence { kind: MatchProfile["licences"][number]["kind"]; jurisdiction: string | null; compact: boolean; grade: string | null }
export type SyncableProfile = Pick<MatchProfile,
  "version" | "roles" | "grade" | "former" | "careerChanger" | "home" | "extraPlaces" | "relocate" | "remote" | "radiusKm"
  | "canWorkIn" | "canWorkInBasis" | "level" | "newGrad" | "student" | "degree" | "years" | "targetYears"> & { licences: SyncedLicence[] };

/**
 * What a signed-in reader's opted-in sync may store, BUILT FROM AN ALLOW-LIST:
 * the derived facts, never a line quoted from the résumé (basis, a licence's
 * own basis, the headline as written) and never work authorisation. A held
 * security clearance is work authorisation here (spec 5), so a licence of
 * kind clearance is left out too. A field added to MatchProfile later is not
 * synced until it is named here.
 */
export function syncableProfile(p: MatchProfile): SyncableProfile {
  return {
    version: p.version,
    roles: [...p.roles],
    grade: [...p.grade],
    former: p.former,
    careerChanger: p.careerChanger,
    home: p.home ? { city: p.home.city, region: p.home.region, country: p.home.country } : null,
    extraPlaces: p.extraPlaces.map((x) => ({ city: x.city, region: x.region, country: x.country })),
    relocate: Array.isArray(p.relocate) ? [...p.relocate] : p.relocate,
    remote: p.remote,
    radiusKm: p.radiusKm,
    canWorkIn: [...p.canWorkIn],
    canWorkInBasis: p.canWorkInBasis,
    level: p.level,
    newGrad: p.newGrad,
    student: p.student,
    degree: p.degree,
    years: p.years ? { low: p.years.low, high: p.years.high } : null,
    targetYears: p.targetYears,
    licences: p.licences.filter((l) => l.kind !== "clearance").map((l) => ({ kind: l.kind, jurisdiction: l.jurisdiction, compact: l.compact, grade: l.grade ?? null })),
  };
}

function safeSession(): Storage | null {
  try { return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null; } catch { return null; }
}
