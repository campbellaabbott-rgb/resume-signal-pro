/**
 * "ANYWHERE IN GERMANY" COULD NOT BE SAID.
 *
 * A mandate matched place by substring on each posting's location TEXT.
 * Measured against production 2026-08-07:
 *
 *     country = DE           11,511      what the BOARD can express
 *     location ~ 'Germany'    7,594      what a MANDATE could express  (-34%)
 *     location ~ 'Berlin'     2,604
 *     country = GB           21,126
 *     location ~ 'London'    10,195
 *
 * A third of German postings never name the country — they say "Berlin", or
 * "Munich, Bavaria" — so a person hunting in Germany either listed every city
 * or lost the rest of the country. The board has had a normalised `country`
 * column all along; the mandate had no field for it.
 *
 * THE FAILURE THIS MUST NOT INTRODUCE. An unrecognised code becomes a predicate
 * matching NOTHING, and a mandate that silently matches nothing is
 * indistinguishable from a quiet job market — the exact shape of failure this
 * project keeps writing post-mortems about. So parsing drops what it cannot
 * validate, and the UI only offers codes the board's own facet returned.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseCountries, applyCountries } from "../../supabase/functions/_shared/mandate-reach";

const runner = readFileSync(resolve(__dirname, "../../supabase/functions/agent-runner/index.ts"), "utf8");
const panel = readFileSync(resolve(__dirname, "../components/account/MorningQueuePanel.tsx"), "utf8");
const DIR = resolve(__dirname, "../../supabase/migrations");
const mig = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .filter((t) => t.includes("agent_mandates_countries_len")).pop() ?? "";

/** A recording stand-in for the PostgREST builder. */
const fake = () => {
  const calls: Array<[string, unknown]> = [];
  const qb = {
    calls,
    eq(c: string, v: unknown) { calls.push(["eq", [c, v]]); return this; },
    in(c: string, v: unknown[]) { calls.push(["in", [c, v]]); return this; },
    gte(c: string, v: unknown) { calls.push(["gte", [c, v]]); return this; },
    // `is` joined Filterable with applyServingFences (the withdrawn-postings
    // fence). This spy has to satisfy the whole interface even though the
    // country rules never call it.
    is(c: string, v: unknown) { calls.push(["is", [c, v]]); return this; },
  };
  return qb;
};

describe("parsing a country list", () => {
  it("takes several", () => {
    expect(parseCountries("DE,AT,CH")).toEqual(["DE", "AT", "CH"]);
  });

  it("normalises case and spacing", () => {
    expect(parseCountries(" de , At ")).toEqual(["DE", "AT"]);
  });

  it("DROPS anything that is not a two-letter code", () => {
    // "GERMANY" as a filter matches zero rows, which reads as a dead market.
    expect(parseCountries("GERMANY,DE")).toEqual(["DE"]);
    expect(parseCountries("D,DEU,123,,DE")).toEqual(["DE"]);
  });

  it("dedupes", () => {
    expect(parseCountries("DE,de,DE")).toEqual(["DE"]);
  });

  it("bounds the list like every other multi-term field", () => {
    const many = Array.from({ length: 30 }, (_, i) => `A${String.fromCharCode(65 + (i % 26))}`).join(",");
    expect(parseCountries(many).length).toBeLessThanOrEqual(12);
  });

  it("treats absent, null and empty as NO countries", () => {
    for (const v of [undefined, null, "", "   ", ","]) {
      expect(parseCountries(v as string | null | undefined), `${JSON.stringify(v)}`).toEqual([]);
    }
  });
});

describe("what reaches the query", () => {
  it("adds no predicate at all when nothing is set — today's behaviour exactly", () => {
    // The backward-compatibility claim, and what lets the runner deploy before
    // the migration: every mandate saved before this field keeps its results.
    const qb = fake();
    applyCountries(qb, {});
    applyCountries(qb, { countries: null });
    applyCountries(qb, { countries: "" });
    expect(qb.calls).toEqual([]);
  });

  it("filters on the normalised column, not the location text", () => {
    const qb = fake();
    applyCountries(qb, { countries: "DE,AT" });
    expect(qb.calls).toEqual([["in", ["country", ["DE", "AT"]]]]);
  });

  it("adds NO predicate when every code was junk, rather than one matching nothing", () => {
    // The important direction. A filter built from garbage would return an
    // empty queue that looks like a quiet week.
    const qb = fake();
    applyCountries(qb, { countries: "GERMANY,EVERYWHERE" });
    expect(qb.calls).toEqual([]);
  });
});

describe("the runner applies it at BOTH query sites", () => {
  it("calls the helper twice — one site is the partial rollout", () => {
    // Exactly the two query builders. The import names it without a paren, so
    // this counts CALL SITES and nothing else — which is the property that
    // matters: applyCategory and applyMaxAge are each at both sites too, and a
    // third filter reaching only one is how a mandate silently means two
    // different things on two paths.
    expect((runner.match(/applyCountries\(/g) ?? []).length).toBe(2);
    expect((runner.match(/applyCategory\(/g) ?? []).length).toBe(2);
    expect((runner.match(/applyMaxAge\(/g) ?? []).length).toBe(2);
  });

  it("imports the shared helper rather than re-parsing inline", () => {
    // ASSERTED PER NAME, NOT AS ONE FROZEN LINE. This used to pin the exact
    // import list, so adding a FOURTH shared rule broke it — and the property
    // that matters is "each of these comes from _shared", not "the list is
    // spelled in this order and no other rule was ever added". A guard that
    // fails for a reason it does not care about gets deleted rather than fixed.
    const imported = /import \{([^}]*)\} from "\.\.\/_shared\/mandate-reach\.ts";/.exec(runner);
    expect(imported, "the runner must import its rules from _shared/mandate-reach.ts").not.toBeNull();
    const names = imported![1].split(",").map((n) => n.trim());
    for (const fn of ["applyCategory", "applyCountries", "applyMaxAge"]) {
      expect(names, `${fn} must come from the shared module, not be re-parsed inline`).toContain(fn);
    }
  });

  it("degrades one rung at a time, so a missing column costs only its own feature", () => {
    // A single widened select would drop the reach columns — live and applying
    // since 2026-08-05 — the moment `countries` is missing.
    expect(runner).toMatch(/max_age_days, include_uncategorised, countries/);
    expect(runner).toMatch(/countries column unavailable, keeping reach columns/);
    const i = runner.indexOf("max_age_days, include_uncategorised, countries");
    expect(runner.slice(i, i + 900)).toMatch(/readMandates\(`\$\{MANDATE_COLS\}, max_age_days, include_uncategorised`\)/);
  });

  it("does the same for saved searches", () => {
    expect(runner).toMatch(/readSearches\(`\$\{SEARCH_COLS\}, max_age_days, include_uncategorised, countries`\)/);
    expect(runner).toMatch(/readSearches\(`\$\{SEARCH_COLS\}, max_age_days, include_uncategorised`\)/);
    expect(runner).toMatch(/readSearches\(SEARCH_COLS\)/);
  });
});

describe("the migration", () => {
  it("adds the column to BOTH tables", () => {
    expect(mig).toMatch(/ALTER TABLE public\.agent_mandates\s+ADD COLUMN IF NOT EXISTS countries text/);
    expect(mig).toMatch(/ALTER TABLE public\.agent_searches\s+ADD COLUMN IF NOT EXISTS countries text/);
  });

  it("is nullable with no default, so existing mandates are untouched", () => {
    expect(mig).not.toMatch(/countries text NOT NULL/);
    expect(mig).not.toMatch(/countries text DEFAULT/);
  });

  it("bounds the length but does NOT validate the codes in SQL", () => {
    // A CHECK on contents would reject the whole save and lose the person's
    // other edits; parseCountries drops the bad code and keeps the rest.
    expect(mig).toMatch(/length\(countries\) <= 64/);
    expect(mig).not.toMatch(/countries\s*~\s*'/);
  });
});

describe("the picker cannot offer a country the board lacks", () => {
  it("reads the board's own facet RPC", () => {
    expect(panel).toMatch(/rpc\("get_country_facet"\)/);
  });

  it("keeps only two-letter codes from it", () => {
    expect(panel).toMatch(/r\.country === "string" && r\.country\.length === 2/);
  });

  it("hides the control when the facet is unavailable", () => {
    // An absent picker beats a list of codes we cannot vouch for.
    expect(panel).toMatch(/if \(!options\.length\) return null/);
  });

  it("stores through the runner's parser, so saved equals searched", () => {
    expect(panel).toMatch(/import \{ parseCountries \}/);
    // Reads reachPatch's merged source, not `form` directly: the one-press
    // start passes proposed values in explicitly, and a patch that read `form`
    // would save the pre-proposal state while the screen showed the proposal.
    expect(panel).toMatch(/const codes = parseCountries\(f\.countries\)/);
  });

  it("writes NULL for 'everywhere', not an empty string", () => {
    expect(panel).toMatch(/countries: codes\.length \? codes\.join\(","\) : null/);
  });

  it("carries the field through every form reset — mandate, saved search, and new", () => {
    // Three setForm sites. Missing one leaves a stale country selected from a
    // previous edit, quietly narrowing a search the person thinks is wide.
    expect((panel.match(/countries: [a-z]?\.?countries \?\? ""|countries: ""/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
