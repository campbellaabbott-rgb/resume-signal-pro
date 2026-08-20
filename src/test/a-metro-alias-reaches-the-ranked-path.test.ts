import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "PHILLY" RETURNED 13 JOBS. PHILADELPHIA HAS 1,541.
 *
 * Metro aliases shipped and were verified live as WORKING — on the browse
 * path. Measured after that deploy: location=Philly returned 13 with
 * locationSearched ["Philadelphia"], and NYC returned 344 against New York's
 * 10,000. The expansion was computed, REPORTED to the client, and then thrown
 * away, because all four ranked and count call sites passed applied.location
 * raw.
 *
 * That is the third fix in two days to land on the browse path and miss the
 * ranked one — filler words, the clustering top-up, and now this. The paths
 * each bind filters separately, so anything that improves a filter has to be
 * applied at every site or it silently does nothing for the traffic that
 * matters. This file pins the location half of that rule.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const MIG = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).find((n) => n.includes("a_metro_alias_must_match_any_of_its_names"));
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
})();

describe("a metro alias reaches every path, not just the one nobody types into", () => {
  it("NO ranked or count site passes the raw location any more", () => {
    // This is the whole bug: four sites, all bypassing the expansion.
    expect(FN).not.toMatch(/p_location: sanitizeTerm\(applied\.location\) \|\| null/);
    const wired = (FN.match(/p_location: rankedLocationParam\(applied\.location\)/g) ?? []).length;
    expect(wired, "every search_jobs call must send the expanded names").toBeGreaterThanOrEqual(4);
  });

  it("the RPC matches ANY of the delimited names, not the literal string", () => {
    expect(MIG, "migration not found").not.toBe("");
    expect(MIG).toMatch(/string_to_array\(\$3, ''\|''\)/);
    expect(MIG).toMatch(/EXISTS \(SELECT 1 FROM unnest/);
    // The generated dynamic SQL must be a plain ILIKE per name — doubling the
    // quotes wrong yields '' in the output and a syntax error at runtime, so
    // the escaping is asserted on the DECODED fragment rather than by eye.
    const lit = /filters := filters \|\| '([^\n]*?)'; END IF;/.exec(MIG)?.[1] ?? "";
    const generated = lit.replace(/''/g, "'");
    expect(generated).toContain("string_to_array($3, '|')");
    expect(generated).toContain("ILIKE '%' || alias.x || '%'");
  });

  it("widens BOTH location functions, with their DIFFERENT positionals", () => {
    // count_jobs_capped carries the same clause at $2 where search_jobs has
    // $3. Fixing only one would be worse than fixing neither: the caller
    // already sends the joined string to both, so the rows would come from
    // Philadelphia while the count searched for the literal
    // "Philly|Philadelphia" and matched nothing — a total that disagrees with
    // the rows beneath it. A guard caught this; I had missed it.
    expect(MIG).toMatch(/FUNCTION public\.search_jobs\(/);
    expect(MIG).toMatch(/FUNCTION public\.count_jobs_capped\(/);
    expect(MIG).toMatch(/string_to_array\(\$3, ''\|''\)/);
    expect(MIG).toMatch(/string_to_array\(\$2, ''\|''\)/);
  });

  it("keeps the signature and the positional USING clauses untouched", () => {
    // Adding a parameter would renumber four USING clauses on the core search
    // RPC. The delimiter avoids that entirely, which is why it was chosen.
    expect(MIG).toMatch(/p_location text DEFAULT NULL,/);
    expect(MIG).not.toMatch(/p_location_any|p_locations/);
  });

  it("a plain location still behaves exactly as before", () => {
    // No pipe means a one-element array, so every existing caller is
    // unaffected whether or not it knows about this.
    expect(MIG).toMatch(/one-element array and behaves EXACTLY as before/i);
  });

  it("strips the delimiter from user input so a typed location cannot split itself", () => {
    // Real locations here DO contain pipes: BAYADA publishes
    // "Philadelphia | 39.95 | -75.16". Untrusted input must never reshape the
    // query, the same reason % and _ are stripped.
    expect(FN).toMatch(/const sanitizeTerm = \(t: string\) => t\.replace\(\/\[%_\\\\\|\]\/g, ""\)/);
  });

  it("joins only sanitized names, and yields null when nothing survives", () => {
    const fn = /function rankedLocationParam\([\s\S]*?\n}/.exec(FN)?.[0] ?? "";
    expect(fn, "rankedLocationParam not found").not.toBe("");
    expect(fn).toMatch(/\.map\(\(t\) => sanitizeTerm\(t\)\)\.filter\(Boolean\)\.join\("\|"\)/);
    expect(fn).toMatch(/if \(terms\.length === 0\) return null;/);
  });
});
