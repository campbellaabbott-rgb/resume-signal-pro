import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The /v1 metering is only worth what the table underneath it is.
 *
 * job_board_postings shipped with `FOR SELECT USING (true)` and a GRANT to
 * anon. The anon key is published in the frontend bundle by design, so for the
 * whole life of the board anyone could page all 565,161 postings straight off
 * PostgREST — bypassing api_keys, api_usage, api_rate, the free-tier quota, and
 * both freshness fences at once. Verified live 2026-08-27 before the fix.
 *
 * Two properties are pinned here, because both were reachable by accident:
 *
 *   1. The door stays shut — no migration re-opens SELECT to anon.
 *   2. A function that reads the table for anon must be SECURITY DEFINER.
 *      This is the one that will actually bite someone: with RLS on and no
 *      policy, an INVOKER function returns ZERO ROWS to anon rather than
 *      raising. The page renders honest-looking zeroes and nothing errors.
 */
const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/**
 * SQL with comments removed.
 *
 * THIS STRIP IS THE TEST'S OWN CORRECTNESS. The lockdown migration explains the
 * hole in prose, and that prose necessarily contains the literal
 * `FOR SELECT USING (true)`. A scanner that reads comments would match the
 * migration that CLOSED the hole and report it as the hole — this repo has
 * shipped that exact false positive four times.
 */
const stripped = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const LOCKDOWN = "20260827130000_the_key_wall_had_a_door_beside_it.sql";

describe("the key wall has no door beside it", () => {
  it("ships the lockdown migration", () => {
    expect(FILES, "the lockdown migration is missing").toContain(LOCKDOWN);
  });

  it("revokes the grant AND drops the policy — they fail differently", () => {
    // No GRANT: 42501, which says what happened. No policy but a live GRANT:
    // zero rows and HTTP 200, which is indistinguishable from an empty board.
    const sql = stripped(readFileSync(resolve(DIR, LOCKDOWN), "utf8"));
    expect(sql).toMatch(/DROP POLICY IF EXISTS "job_board_postings_public_read" ON public\.job_board_postings;/);
    expect(sql).toMatch(/REVOKE SELECT ON public\.job_board_postings FROM anon, authenticated;/);
    // And it must verify itself — a security migration that quietly does
    // nothing is worse than one that fails.
    expect(sql).toMatch(/SET LOCAL ROLE anon/);
    expect(sql).toMatch(/insufficient_privilege/);
    expect(sql, "the definer flip must be asserted from the catalog, not assumed").toMatch(/prosecdef/);
  });

  it("no later migration re-opens SELECT on the corpus to anon", () => {
    const after = FILES.filter((f) => f > LOCKDOWN);
    for (const f of after) {
      const sql = stripped(readFileSync(resolve(DIR, f), "utf8"));
      const reopens = /CREATE POLICY[^;]*ON public\.job_board_postings[^;]*FOR SELECT[^;]*USING\s*\(\s*true\s*\)/i.test(sql)
        || /GRANT[^;]*\bSELECT\b[^;]*ON public\.job_board_postings[^;]*TO[^;]*\banon\b/i.test(sql);
      expect(reopens, `${f} re-opens job_board_postings to anon — the /v1 wall is walkable again`).toBe(false);
    }
  });

  it("every anon-reachable function that reads the corpus is SECURITY DEFINER", () => {
    // Resolved against each function's NEWEST definition, because a function
    // that was invoker in 20260715 and definer in 20260811 is definer.
    // Replayed in migration order, CREATE and ALTER together, because that is
    // what the database actually ends up holding. A scan that reads only CREATE
    // bodies reports six false positives against the very migration that fixed
    // them — ALTER FUNCTION ... SECURITY DEFINER changes the flag and leaves the
    // body alone, which is exactly why the lockdown uses it.
    const create = /CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi;
    const alter = /ALTER FUNCTION\s+(?:public\.)?(\w+)\s*\([^)]*\)\s+SECURITY\s+(DEFINER|INVOKER)/gi;
    const latest = new Map<string, { definer: boolean; touches: boolean; trigger: boolean; file: string }>();
    for (const f of FILES) {
      const sql = stripped(readFileSync(resolve(DIR, f), "utf8"));
      const ms = [...sql.matchAll(create)];
      ms.forEach((m, i) => {
        const body = sql.slice(m.index!, i + 1 < ms.length ? ms[i + 1].index! : sql.length);
        latest.set(m[1], {
          definer: /SECURITY\s+DEFINER/i.test(body),
          touches: body.includes("job_board_postings"),
          trigger: /RETURNS\s+trigger/i.test(body),
          file: f,
        });
      });
      for (const m of sql.matchAll(alter)) {
        const prev = latest.get(m[1]);
        // The body is unchanged by ALTER, so `touches` carries over.
        if (prev) latest.set(m[1], { ...prev, definer: m[2].toUpperCase() === "DEFINER", file: f });
      }
    }
    expect(latest.size, "no functions parsed — the assertion below would be vacuous").toBeGreaterThan(100);

    const leaky = [...latest.entries()]
      .filter(([, v]) => v.touches && !v.definer && !v.trigger)
      .map(([n, v]) => `${n} (${v.file})`);
    expect(
      leaky,
      "these read job_board_postings as the CALLER, so under the lockdown they return " +
        "zero rows to anon instead of raising — silently blank stats, not an error:\n  " +
        leaky.join("\n  "),
    ).toEqual([]);
  });

  it("the six converted functions are named in the lockdown", () => {
    const sql = stripped(readFileSync(resolve(DIR, LOCKDOWN), "utf8"));
    for (const fn of [
      "get_entry_level_companies", "get_entry_level_stats", "get_hiring_trends",
      "get_salary_benchmarks", "get_stale_board_count", "get_trending_categories",
    ]) {
      expect(sql, `${fn} must be flipped to definer`).toMatch(
        new RegExp(`ALTER FUNCTION public\\.${fn}\\([^)]*\\)\\s+SECURITY DEFINER;`),
      );
    }
  });
});
