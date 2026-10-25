// WHAT LEAVES THE DEVICE FOR A MATCH, AND NOTHING MORE.
//
// On the site's paste path the résumé text stays on the device. resume-match
// receives the confirmed profile: up to three titles, places, the countries
// the reader said they can work in, relocation, remote, radius, level and
// years, and licence kinds with where they are held. Never the basis lines
// (they quote the résumé), never the headline as written, never an answer to a
// requirement line, and by default never work authorisation: the device
// re-applies the sponsorship and citizenship gates itself (retier.ts), so
// immigration status does not need to travel. No résumé-derived value goes
// in a URL either: this is a POST body.

import type { MatchProfile } from "../../../supabase/functions/_shared/resume-profile";

export interface MatchRequestOptions {
  /** Send work authorisation so the server's own counts include those gates. Off by default. */
  includeWorkAuth?: boolean;
  widen?: number;
  followUp?: string | null;
}

export interface SiteMatchRequest {
  action: "match";
  surface: "site";
  profile: Record<string, unknown>;
  widen?: number;
  followUp?: string;
}

export function matchRequestBody(p: MatchProfile, opts: MatchRequestOptions = {}): SiteMatchRequest {
  const profile: Record<string, unknown> = {
    roles: p.roles.slice(0, 3),
    home: p.home ? { city: p.home.city, region: p.home.region, country: p.home.country } : null,
    extraPlaces: p.extraPlaces.slice(0, 5).map((x) => ({ city: x.city, region: x.region, country: x.country })),
    canWorkIn: p.canWorkIn.slice(0, 20),
    relocate: p.relocate,
    remote: p.remote,
    radiusKm: p.radiusKm,
    level: p.level,
    years: p.years,
    targetYears: p.targetYears,
    careerChanger: p.careerChanger,
    former: p.former,
    student: p.student,
    degree: p.degree,
    licences: p.licences.map((l) => ({ kind: l.kind, jurisdiction: l.jurisdiction, compact: l.compact, grade: l.grade ?? null })),
  };
  if (opts.includeWorkAuth) {
    profile.workAuth = { status: p.workAuth.status, needsSponsorship: p.workAuth.needsSponsorship, citizenOf: p.workAuth.citizenOf, clearance: p.workAuth.clearance };
  }
  const body: SiteMatchRequest = { action: "match", surface: "site", profile };
  if (opts.widen) body.widen = opts.widen;
  if (opts.widen && opts.followUp) body.followUp = opts.followUp;
  return body;
}

/** The fields whose edit changes what is searched (one match call); every other edit re-tiers on the device. */
export const RETRIEVAL_FIELDS: ReadonlySet<keyof MatchProfile> = new Set(["roles", "home", "extraPlaces", "canWorkIn", "relocate", "remote", "radiusKm"]);
export const changesRetrieval = (field: keyof MatchProfile): boolean => RETRIEVAL_FIELDS.has(field);
