// Rationale: docs/job-board-index-notes.md#n1323-import-clusterkey-from-descriptions-ts
import { clusterKey } from "./descriptions.ts";

// Rationale: docs/job-board-index-notes.md#n1324-export-const-group_overfetch
export const GROUP_OVERFETCH = 3;
export const GROUP_SAMPLE_LOCATIONS = 6;
// Rationale: docs/job-board-index-notes.md#n1325-export-const-group_siblings_max
export const GROUP_SIBLINGS_MAX = 50;

// Rationale: docs/job-board-index-notes.md#n1326-export-function-rowclusterkey-r-record-s
export function rowClusterKey(r: Record<string, unknown>): string {
  const country = String(r.country ?? "").trim().toUpperCase();
  return `${clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""), typeof r.location === "string" ? r.location : null)}\u0002${country}`;
}

// Rationale: docs/job-board-index-notes.md#n1327-const-max_consecutive_per_company
// Rationale: docs/job-board-index-notes.md#n1328-const-max_consecutive_per_company
const MAX_CONSECUTIVE_PER_COMPANY = 2;

export function interleaveByCompany(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let deferred: Array<Record<string, unknown>> = [];
  let runKey = "";
  let runLen = 0;
  const keyOf = (r: Record<string, unknown>) => String(r.company ?? r.company_token ?? "");
  // Rationale: docs/job-board-index-notes.md#n1329-const-tieof-r-record-string-unknown
  const tieOf = (r: Record<string, unknown>) => String(r.postedAt ?? r.effective_posted ?? r.firstSeen ?? "");
  let tie = rows.length ? tieOf(rows[0]) : "";
  const flush = () => { out.push(...deferred); deferred = []; runKey = ""; runLen = 0; };
  for (const r of rows) {
    const t = tieOf(r);
    if (t !== tie) { flush(); tie = t; }   // group boundary: nothing crosses it
    const k = keyOf(r);
    if (k && k === runKey && runLen >= MAX_CONSECUTIVE_PER_COMPANY) { deferred.push(r); continue; }
    // A deferred row is eligible again as soon as a different employer breaks
    // the run, so nothing is pushed to the end of the group wholesale.
    if (k === runKey) runLen++; else { runKey = k; runLen = 1; }
    out.push(r);
    if (deferred.length) {
      const i = deferred.findIndex((d) => keyOf(d) !== runKey);
      if (i >= 0) {
        const [d] = deferred.splice(i, 1);
        runKey = keyOf(d); runLen = 1;
        out.push(d);
      }
    }
  }
  flush();
  return out;
}

// Rationale: docs/job-board-index-notes.md#n1330-export-function-visiblecategories
export function visibleCategories(
  facet: Record<string, number> | undefined,
  unfiltered: boolean,
  activeCategory: string | null,
): Record<string, number> | undefined {
  if (unfiltered) return facet ?? {};
  if (!activeCategory || !facet) return undefined;
  const n = facet[activeCategory];
  return typeof n === "number" ? { [activeCategory]: n } : undefined;
}

export function collapseClusters(
  rows: Array<Record<string, unknown>>,
  limit: number,
): { jobs: Array<Record<string, unknown>>; rawConsumed: number } {
  const out: Array<Record<string, unknown>> = [];
  const byKey = new Map<string, Record<string, unknown>>();
  let rawConsumed = 0;
  // Every distinct non-empty location per cluster — uncapped, unlike the
  // six-item display sample, because this feeds the COUNT the card states.
  const locSets = new Map<string, Set<string>>();
  for (const r of rows) {
    // Rationale: docs/job-board-index-notes.md#n1331-const-key-rowclusterkey-r
    const key = rowClusterKey(r);
    const hit = byKey.get(key);
    if (!hit && out.length >= limit) break; // next page starts exactly here
    rawConsumed++;
    if (hit) {
      // Rationale: docs/job-board-index-notes.md#n1332-hit-postingcount-number-hit-postingcount
      hit.postingCount = (Number(hit.postingCount) || 1) + 1;
      const locs = hit.otherLocations as string[];
      const loc = typeof r.location === "string" ? r.location.trim() : "";
      if (loc && loc !== hit.location && locs.length < GROUP_SAMPLE_LOCATIONS && !locs.includes(loc)) locs.push(loc);
      // The DISPLAY sample above is capped; the count below is not, or a role
      // genuinely spread across 13 sites would read "6 more locations".
      if (loc) locSets.get(key)?.add(loc);
      hit.locationCount = locSets.get(key)?.size ?? 1;
      // The folded posting stays openable: its own id, place, apply link and date.
      const sibs = hit.siblings as Array<Record<string, unknown>>;
      if (sibs.length < GROUP_SIBLINGS_MAX) {
        sibs.push({ id: r.id, location: r.location ?? null, applyUrl: r.applyUrl ?? null, postedAt: r.postedAt ?? null });
      }
      continue;
    }
    const row = { ...r, postingCount: 1, locationCount: 1, otherLocations: [] as string[], siblings: [] as Array<Record<string, unknown>> };
    const leadLoc = typeof r.location === "string" ? r.location.trim() : "";
    locSets.set(key, new Set(leadLoc ? [leadLoc] : []));
    byKey.set(key, row);
    out.push(row);
  }
  // Only surface the grouping fields when there is actually a group.
  for (const row of out) {
    if ((Number(row.postingCount) || 1) < 2) {
      delete row.postingCount;
      delete row.locationCount;
      delete row.otherLocations;
      delete row.siblings;
    }
  }
  return { jobs: out, rawConsumed };
}

// Rationale: docs/job-board-index-notes.md#n1333-export-function-mergecompanyfacet-rows-a
export function mergeCompanyFacet(rows: Array<{ token?: string; name?: string; count?: number; open?: number }>): Array<{ token?: string; name?: string; count?: number; open?: number; tokens?: string[] }> {
  const byName = new Map<string, { token?: string; name?: string; count: number; open?: number; tokens: string[]; top: number }>();
  const out: Array<{ token?: string; name?: string; count?: number; open?: number; tokens?: string[] }> = [];
  for (const r of rows) {
    // Rationale: docs/job-board-index-notes.md#n1334-const-stem-r-token-split-trim
    const stem = (r.token ?? "").split("~")[0].trim().toLowerCase();
    const nm = (r.name ?? "").trim().toLowerCase();
    // Rationale: docs/job-board-index-notes.md#n1335-if-nm-out-push-r-continue
    if (!nm) { out.push(r); continue; }
    const key = nm + "|" + stem;
    const hit = byName.get(key);
    const n = r.count ?? 0;
    if (!hit) {
      byName.set(key, { token: r.token, name: r.name, count: n, open: r.open, tokens: r.token ? [r.token] : [], top: n });
    } else {
      hit.count += n;
      if (typeof r.open === "number") hit.open = (hit.open ?? 0) + r.open;
      if (r.token) hit.tokens.push(r.token);
      if (n > hit.top) { hit.top = n; hit.token = r.token; }
    }
  }
  for (const v of byName.values()) {
    const base = typeof v.open === "number"
      ? { token: v.token, name: v.name, count: v.count, open: v.open }
      : { token: v.token, name: v.name, count: v.count };
    out.push(v.tokens.length > 1 ? { ...base, tokens: v.tokens } : base);
  }
  return out;
}
