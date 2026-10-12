// @vitest-environment node
/**
 * FIVE HUNDRED NAMES IN A LIST BODY COST FIVE LOOKUPS (review of 9fe3bc0d).
 *
 * job-board .93 resolves an employer asked for by name (company-names.ts).
 * As built, every name in `companies` was matched against every employer,
 * two or three folds each, before any cap applied: 100 names in a 1.9 KB
 * anonymous body cost 2.2 s of CPU over a 30,000-employer list, more than a
 * request's budget, on the worker pool ingest also uses; 500 names cost 11 s.
 * Now at most NAMES_PER_CALL names are looked up per call, the rest are named
 * as not looked up, and the employer list is folded once per list.
 *
 * Judged by work done, not by wall time on a loaded machine: the folds are
 * counted through the module's own import.
 */
import { describe, expect, it, vi } from "vitest";

const folds = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../supabase/functions/job-board/search-routing.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../supabase/functions/job-board/search-routing.ts")>();
  return { ...real, foldTypeahead: (s: string) => { folds.n++; return real.foldTypeahead(s); } };
});

import { NAMES_PER_CALL, resolveCompanyNames, type FacetEmployer } from "../../supabase/functions/job-board/company-names";

const EMPLOYERS: FacetEmployer[] = Array.from({ length: 30_000 }, (_, i) => ({
  token: `tok${i}`,
  name: i % 7 === 0 ? `Employer Number ${i} (Parent ${i % 50})` : `Employer Number ${i}`,
  open: i % 100,
}));
const CATALOGUE = new Set(EMPLOYERS.map((e) => e.token!));
const NAMES = Array.from({ length: 500 }, (_, i) => `zz-nobody-${i}`);

describe("a list body naming hundreds of employers", () => {
  it("looks up five names, names the other 495 as not looked up, and scopes to none of them", () => {
    const r = resolveCompanyNames(NAMES, CATALOGUE, EMPLOYERS);
    expect(NAMES_PER_CALL).toBe(5);
    expect(r.unresolved.map((u) => u.asked)).toEqual(NAMES.slice(0, 5));
    expect(r.skipped).toEqual(NAMES.slice(5));
    expect(r.companies).toEqual([]);
  });

  it("folds each employer name at most twice (its name and its parenthesised qualifier), not once per name asked", () => {
    const list = EMPLOYERS.slice();
    folds.n = 0;
    resolveCompanyNames(NAMES, CATALOGUE, list);
    const withParen = list.filter((e) => /\(/.test(e.name!)).length;
    expect(folds.n).toBeLessThanOrEqual(list.length + withParen + NAMES_PER_CALL);
    // The same list again: the index is kept, so only the asked names fold.
    folds.n = 0;
    resolveCompanyNames(NAMES, CATALOGUE, list);
    expect(folds.n).toBeLessThanOrEqual(NAMES_PER_CALL);
  });

  it("still resolves exact names and parenthesised boards from the index, as before", () => {
    const r = resolveCompanyNames(["Employer Number 15", "Parent 14"], CATALOGUE, EMPLOYERS);
    expect(r.resolved[0]).toMatchObject({ asked: "Employer Number 15", tokens: ["tok15"] });
    // "Parent 14" names the boards that carry it in parentheses.
    expect(r.resolved[1].asked).toBe("Parent 14");
    expect(r.resolved[1].tokens.length).toBeGreaterThan(0);
    for (const t of r.resolved[1].tokens) expect(EMPLOYERS.find((e) => e.token === t)!.name).toMatch(/\(Parent 14\)$/);
  });

  it("tokens the catalogue carries pass through uncounted against the name cap", () => {
    const tokens = Array.from({ length: 20 }, (_, i) => `tok${i}`);
    const r = resolveCompanyNames([...tokens, ...NAMES.slice(0, 7)], CATALOGUE, EMPLOYERS);
    expect(r.companies).toEqual(tokens);
    expect(r.unresolved).toHaveLength(5);
    expect(r.skipped).toEqual(NAMES.slice(5, 7));
  });
});
