// "NOT FOR ME": FOUR CHIPS, EACH AN ADJUSTMENT THE READER CAN SEE.
//
//   Too far             suggests a smaller radius, or leaves that place out
//   Wrong level         moves the level
//   Wrong role          adds the title to this session's not-list
//   Not this employer   leaves that employer out
//
// Rows a chip leaves out are set aside and counted ("Not for me: 3"), never
// hidden. Analytics record the count per reason only: never the title, the
// place or the employer.

export type NotForMe = "too_far" | "wrong_level" | "wrong_role" | "not_this_employer";
export const NOT_FOR_ME_LABEL: Record<NotForMe, string> = {
  too_far: "Too far", wrong_level: "Wrong level", wrong_role: "Wrong role", not_this_employer: "Not this employer",
};

export interface SessionAdjustments {
  radiusKm: 15 | 40 | 80;
  excludedPlaces: string[];
  levelShift: -1 | 0 | 1;
  notTitles: string[];
  excludedEmployers: string[];
}
export const NO_ADJUSTMENTS: SessionAdjustments = { radiusKm: 40, excludedPlaces: [], levelShift: 0, notTitles: [], excludedEmployers: [] };

export interface ChipRow { id: string; title: string; company: string; location: string | null; employerToken?: string | null; lane: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const smaller = (km: SessionAdjustments["radiusKm"]): SessionAdjustments["radiusKm"] => (km === 80 ? 40 : 15);

/** Apply one chip. `retrieval` says whether the next view needs a match call (a smaller radius does). */
export function applyNotForMe(s: SessionAdjustments, chip: NotForMe, row: ChipRow, direction: "higher" | "lower" = "higher"): { next: SessionAdjustments; retrieval: boolean } {
  switch (chip) {
    case "too_far":
      if (row.lane === "ring" && s.radiusKm > 15) return { next: { ...s, radiusKm: smaller(s.radiusKm) }, retrieval: true };
      return { next: { ...s, excludedPlaces: [...new Set([...s.excludedPlaces, norm(row.location ?? "")])].filter(Boolean) }, retrieval: false };
    case "wrong_level":
      return { next: { ...s, levelShift: direction === "higher" ? 1 : -1 }, retrieval: false };
    case "wrong_role":
      return { next: { ...s, notTitles: [...new Set([...s.notTitles, norm(row.title)])] }, retrieval: false };
    case "not_this_employer":
      return { next: { ...s, excludedEmployers: [...new Set([...s.excludedEmployers, norm(row.employerToken || row.company)])] }, retrieval: false };
  }
}

/** Rows the session's chips leave out, counted, never dropped. */
export function partitionBySession<R extends ChipRow>(rows: readonly R[], s: SessionAdjustments): { shown: R[]; notForMe: R[] } {
  const shown: R[] = [];
  const notForMe: R[] = [];
  for (const r of rows) {
    const out = s.excludedPlaces.includes(norm(r.location ?? ""))
      || s.notTitles.includes(norm(r.title))
      || s.excludedEmployers.includes(norm(r.employerToken || r.company));
    (out ? notForMe : shown).push(r);
  }
  return { shown, notForMe };
}

/** The analytics event: a reason and nothing else. */
export const notForMeEvent = (chip: NotForMe) => ({ event: "match_not_for_me", reason: chip });
