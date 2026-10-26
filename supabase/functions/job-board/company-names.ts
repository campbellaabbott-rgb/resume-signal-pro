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
 * BOUNDED (review of 9fe3bc0d): every name was matched against every
 * employer, two or three folds each, before any cap, so 100 names in a 1.9 KB
 * anonymous body cost more than a request's CPU budget. At most
 * NAMES_PER_CALL names are looked up per call (the rest are named as not
 * looked up), and the employer list is folded once per list into an index
 * kept as long as that list is (job-board memoises it per refresh read).
 *
 * Pure, so vitest walks it.
 */
import { foldTypeahead } from "./search-routing.ts";

export type FacetEmployer = { token?: string; name?: string; open?: number; count?: number; tokens?: string[] };
export type Candidate = { token: string; name: string; open?: number; vendor?: string; agency?: true };
/** What the catalogue says of a board: its vendor and whether it is a staffing agency's. */
export type BoardFacts = (token: string) => { source?: string; agency?: boolean } | undefined;
export type CompanyScope = {
  /** What the list filters by: the tokens asked for, plus every name resolved. */
  companies: unknown[];
  resolved: Array<{ asked: string; name: string; tokens: string[] }>;
  /** ambiguous: two carried employers share the exact name (we carry it, under more than one employer); held: the one exact match is an agency's board or a handful of roles. */
  unresolved: Array<{ asked: string; candidates: Candidate[]; ambiguous?: true; held?: "agency" | "few_open" }>;
  /** Names past NAMES_PER_CALL: not looked up, and not in the scope. */
  skipped: string[];
};

/** Names looked up in one call; agent-mcp looks up the same five. */
export const NAMES_PER_CALL = 5;
/**
 * A lone exact match with fewer open roles than this, or whose boards are all
 * an agency's, is offered as a candidate, never searched under the name: the
 * merge recheck found "Meta" resolving to a four-role staffing board.
 */
export const FEW_OPEN = 10;

/** The scope a request asks for, when it names an employer by name rather than by token; null otherwise. */
export function askedByName(body: Record<string, unknown>, catalogue: ReadonlySet<string>): unknown[] | null {
  const asked = body.companies;
  return Array.isArray(asked) && asked.some((c) => typeof c === "string" && !catalogue.has(c)) ? asked : null;
}

const PAREN_TAIL = /\s*\(([^()]*)\)\s*$/;
const tokensOf = (e: FacetEmployer): string[] => (e.tokens?.length ? e.tokens : e.token ? [e.token] : []);
const candidate = (e: FacetEmployer): Candidate => ({ token: e.token ?? "", name: e.name ?? "", ...(typeof e.open === "number" ? { open: e.open } : {}) });
const size = (e: FacetEmployer) => e.open ?? e.count ?? 0;

type NameIndex = { folded: string[]; exact: Map<string, FacetEmployer[]>; paren: Map<string, FacetEmployer[]> };
const INDEXES = new WeakMap<readonly FacetEmployer[], NameIndex>();
const add = (m: Map<string, FacetEmployer[]>, k: string, e: FacetEmployer) => { const l = m.get(k); if (l) l.push(e); else m.set(k, [e]); };

/** Every employer name folded once: by exact name, by parenthesised qualifier, and in order for the near-name scan. */
function indexOf(employers: readonly FacetEmployer[]): NameIndex {
  const hit = INDEXES.get(employers);
  if (hit) return hit;
  const ix: NameIndex = { folded: [], exact: new Map(), paren: new Map() };
  for (const e of employers) {
    const f = foldTypeahead(e.name ?? "");
    ix.folded.push(f);
    if (f) add(ix.exact, f, e);
    const p = PAREN_TAIL.exec(e.name ?? "");
    const fp = p ? foldTypeahead(p[1]) : "";
    if (fp) add(ix.paren, fp, e);
  }
  INDEXES.set(employers, ix);
  return ix;
}

/**
 * `employers` is company-suggest's merged facet (one row per employer, its
 * sub-boards in `tokens`). Entries that are catalogue tokens, or not strings,
 * pass through untouched for normalizeFilters to judge.
 */
export function resolveCompanyNames(asked: readonly unknown[], catalogue: ReadonlySet<string>, employers: readonly FacetEmployer[], maxNames = NAMES_PER_CALL, facts?: BoardFacts): CompanyScope {
  const out: CompanyScope = { companies: [], resolved: [], unresolved: [], skipped: [] };
  const keep = new Set<unknown>();
  const push = (v: unknown) => { if (!keep.has(v)) { keep.add(v); out.companies.push(v); } };
  let looked = 0;
  for (const a of asked) {
    if (typeof a !== "string" || catalogue.has(a)) { push(a); continue; }
    if (looked >= maxNames) { out.skipped.push(a.slice(0, 200)); continue; }
    const fq = foldTypeahead(a);
    if (!fq) { push(a); continue; }
    looked++;
    const ix = indexOf(employers);
    const exact = ix.exact.get(fq) ?? [];
    const named = (ix.paren.get(fq) ?? []).filter((e) => !exact.includes(e));
    if (exact.length > 1 || (exact.length === 0 && named.length === 0)) {
      const near = exact.length > 1
        ? exact
        : employers.filter((_, i) => ix.folded[i].includes(fq)).sort((x, y) => size(y) - size(x));
      out.unresolved.push({ asked: a, candidates: near.slice(0, 5).map(candidate), ...(exact.length > 1 ? { ambiguous: true as const } : {}) });
      continue;
    }
    if (exact.length === 1 && !named.length) {
      const e = exact[0];
      const about = tokensOf(e).map((t) => facts?.(t));
      const agency = about.length > 0 && about.every((f) => f?.agency === true);
      if (agency || size(e) < FEW_OPEN) {
        const c: Candidate = { ...candidate(e), ...(about[0]?.source ? { vendor: about[0].source } : {}), ...(agency ? { agency: true as const } : {}) };
        out.unresolved.push({ asked: a, candidates: [c], held: agency ? "agency" : "few_open" });
        continue;
      }
    }
    const hits = [...exact, ...named];
    const tokens = [...new Set(hits.flatMap(tokensOf))];
    for (const t of tokens) push(t);
    out.resolved.push({ asked: a, name: hits.map((e) => e.name ?? "").join(", "), tokens });
  }
  return out;
}
