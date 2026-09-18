// A state map says which column of a state's raw file plays which role, and
// which stamp is the notice's first public moment. Every map declares
// whether its header was verified against a saved copy of the file; a map
// that was not is still safe to run because the header resolver refuses a
// file whose required columns are absent, and the refusal is written to
// layoff_feed_health.note with the header it actually saw — never a row
// built from a guessed column.

import type { EventType, VisibleBasis, WarnRecord } from "../normalize.ts";

/** One role → the exact header names (whitespace-collapsed) that may carry it, in preference order. */
export type HeaderCandidates = string[];

export interface StateMap {
  /** Two-letter postal code, upper case. */
  state: string;
  /** The agency as it names itself; printed on every surface as the source. */
  sourceName: string;
  /** The agency's own page; every stored row links here. */
  sourceUrl: string;
  /** Big Local News' raw per-state file on the transformer branch. */
  blnRawUrl: string;
  /** Which stamp `visible` carries. */
  visibleBasis: VisibleBasis;
  columns: {
    filer: HeaderCandidates;
    /** The employer's notice date; absent for states that publish none. */
    noticeDate?: HeaderCandidates;
    /** The state's received / processed / posted stamp. Required. */
    visible: HeaderCandidates;
    effective?: HeaderCandidates;
    workers?: HeaderCandidates;
    /** The closure/layoff wording cell(s). */
    kind?: HeaderCandidates;
    /** Permanent/temporary wording, when separate from `kind`. */
    temporary?: HeaderCandidates;
    site?: HeaderCandidates;
    city?: HeaderCandidates;
    county?: HeaderCandidates;
    pdf?: HeaderCandidates;
  };
  /** A state-specific cleanup of the filer cell before the shared pre-pass. */
  filerCell?: (raw: string) => { filerRaw: string; filerForNorm: string; siteFromCell?: string | null };
  /** Override of the event-type reading when the state's vocabulary needs it. */
  eventType?: (kindCell: string, row: Record<string, string>) => EventType;
  /** Rows the state lists but that are not WARN notices (Illinois' non-WARN layoff reports). */
  keepRow?: (row: Record<string, string>) => boolean;
  /** Was the header of this map checked against a saved copy of the state's file? */
  verifiedAgainstSample: boolean;
  /** Which saved file proved the header (a note for the reader of this map). */
  verifiedBy?: string;
}

export interface ResolvedHeaders {
  ok: true;
  pick: Record<keyof StateMap["columns"], string | null>;
}
export interface UnresolvedHeaders {
  ok: false;
  missing: string[];
  header: string[];
}

/** Resolve each role to the first candidate present in the header; `filer` and `visible` are required. */
export function resolveHeaders(map: StateMap, header: string[]): ResolvedHeaders | UnresolvedHeaders {
  const set = new Set(header.map((h) => h.replace(/\s+/g, " ").trim()));
  const pick = {} as Record<keyof StateMap["columns"], string | null>;
  const missing: string[] = [];
  for (const role of Object.keys(map.columns) as Array<keyof StateMap["columns"]>) {
    const cands = map.columns[role] ?? [];
    const hit = cands.find((c) => set.has(c)) ?? null;
    pick[role] = hit;
    if (hit == null && (role === "filer" || role === "visible")) missing.push(role);
  }
  if (missing.length > 0) return { ok: false, missing, header };
  return { ok: true, pick };
}

export type { WarnRecord };
