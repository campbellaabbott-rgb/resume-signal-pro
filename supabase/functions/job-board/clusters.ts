










import { clusterKey } from "./descriptions.ts";




export const GROUP_OVERFETCH = 3;
export const GROUP_SAMPLE_LOCATIONS = 6;






























const MAX_CONSECUTIVE_PER_COMPANY = 2;

export function interleaveByCompany(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let deferred: Array<Record<string, unknown>> = [];
  let runKey = "";
  let runLen = 0;
  const keyOf = (r: Record<string, unknown>) => String(r.company ?? r.company_token ?? "");
  
  
  
  
  
  
  const tieOf = (r: Record<string, unknown>) => String(r.postedAt ?? r.effective_posted ?? r.firstSeen ?? "");
  let tie = rows.length ? tieOf(rows[0]) : "";
  const flush = () => { out.push(...deferred); deferred = []; runKey = ""; runLen = 0; };
  for (const r of rows) {
    const t = tieOf(r);
    if (t !== tie) { flush(); tie = t; }   
    const k = keyOf(r);
    if (k && k === runKey && runLen >= MAX_CONSECUTIVE_PER_COMPANY) { deferred.push(r); continue; }
    
    
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
  
  
  const locSets = new Map<string, Set<string>>();
  for (const r of rows) {
    
    
    
    
    const key = clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""));
    const hit = byKey.get(key);
    if (!hit && out.length >= limit) break; 
    rawConsumed++;
    if (hit) {
      
      
      
      
      
      
      
      
      
      hit.postingCount = (Number(hit.postingCount) || 1) + 1;
      const locs = hit.otherLocations as string[];
      const loc = typeof r.location === "string" ? r.location.trim() : "";
      if (loc && loc !== hit.location && locs.length < GROUP_SAMPLE_LOCATIONS && !locs.includes(loc)) locs.push(loc);
      
      
      if (loc) locSets.get(key)?.add(loc);
      hit.locationCount = locSets.get(key)?.size ?? 1;
      continue;
    }
    const row = { ...r, postingCount: 1, locationCount: 1, otherLocations: [] as string[] };
    const leadLoc = typeof r.location === "string" ? r.location.trim() : "";
    locSets.set(key, new Set(leadLoc ? [leadLoc] : []));
    byKey.set(key, row);
    out.push(row);
  }
  
  for (const row of out) {
    if ((Number(row.postingCount) || 1) < 2) {
      delete row.postingCount;
      delete row.locationCount;
      delete row.otherLocations;
    }
  }
  return { jobs: out, rawConsumed };
}







export function mergeCompanyFacet(rows: Array<{ token?: string; name?: string; count?: number }>): Array<{ token?: string; name?: string; count?: number; tokens?: string[] }> {
  const byName = new Map<string, { token?: string; name?: string; count: number; tokens: string[]; top: number }>();
  const out: Array<{ token?: string; name?: string; count?: number; tokens?: string[] }> = [];
  for (const r of rows) {
    
    
    
    
    
    
    
    
    
    
    const stem = (r.token ?? "").split("~")[0].trim().toLowerCase();
    const nm = (r.name ?? "").trim().toLowerCase();
    
    
    
    if (!nm) { out.push(r); continue; }
    const key = nm + "|" + stem;
    const hit = byName.get(key);
    const n = r.count ?? 0;
    if (!hit) {
      byName.set(key, { token: r.token, name: r.name, count: n, tokens: r.token ? [r.token] : [], top: n });
    } else {
      hit.count += n;
      if (r.token) hit.tokens.push(r.token);
      if (n > hit.top) { hit.top = n; hit.token = r.token; }
    }
  }
  for (const v of byName.values()) {
    out.push(v.tokens.length > 1 ? { token: v.token, name: v.name, count: v.count, tokens: v.tokens } : { token: v.token, name: v.name, count: v.count });
  }
  return out;
}
