/**
 * CREATE OR REPLACE REPLACES THE WHOLE FUNCTION, NOT THE PART YOU WERE THINKING
 * ABOUT.
 *
 * agent_sent_today(uuid) is SECURITY DEFINER, takes the user id as a parameter,
 * and is granted to `authenticated`. On 2026-07-30 that was found and closed
 * twice — 20260730050000 and 20260730224753 — with a caller check in the body:
 * service_role may ask about anyone, a person may only ask about themselves.
 *
 * On 2026-08-03 the cap was changed to count COMMITMENTS rather than
 * completions. That change was right, and it was written as a plain
 * `LANGUAGE sql` CREATE OR REPLACE — which replaced the whole function and
 * dropped the ownership check with it. Nobody removed the check; it was simply
 * not carried forward, and nothing failed when it went. For twenty-four days any
 * signed-in user could POST rpc/agent_sent_today with somebody else's uuid and
 * read their daily application count.
 *
 * The REVOKE was never the protection here. anon was revoked and stayed
 * revoked, and the offender is `authenticated` — a role the GRANT deliberately
 * allows. Only the in-body check separates "asking about myself" from "asking
 * about you", so a grep for REVOKE reports this function as locked down while
 * it is wide open to every account on the site.
 *
 * So this guard does not pin one function's spelling. It states the property
 * for the whole class, against the LAST definition in the migration chain — the
 * live one: a SECURITY DEFINER function that takes a uuid and is reachable by
 * authenticated or anon must consult auth.uid(). Any future rewrite that keeps
 * the counting and forgets the caller fails here rather than shipping.
 *
 * Verified to have teeth: with 20260827190000 excluded, the scan below returns
 * exactly ['agent_sent_today'].
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

/** Comments first — a rule quoting the broken form must not fail itself. */
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

interface Def { file: string; body: string }

/**
 * The last CREATE in filename order wins, because that is what the database
 * ends up running. Grants are tracked the same way: the newest file that says
 * anything about a function's grants describes its live state.
 */
function scanMigrations() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const latest = new Map<string, Def>();
  const grants = new Map<string, { file: string; line: string }[]>();

  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), "utf8");

    const create = /CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\s*\(/g;
    for (let m = create.exec(sql); m; m = create.exec(sql)) {
      const end = sql.indexOf("$$;", m.index);
      if (end === -1) continue;
      latest.set(m[1], { file, body: sql.slice(m.index, end + 3) });
    }

    const grant = /(GRANT EXECUTE|REVOKE ALL) ON FUNCTION public\.(\w+)\s*\([^)]*\)\s*(?:TO|FROM) ([^;]+);/g;
    for (let m = grant.exec(sql); m; m = grant.exec(sql)) {
      const rows = grants.get(m[2]) ?? [];
      rows.push({ file, line: `${m[1]} ${m[3].trim()}` });
      grants.set(m[2], rows);
    }
  }
  return { latest, grants };
}

/** Reachable by a caller who is not the service role. */
function callableByPeople(rows: { file: string; line: string }[] | undefined): boolean {
  if (!rows?.length) return false;
  const newest = rows.reduce((a, b) => (b.file > a ? b.file : a), "");
  return rows
    .filter((r) => r.file === newest)
    .some((r) => r.line.startsWith("GRANT") && /\b(authenticated|anon)\b/.test(r.line));
}

function unguardedDefiners(): string[] {
  const { latest, grants } = scanMigrations();
  const offenders: string[] = [];

  for (const [fn, def] of [...latest].sort(([a], [b]) => a.localeCompare(b))) {
    const body = stripComments(def.body);
    if (!body.includes("SECURITY DEFINER")) continue;

    // Only functions that are TOLD who to answer about. One with no uuid
    // parameter can only be about its own caller, so there is nothing to
    // confuse.
    const header = body.split("AS $$")[0];
    const params = /\((.*?)\)\s*RETURNS/s.exec(header);
    if (!params || !/\buuid\b/i.test(params[1])) continue;

    if (body.includes("auth.uid()")) continue;
    if (!callableByPeople(grants.get(fn))) continue;
    offenders.push(fn);
  }
  return offenders;
}

describe("a definer function told whose row to read must check who is asking", () => {
  it("has migrations to scan at all", () => {
    // A scanner that silently reads nothing passes forever. Pin the input.
    const { latest } = scanMigrations();
    expect(latest.size, "no function definitions parsed — the scanner is broken, not the schema")
      .toBeGreaterThan(50);
  });

  it("finds no SECURITY DEFINER function that takes a uuid, answers people, and never reads auth.uid()", () => {
    expect(
      unguardedDefiners(),
      "these run as the owner, are handed a user id by the caller, and are reachable by authenticated or anon — each one hands any signed-in user somebody else's row",
    ).toEqual([]);
  });

  it("still guards agent_sent_today specifically — this is where the class was found", () => {
    const { latest } = scanMigrations();
    const body = stripComments(latest.get("agent_sent_today")?.body ?? "");
    expect(body, "agent_sent_today has no live definition").not.toEqual("");
    expect(body, "the ownership check was dropped again")
      .toMatch(/auth\.uid\(\)\s*<>\s*p_user/);
    expect(body, "the worker must keep its cross-user read, or the cap stops being enforced")
      .toMatch(/auth\.role\(\)[^\n]*service_role/);
  });
});
