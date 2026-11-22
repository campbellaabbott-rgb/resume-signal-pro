/**
 * THE SIBLING INDUSTRIES AN /industries PAGE LINKS, WRITTEN ONCE FOR BOTH
 * RENDERERS (SEO audit 2026-11-18, CONTENT-N1).
 *
 * Both renderers linked the first 8 industries in alphabetical order from
 * every page, so 8 pages received 57 sibling links and 49 of the 58 received
 * none.
 *
 * A page now links, first, the industries closest to it: the ones sharing its
 * board field, then the ones whose keyword and job-title tables overlap its own
 * most (Jaccard over the lower-cased primary and titles lists; ties
 * alphabetical). Ranking by overlap alone was measured on 2026-11-21 and fails
 * the spread it exists for: 51 of the 58 tables share a word with fewer than 8
 * others, so the alphabetical tie-break sent 51 links to academia and left 34
 * pages with fewer than 4. So at most RELEVANT_SHOWN of the 8 are picked by
 * closeness, a page already linked RELEVANT_CAP times by closeness is passed
 * over (pages are taken in alphabetical order), and the rest are the pages
 * after it in alphabetical order, wrapping round. Measured: every page then
 * receives between 4 and 14 sibling links.
 *
 * Pure, with no imports, so the bake bundles it; the whole set is worked out
 * once per table object.
 */
export const RELATED_INDUSTRIES_SHOWN = 8;
const RELEVANT_SHOWN = 6;
const RELEVANT_CAP = 14;

export type IndustryTables = Readonly<Record<string, { readonly primary?: readonly string[]; readonly titles?: readonly string[] }>>;

const memo = new WeakMap<object, WeakMap<object, Map<string, string[]>>>();

function allRelated(tables: IndustryTables, fieldOf: Readonly<Record<string, string>>): Map<string, string[]> {
  const sorted = Object.keys(tables).sort();
  const words = new Map(sorted.map((s) => [s, new Set([...(tables[s]?.primary ?? []), ...(tables[s]?.titles ?? [])].map((w) => String(w).toLowerCase()))]));
  const overlap = (a: string, b: string) => {
    const A = words.get(a)!, B = words.get(b)!;
    let shared = 0;
    for (const w of A) if (B.has(w)) shared++;
    const union = A.size + B.size - shared;
    return union ? shared / union : 0;
  };
  const incoming = new Map(sorted.map((s) => [s, 0]));
  const out = new Map<string, string[]>();
  sorted.forEach((slug, at) => {
    const after = sorted.slice(at + 1).concat(sorted.slice(0, at));
    const field = fieldOf[slug];
    const sameField = (s: string) => (field && fieldOf[s] === field ? 1 : 0);
    const close = after
      .map((s) => ({ s, f: sameField(s), j: overlap(slug, s) }))
      .filter((x) => x.f || x.j > 0)
      .sort((a, b) => b.f - a.f || b.j - a.j || a.s.localeCompare(b.s));
    const pick: string[] = [];
    for (const { s } of close) {
      if (pick.length >= RELEVANT_SHOWN) break;
      if ((incoming.get(s) ?? 0) >= RELEVANT_CAP) continue;
      pick.push(s);
    }
    for (const s of after) {
      if (pick.length >= RELATED_INDUSTRIES_SHOWN) break;
      if (!pick.includes(s)) pick.push(s);
    }
    for (const s of pick) incoming.set(s, (incoming.get(s) ?? 0) + 1);
    out.set(slug, pick);
  });
  return out;
}

export function relatedIndustries(slug: string, tables: IndustryTables, fieldOf: Readonly<Record<string, string>>): string[] {
  let byField = memo.get(tables);
  if (!byField) memo.set(tables, (byField = new WeakMap()));
  let set = byField.get(fieldOf);
  if (!set) byField.set(fieldOf, (set = allRelated(tables, fieldOf)));
  return [...(set.get(slug) ?? [])];
}
