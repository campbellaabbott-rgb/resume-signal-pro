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
const SHARED = readFileSync(resolve(ROOT, "supabase/functions/_shared/location-terms.ts"), "utf8"); // definitions moved here 2026-09-03; call sites stay in index.ts
/**
 * The NEWEST migration that teaches the RPC to split, not the first one named
 * like it. The first attempt was reverted and its file is still on disk, so a
 * `.find()` returns the rolled-back version and every assertion below reads the
 * wrong text — which is how these four sat skipped against a file that could
 * never satisfy them.
 */
const MIG = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  const hits = readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .filter((n) => readFileSync(resolve(dir, n), "utf8").includes("string_to_array($3, ''|'')"))
    .sort();
  return hits.length ? readFileSync(resolve(dir, hits[hits.length - 1]), "utf8") : "";
})();

describe("a metro alias reaches every path, not just the one nobody types into", () => {
  // FOUR ASSERTIONS BELOW ARE SKIPPED, not deleted. They describe the
  // pipe-delimited RPC change, which was correct in intent and REVERTED in
  // execution: it was applied to a definition read from this repo, while the
  // definition that runs carries an extra p_sources parameter that exists only
  // in the database. The result was a second overload and PGRST203 on every
  // ranked search. Un-skip when the change is re-applied to the live
  // definition, read via pg_get_functiondef.

  it("NO ranked or count site passes the raw location any more", () => {
    // This is the whole bug: four sites, all bypassing the expansion.
    expect(FN).not.toMatch(/p_location: sanitizeTerm\(applied\.location\) \|\| null/);
    const wired = (FN.match(/p_location: rankedLocationParam\(applied\.location\)/g) ?? []).length;
    expect(wired, "every search_jobs call must send the expanded names").toBeGreaterThanOrEqual(4);
  });

  it("the RPC matches ANY of the delimited names, not the literal string", () => {
    // SKIPPED, not deleted. The delimiter approach is right and should return
    // — but only applied to the FIFTEEN-parameter definition that actually
    // runs in production, read out of the database rather than out of this
    // repo. Un-skip when that migration lands.
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
    //
    // THE STRUCTURE FIRST, THEN THE SENTENCE. This assertion used to be the
    // prose alone, and prose is not a property: it survives a rewrite that
    // breaks the clause and it fails a rewrite that merely reflows the line
    // (which is how it failed — a line break landed between "and" and
    // "behaves"). The split matching below is what actually makes a pipeless
    // location a one-element array; the sentence is the record of why.
    const decoded = MIG.replace(/''/g, "'");
    expect(decoded, "the alias list is no longer split on the delimiter")
      .toContain("string_to_array($3, '|')");
    expect(decoded, "a location is matched by equality again, so an alias list matches nothing")
      .toContain("ILIKE '%' || alias.x || '%'");
    expect(MIG.replace(/\n--\s*/g, " "), "the inherited location contract is no longer stated")
      .toMatch(/one-element array and behaves EXACTLY as before/i);
  });

  it("strips the delimiter from user input so a typed location cannot split itself", () => {
    // Real locations here DO contain pipes: BAYADA publishes
    // "Philadelphia | 39.95 | -75.16". Untrusted input must never reshape the
    // query, the same reason % and _ are stripped.
    // Asserts the SET of stripped characters, not the exact literal — the
    // class grew when state aliases forced quoting. Each one changes the
    // SHAPE of a query rather than its content.
    const strip = /const sanitizeTerm = \(t: string\) => t\.replace\(\/\[([^\]]+)\]\/g, ""\)/.exec(SHARED)?.[1] ?? "";
    expect(strip, "sanitizeTerm character class not found").not.toBe("");
    for (const ch of ["%", "_", "|"]) {
      expect(strip.includes(ch), `sanitizeTerm must strip ${ch}`).toBe(true);
    }
    expect(strip.includes("\\\\"), "sanitizeTerm must strip the backslash").toBe(true);
  });

  it("sends EVERY name, now that the RPC can split them", () => {
    // The interlock above is released. While the RPC matched one substring,
    // sending "Philly|Philadelphia" would have matched NOTHING — worse than the
    // bug — so this assertion used to pin the single-canonical workaround. The
    // split is re-applied in 20260823010000, built from the signature that is
    // live rather than from the newest-looking file, which is the one thing the
    // reverted attempt got wrong.
    //
    // What it buys, measured before the change: "bay area" alone returned San
    // Francisco 40 / San Jose 10 / Oakland 5, while the same location with
    // q=engineer returned San Jose ZERO. A job title should not shrink a metro.
    const fn = /function rankedLocationParam\([\s\S]*?\n}/.exec(SHARED)?.[0] ?? "";
    expect(fn, "rankedLocationParam not found").not.toBe("");
    expect(fn).toMatch(/join\("\|"\)/);
    expect(fn).toMatch(/if \(terms\.length === 0\) return null;/);
    // Every name is sanitized individually — the delimiter must not survive
    // inside a term and split it again on the SQL side.
    expect(fn).toMatch(/terms\.map\(\(t\) => sanitizeTerm\(t\)\)/);
  });

  it("the edge change is USELESS AND HARMFUL without its migration", () => {
    // Stated here because it decides deploy order, and getting it wrong is
    // worse than not shipping: against a one-substring definition the joined
    // value matches nothing, so EVERY metro and all 122 state aliases would
    // return zero results. Migration first, then the function. The reverse
    // order is an outage, not a degradation.
    expect(MIG, "the split migration must exist before the edge change ships").not.toBe("");
    expect(MIG).toMatch(/string_to_array\(\$3, ''\|''\)/);
    expect(MIG).toMatch(/string_to_array\(\$2, ''\|''\)/);
  });
});
