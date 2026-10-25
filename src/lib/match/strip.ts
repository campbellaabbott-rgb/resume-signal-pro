// "WE READ YOU AS": THE STRIP, AS DATA.
//
// One chip per fact the matcher will use, each with the line it was read
// from, so a wrong read is a visible, editable chip. Work authorisation
// defaults to Skip and says so; years say "about N (from your employment
// dates)". Labels are plain English here; the translated shard arrives with
// the phase-1 UI.

import type { MatchProfile } from "../../../supabase/functions/_shared/resume-profile";

export type ChipKey = "roles" | "level" | "years" | "home" | "radius" | "canWorkIn" | "remote" | "relocate" | "licences" | "workAuth";

export interface Chip { key: ChipKey; label: string; value: string; basis: string | null; editable: true }

const LEVEL_LABEL: Record<MatchProfile["level"], string> = { entry: "Entry level", mid: "Mid level", senior: "Senior", exec: "Executive" };
const LICENCE_LABEL: Record<string, string> = {
  rn: "RN", lpn: "LPN/LVN", np: "Nurse practitioner", pharmacist: "Pharmacist", pt: "Physical therapist", ot: "Occupational therapist",
  cpa: "CPA", teacher: "Teaching credential", electrician: "Electrical licence", cdl: "CDL", pe: "PE", epa608: "EPA 608",
  nmc: "NMC registration", ahpra: "AHPRA registration", clearance: "Clearance",
};
const AUTH_LABEL: Record<MatchProfile["workAuth"]["status"], string> = {
  citizen: "Citizen", permanent_resident: "Permanent resident", student_visa: "Student visa", work_visa: "Work visa", unknown: "Skip",
};

export function stripChips(p: MatchProfile): Chip[] {
  const chips: Chip[] = [];
  chips.push({ key: "roles", label: "Role", value: p.roles.length ? p.roles.join(" · ") : "Type your target role", basis: p.basis.roles ?? null, editable: true });
  chips.push({ key: "level", label: "Level", value: `${LEVEL_LABEL[p.level]}${p.newGrad ? " (new graduate)" : ""}`, basis: p.basis.level ?? null, editable: true });
  if (p.years) {
    const y = p.years.low === p.years.high ? `${Math.round(p.years.low)}` : `${Math.round(p.years.low)}-${Math.round(p.years.high)}`;
    chips.push({ key: "years", label: "Years", value: `about ${y} (from your employment dates)`, basis: p.basis.years ?? null, editable: true });
  }
  chips.push({ key: "home", label: "Lives in", value: p.home ? [p.home.city, p.home.region, p.home.country].filter(Boolean).join(", ") : "Not stated", basis: p.basis.home ?? null, editable: true });
  chips.push({ key: "radius", label: "Commute", value: `${p.radiusKm} km`, basis: null, editable: true });
  chips.push({
    key: "canWorkIn", label: "Can work in", value: p.canWorkIn.join(", ") || "Not stated",
    basis: p.canWorkInBasis === "declared" ? (p.basis.workAuth ?? null) : p.canWorkInBasis === "home" ? "where your résumé says you live" : null, editable: true,
  });
  chips.push({ key: "remote", label: "Remote OK", value: p.remote ? "Yes" : "No", basis: p.basis.remote ?? null, editable: true });
  chips.push({ key: "relocate", label: "Would move to", value: p.relocate === "none" ? "No" : p.relocate === "country" ? "Anywhere in the country" : p.relocate.join(", "), basis: p.basis.relocate ?? null, editable: true });
  if (p.licences.length) {
    chips.push({
      key: "licences", label: "Licences",
      value: p.licences.map((l) => `${LICENCE_LABEL[l.kind] ?? l.kind}${l.jurisdiction ? ` (${l.jurisdiction}${l.compact ? ", multistate compact" : ""})` : ""}`).join(" · "),
      basis: p.basis.licences ?? null, editable: true,
    });
  }
  chips.push({ key: "workAuth", label: "Work authorisation", value: AUTH_LABEL[p.workAuth.status], basis: p.workAuth.status === "unknown" ? null : (p.basis.workAuth ?? null), editable: true });
  return chips;
}
