import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A FIX WAS REVERTED BY COPYING A BODY FROM THE WRONG MIGRATION.
 *
 * 20260901090000 re-issued all three search functions together — the rule that
 * stops them drifting apart — by extracting their bodies programmatically from
 * 20260828122000. For search_jobs and count_jobs_capped that file WAS still
 * the live definition. For fuzzy_title_search it was not: 20260829120000 had
 * fixed its location clause in between, and copying the older body silently
 * put the bug back into production.
 *
 * The reverted clause matched a '|'-joined alias list against p.location with
 * a single ILIKE. p_location arrives as "New York|NYC|Manhattan", so the test
 * was true for no row that has ever existed: the typo-rescue tier returned
 * nothing whenever a location filter was active. "nurse practicioner" in NYC
 * lost its rescue results and looked like a board with no matching jobs.
 *
 * THE RULE THIS PINS. "Extract the current body" must read the latest
 * migration that defines THAT FUNCTION, not the latest migration that defines
 * the group. The three ship together; they do not last change together. The
 * check is written against whichever migration currently defines the function,
 * so it survives the next re-issue instead of naming a file that will move.
 */
const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

/** The last migration that defines a function is the live definition of it. */
function liveDefinitionOf(fn: string): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => readFileSync(resolve(MIGRATIONS, f), "utf8").includes(`FUNCTION public.${fn}(`));
  const file = files[files.length - 1] ?? "";
  const src = file ? readFileSync(resolve(MIGRATIONS, file), "utf8") : "";
  const i = src.indexOf(`FUNCTION public.${fn}(`);
  const j = src.indexOf("\n$$;", i);
  return { file, body: i >= 0 && j > i ? src.slice(i, j) : "" };
}

describe("a body copied from the wrong migration", () => {
  it("the live fuzzy_title_search still splits the alias list", () => {
    const { file, body } = liveDefinitionOf("fuzzy_title_search");
    expect(body, "fuzzy_title_search has no live definition").not.toBe("");
    expect(
      body,
      `${file} matches p_location whole. It arrives '|'-joined, so a whole match is ` +
        `true for no row — the rescue tier goes silent under any location filter. ` +
        `Re-issuing this function means copying from ITS latest definition, not the group's.`,
    ).toMatch(/unnest\(string_to_array\(p_location, '\|'\)\)/);
    expect(body, "the whole-string form must not come back").not.toMatch(
      /p_location IS NULL OR p\.location ILIKE '%' \|\| p_location \|\| '%'/,
    );
  });

  it("every search function that takes p_location splits it the same way", () => {
    // The clause was fixed in one function and left wrong in another once
    // already. Whichever migration currently owns each definition, they have
    // to agree — a location that means three places in one function and one
    // literal string in another is the same defect wearing a different name.
    for (const fn of ["search_jobs", "count_jobs_capped", "fuzzy_title_search"]) {
      const { file, body } = liveDefinitionOf(fn);
      if (!body.includes("p_location")) continue;
      // TWO SPELLINGS, ONE RULE. fuzzy is static SQL and names the parameter;
      // search_jobs and count_jobs_capped build dynamic SQL and refer to it
      // positionally with doubled quotes ("string_to_array($3, ''|'')"). What
      // matters is that the list is SPLIT, never matched whole — so the check
      // accepts either form and rejects the whole-string match outright.
      const splits = /unnest\(string_to_array\((?:p_location|\$\d+), (?:'\|'|''\|'')\)\)/.test(body);
      expect(splits, `${fn} (live in ${file}) does not split the alias list`).toBe(true);
      expect(
        body,
        `${fn} (live in ${file}) matches the alias list whole — true for no row`,
      ).not.toMatch(/p_location IS NULL OR p\.location ILIKE '%' \|\| p_location \|\| '%'/);
    }
  });
});
