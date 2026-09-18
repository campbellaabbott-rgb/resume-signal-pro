/**
 * EVERY READER GATES ON THE MATCH KIND AND THE LINK, IN SQL.
 *
 * The behavioural guard (a-filing-without-a-curated-employer-never-leaves-
 * the-table) proves the shipped functions refuse the seven wrong pairs. This
 * file pins the SHAPE that makes the proof hold for every reader at once, so
 * a fourth reader added later -- a new surface, a new RPC -- cannot ship
 * with a looser predicate than the three it copies:
 *
 *   1. layoff_matches.matched_via admits exactly two values, and every reader's
 *      predicate names exactly those two. There is no third value -- an
 *      "ambiguous" row was proposed and refused (an ambiguous filing gets NO
 *      row, and is counted), so a reader that tolerated one would be reading a
 *      value the table cannot hold today and might hold tomorrow.
 *   2. Every reader predicates on status active, on a link, on the event date
 *      not after our read, on the WARN worker bar, and never prints an 8-K/A.
 *   3. The matcher's code carries no fuzzy operator: no trigram, similarity,
 *      levenshtein, LIKE or ILIKE with a wildcard, no prefix comparison, no
 *      ticker. Lane 3 measured 5 of 15 wrong on ticker-equals-token alone.
 *
 * All checks run on COMMENT-STRIPPED SQL (project_guard_literals: a spelling
 * that appears in a comment has satisfied a guard seven times while the code
 * beneath it was wrong), and each check is proven to fire on a mutated copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

/** Latest CREATE of a function by name, comment-stripped. */
function latestBody(fn: string): string {
  let body = "";
  for (const f of files) {
    const code = stripSql(read(f));
    const re = new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\$\\$;`, "g");
    for (const m of code.matchAll(re)) body = m[0];
  }
  return body;
}

/** The CHECK list on layoff_matches.matched_via, from the latest table DDL. */
function matchedViaValues(): string[] {
  let vals: string[] = [];
  for (const f of files) {
    const code = stripSql(read(f));
    const t = code.match(/CREATE TABLE(?: IF NOT EXISTS)? public\.layoff_matches\s*\(([\s\S]*?)\n\);/);
    if (!t) continue;
    const m = t[1].match(/matched_via\s+text[^,]*CHECK \(matched_via IN \(([^)]*)\)\)/);
    if (m) vals = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  }
  return vals;
}

/** Every value a reader's matched_via predicate admits, or null when it has none. */
function matchedViaPredicate(code: string): string[] | null {
  const m = code.match(/\bm\.matched_via\s+IN\s*\(([^)]*)\)/);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : null;
}

const READER_RULES: Array<[name: string, re: RegExp]> = [
  ["status-active", /\bf\.status\s*=\s*'active'/],
  ["link-required", /\bf\.source_url IS NOT NULL/],
  ["not-after-our-read", /\bf\.event_date\s*<=\s*f\.source_read_at::date/],
  ["warn-worker-bar", /\(\s*f\.source\s*<>\s*'state_warn'\s+OR\s+f\.workers\s*>=\s*\(SELECT [\w.]+\.layoff_warn_min_workers FROM k [\w]+\)\s*\)/],
  ["never-an-8k-a", /\bf\.form IS DISTINCT FROM '8-K\/A'/],
];

/** What a reader gets wrong, so the same routine runs on real bodies and on mutants. */
function readerViolations(code: string, allowed: string[]): string[] {
  const v: string[] = [];
  const admits = matchedViaPredicate(code);
  if (!admits) v.push("no-match-kind-predicate");
  else if (admits.join() !== allowed.join()) v.push(`match-kind:${admits.join("|")}`);
  for (const [name, re] of READER_RULES) if (!re.test(code)) v.push(name);
  return v;
}

const FUZZY: Array<[name: string, re: RegExp]> = [
  ["trigram", /\bsimilarity\s*\(|\bword_similarity\s*\(|\bpg_trgm\b|<->|[\w)]\s+%\s+[\w(']/i],
  ["levenshtein", /\blevenshtein/i],
  ["like-wildcard", /\b(?:I?LIKE)\s+'[^']*%|\b(?:I?LIKE)\s+[\w.]+\s*\|\|\s*'%'/i],
  ["prefix", /\bleft\s*\(\s*[\w.]*norm|\bstarts_with\s*\(|\^@/i],
  ["ticker", /\bticker\b/i],
  ["hiring-organization-name", /hiringOrganization/i],
];
function matcherViolations(code: string): string[] {
  return FUZZY.filter(([, re]) => re.test(code)).map(([n]) => n);
}

describe("layoff_matches admits exactly two match kinds, and every reader names exactly those two", () => {
  const allowed = matchedViaValues();
  const readers = ["get_employer_layoff_filings", "get_employer_layoff_filings_all", "refresh_layoff_partition"];

  it("the table's CHECK is the two-value list, with no third value", () => {
    expect(allowed).toEqual(["alias", "exact_multitoken"]);
  });

  for (const fn of readers) {
    it(`${fn}: found, DEFINER, and carries every reader predicate on comment-stripped code`, () => {
      const body = latestBody(fn);
      expect(body, `${fn} is not defined in any migration`).not.toBe("");
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/SET search_path = public/);
      expect(readerViolations(body, allowed), `${fn} reads layoff_filings with a looser predicate than the rule`).toEqual([]);
    });
  }

  it("the word 'ambiguous' names a COUNT in the matcher and a value nowhere", () => {
    // The matcher returns lm_refused_ambiguous. No function anywhere writes or
    // reads a matched_via of that spelling.
    const all = files.map((f) => stripSql(read(f))).join("\n");
    expect(all).not.toMatch(/matched_via\s*(?:=|IN\s*\([^)]*)'ambiguous'/);
    expect(all).not.toMatch(/'ambiguous'\s*(?:,\s*'[^']*'\s*)*\)\s*\)/);
    expect(latestBody("layoff_matches_rebuild")).toMatch(/lm_refused_ambiguous/);
  });

  it("the matcher carries no fuzzy operator, no prefix, no ticker, no hiringOrganization.name", () => {
    const body = latestBody("layoff_matches_rebuild");
    expect(body).not.toBe("");
    expect(matcherViolations(body)).toEqual([]);
    // What it DOES join on: equality of two normalised strings, and the token
    // floor -- two or more tokens of two or more letters, so a possessive "s"
    // or a dotted "com" does not lift a one-word brand over the bar.
    expect(body).toMatch(/b\.display_norm\s*=\s*f\.filer_norm/);
    expect(body).toMatch(/\(SELECT count\(\*\) FROM unnest\(string_to_array\(f\.filer_norm, ' '\)\) AS tk\(t\) WHERE length\(tk\.t\) >= 2\)\s*>=\s*2/);
    expect(body).not.toMatch(/array_length\(string_to_array\(f\.filer_norm, ' '\), 1\)\s*>=\s*2/);
  });

  it("the matcher is the only writer of layoff_matches", () => {
    const writers = new Set<string>();
    for (const f of files) {
      const code = stripSql(read(f));
      for (const m of code.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\([\s\S]*?\$\$;/g)) {
        if (/INSERT INTO public\.layoff_matches\b/.test(m[0])) writers.add(m[1]);
      }
    }
    expect([...writers]).toEqual(["layoff_matches_rebuild"]);
  });
});

describe("the checks have teeth", () => {
  const GOOD = `
    CREATE OR REPLACE FUNCTION public.get_x(p text) RETURNS TABLE (lf_a text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      WITH k AS (SELECT 90 AS layoff_display_max_age_days, 50 AS layoff_warn_min_workers)
      SELECT f.filer_raw FROM public.layoff_matches m JOIN public.layoff_filings f ON f.filing_id = m.filing_id
      WHERE m.matched_via IN ('exact_multitoken', 'alias')
        AND f.status = 'active'
        AND f.source_url IS NOT NULL
        AND f.event_date <= f.source_read_at::date
        AND (f.source <> 'state_warn' OR f.workers >= (SELECT kk.layoff_warn_min_workers FROM k kk))
        AND f.form IS DISTINCT FROM '8-K/A'
    $$;`;
  const allowed = ["alias", "exact_multitoken"];

  it("the fixture that mirrors a reader reports nothing", () => {
    expect(readerViolations(stripSql(GOOD), allowed)).toEqual([]);
  });

  it("fires when a reader admits a third match kind, or drops the predicate", () => {
    expect(readerViolations(GOOD.replace("IN ('exact_multitoken', 'alias')", "IN ('exact_multitoken', 'alias', 'ambiguous')"), allowed))
      .toEqual(["match-kind:alias|ambiguous|exact_multitoken"]);
    expect(readerViolations(GOOD.replace("m.matched_via IN ('exact_multitoken', 'alias')", "true"), allowed))
      .toEqual(["no-match-kind-predicate"]);
  });

  it("fires on each dropped bar, one at a time", () => {
    expect(readerViolations(GOOD.replace("AND f.status = 'active'", ""), allowed)).toEqual(["status-active"]);
    expect(readerViolations(GOOD.replace("AND f.source_url IS NOT NULL", ""), allowed)).toEqual(["link-required"]);
    expect(readerViolations(GOOD.replace("AND f.event_date <= f.source_read_at::date", ""), allowed)).toEqual(["not-after-our-read"]);
    expect(readerViolations(GOOD.replace("AND (f.source <> 'state_warn' OR f.workers >= (SELECT kk.layoff_warn_min_workers FROM k kk))", ""), allowed)).toEqual(["warn-worker-bar"]);
    expect(readerViolations(GOOD.replace("AND f.form IS DISTINCT FROM '8-K/A'", ""), allowed)).toEqual(["never-an-8k-a"]);
  });

  it("is not satisfied by a predicate that only appears in a comment", () => {
    const commentOnly = GOOD.replace("AND f.status = 'active'", "-- AND f.status = 'active'");
    expect(readerViolations(commentOnly, allowed), "raw text would pass").toEqual([]);
    expect(readerViolations(stripSql(commentOnly), allowed)).toEqual(["status-active"]);
  });

  it("the fuzzy scan fires on each banned operator", () => {
    const base = "SELECT 1 FROM a JOIN b ON b.display_norm = f.filer_norm";
    expect(matcherViolations(base)).toEqual([]);
    expect(matcherViolations(base + " OR similarity(b.display_norm, f.filer_norm) > 0.8")).toEqual(["trigram"]);
    expect(matcherViolations(base + " OR b.display_norm % f.filer_norm")).toEqual(["trigram"]);
    expect(matcherViolations(base + " OR levenshtein(b.display_norm, f.filer_norm) <= 2")).toEqual(["levenshtein"]);
    expect(matcherViolations(base + " OR b.display_norm LIKE f.filer_norm || '%'")).toEqual(["like-wildcard"]);
    expect(matcherViolations(base + " OR b.display_norm ILIKE 'emer%'")).toEqual(["like-wildcard"]);
    expect(matcherViolations(base + " OR left(b.display_norm, 5) = left(f.filer_norm, 5)")).toEqual(["prefix"]);
    expect(matcherViolations(base + " OR b.ticker = f.company_token")).toEqual(["ticker"]);
    expect(matcherViolations(base + " OR p.hiringOrganization ->> 'name' = f.filer_raw")).toEqual(["hiring-organization-name"]);
  });
});
