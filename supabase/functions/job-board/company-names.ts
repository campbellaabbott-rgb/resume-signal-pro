/**
 * AN EMPLOYER ASKED FOR BY NAME IS FOUND BY NAME (wave 4, job-board .93).
 *
 * companies:["Humana"] answered 0 with no note: the filter takes board tokens
 * (humana~wd5~Humana_External_Career_Site), and an AI asking for an employer
 * sends the name. A name now resolves the way company-suggest reads the
 * employer list, folded both sides: an exact name, plus the boards we name
 * after it in parentheses ("CenterWell (Humana)"). Two different employers
 * that share the exact name are never merged; the name is refused with them
 * as candidates. A name that matches nothing is refused with up to five near
 * names. Either refusal is named on the answer, never silently dropped.
 *
 * Pure, so vitest walks it.
 */
import { foldTypeahead } from "./search-routing.ts";

export type FacetEmployer = { token?: string; name?: string; open?: number; count?: number; tokens?: string[] };
export type Candidate = { token: string; name: string; open?: number };
export type CompanyScope = {
  /** What the list filters by: the tokens asked for, plus every name resolved. */
  companies: unknown[];
  resolved: Array<{ asked: string; name: string; tokens: string[] }>;
  unresolved: Array<{ asked: string; candidates: Candidate[] }>;
};

/** The scope a request asks for, when it names an employer by name rather than by token; null otherwise. */
export function askedByName(body: Record<string, unknown>, catalogue: ReadonlySet<string>): unknown[] | null {
  const asked = body.companies;
  return Array.isArray(asked) && asked.some((c) => typeof c === "string" && !catalogue.has(c)) ? asked : null;
}

const PAREN_TAIL = /\s*\(([^()]*)\)\s*$/;
const tokensOf = (e: FacetEmployer): string[] => (e.tokens?.length ? e.tokens : e.token ? [e.token] : []);
const candidate = (e: FacetEmployer): Candidate => ({ token: e.token ?? "", name: e.name ?? "", ...(typeof e.open === "number" ? { open: e.open } : {}) });
const size = (e: FacetEmployer) => e.open ?? e.count ?? 0;

/**
 * `employers` is company-suggest's merged facet (one row per employer, its
 * sub-boards in `tokens`). Entries that are catalogue tokens, or not strings,
 * pass through untouched for normalizeFilters to judge.
 */
export function resolveCompanyNames(asked: readonly unknown[], catalogue: ReadonlySet<string>, employers: readonly FacetEmployer[]): CompanyScope {
  const out: CompanyScope = { companies: [], resolved: [], unresolved: [] };
  const keep = new Set<unknown>();
  const push = (v: unknown) => { if (!keep.has(v)) { keep.add(v); out.companies.push(v); } };
  for (const a of asked) {
    if (typeof a !== "string" || catalogue.has(a)) { push(a); continue; }
    const fq = foldTypeahead(a);
    if (!fq) { push(a); continue; }
    const exact = employers.filter((e) => foldTypeahead(e.name ?? "") === fq);
    const named = employers.filter((e) => {
      const p = PAREN_TAIL.exec(e.name ?? "");
      return p !== null && foldTypeahead(p[1]) === fq && !exact.includes(e);
    });
    if (exact.length > 1 || (exact.length === 0 && named.length === 0)) {
      const near = exact.length > 1
        ? exact
        : employers.filter((e) => foldTypeahead(e.name ?? "").includes(fq)).sort((x, y) => size(y) - size(x));
      out.unresolved.push({ asked: a, candidates: near.slice(0, 5).map(candidate) });
      continue;
    }
    const hits = [...exact, ...named];
    const tokens = [...new Set(hits.flatMap(tokensOf))];
    for (const t of tokens) push(t);
    out.resolved.push({ asked: a, name: hits.map((e) => e.name ?? "").join(", "), tokens });
  }
  return out;
}
