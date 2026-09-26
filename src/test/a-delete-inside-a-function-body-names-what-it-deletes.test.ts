import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A DELETE INSIDE A FUNCTION BODY NAMES WHAT IT DELETES.
 *
 * Measured live 2026-09-26. The H-1B wage load failed on the LAST of six
 * chunks -- the one that swaps the staged period in -- with "DELETE requires a
 * WHERE clause". The swap removed every row of the served table with no
 * predicate, and a predicate-less delete is refused in the session PostgREST
 * hands a SECURITY DEFINER function.
 *
 * WHY IT WAS NOT CAUGHT EARLIER, and why a guard is the right answer rather
 * than a fix. The refusal is NOT universal: layoff_matches_rebuild carries the
 * identical shape and has run nightly for weeks without complaint, because
 * pg_cron calls it and pg_cron's session is not the one that refuses. So the
 * codebase contained a working example of the thing that fails, which is the
 * worst possible teacher. The mirror function, which IS called over PostgREST,
 * has always pruned with a real predicate and has always worked. Nothing in
 * the repo made that distinction visible before this file.
 *
 * WHAT THIS GUARDS. No DELETE inside a plpgsql function body may omit its
 * WHERE clause -- whoever calls it today. It reads only the LAST migration
 * that defines each function, because migrations are immutable: the text of a
 * superseded definition is history and re-issuing a function is how this repo
 * changes one. A guard that read every file would demand edits to applied
 * migrations, which is the one thing the deploy rules forbid. A statement that
 * genuinely means "all of them" writes WHERE true and says so; a statement
 * that means something narrower writes the predicate it means. Top-level
 * DELETEs are NOT covered: those execute once, at apply time, in the runner's
 * own session, and several applied migrations legitimately use them.
 *
 * TEETH: strip the clause from either fixed statement and this fails.
 */

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "supabase/migrations");

/** Comment-stripped, because a DELETE quoted in a header is prose, not code. */
const codeOf = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*--[^\n]*$/gm, " ");

/** The spans between `AS $tag$` and its matching `$tag$` -- the function bodies. */
function bodies(sql: string): string[] {
  const out: string[] = [];
  const re = /AS\s+\$([a-zA-Z_]*)\$([\s\S]*?)\$\1\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push(m[2]);
  return out;
}

/** A DELETE whose statement ends before any WHERE ever appears. */
function clauselessDeletes(body: string): string[] {
  const re = /\bDELETE\s+FROM\s+([A-Za-z_.]+)(?:\s+(?:AS\s+)?[A-Za-z_]\w*)?\s*;/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[0].trim());
  return out;
}

const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

describe("a delete inside a function body names what it deletes", () => {
  it("no LIVE function definition deletes without a WHERE", () => {
    // function name -> the body from the newest migration that defines it
    const live = new Map<string, { file: string; body: string }>();
    for (const f of FILES) {
      const code = codeOf(readFileSync(resolve(DIR, f), "utf8"));
      const defs = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(public\.[a-z_]+)/gi;
      const names: string[] = [];
      let d: RegExpExecArray | null;
      while ((d = defs.exec(code))) names.push(d[1].toLowerCase());
      const bs = bodies(code);
      names.forEach((n, i) => { if (bs[i] !== undefined) live.set(n, { file: f, body: bs[i] }); });
    }
    expect(live.size, "no function definitions found — the parser has drifted").toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const [name, { file, body }] of live) {
      for (const del of clauselessDeletes(body)) offenders.push(`${name} (${file}): ${del}`);
    }
    expect(
      offenders,
      "a predicate-less DELETE in a definer body is refused the moment PostgREST calls it — " +
        "write WHERE true if it really means all of them",
    ).toEqual([]);
  });

  it("is not vacuous: it sees a clauseless DELETE when one is there", () => {
    const planted = "AS $fn$ BEGIN DELETE FROM public.some_table; END $fn$";
    expect(bodies(planted)).toHaveLength(1);
    expect(clauselessDeletes(bodies(planted)[0])).toHaveLength(1);
  });

  it("does not fire on a DELETE that carries a predicate, aliased or not", () => {
    const ok = "AS $fn$ BEGIN DELETE FROM public.t WHERE true; DELETE FROM public.u x WHERE x.n < 1; END $fn$";
    expect(clauselessDeletes(bodies(ok)[0])).toEqual([]);
  });

  it("ignores a DELETE quoted in a comment, which is prose", () => {
    const commented = "-- DELETE FROM public.t;\nAS $fn$ BEGIN DELETE FROM public.t WHERE true; END $fn$";
    expect(clauselessDeletes(bodies(codeOf(commented))[0])).toEqual([]);
  });

  it("covers the two statements that caused and nearly caused the failure", () => {
    const load = FILES.find((f) => f.includes("a_delete_with_no_where_is_refused"))!;
    const matcher = FILES.find((f) => f.includes("the_same_landmine_in_the_function"))!;
    expect(codeOf(readFileSync(resolve(DIR, load), "utf8"))).toMatch(/DELETE FROM public\.oflc_lca_wages WHERE loaded_at IS DISTINCT FROM p_run_started_at;/);
    expect(codeOf(readFileSync(resolve(DIR, matcher), "utf8"))).toMatch(/DELETE FROM public\.layoff_matches m WHERE true;/);
  });
});
