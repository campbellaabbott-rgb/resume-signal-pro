import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A PL/pgSQL FUNCTION SHIPPED A 400 ON EVERY CALL.
 *
 *   {"code":"42702","message":"column reference \"superseded\" is ambiguous",
 *    "details":"It could refer to either a PL/pgSQL variable or a table column."}
 *
 * get_board_flow was rewritten from LANGUAGE sql to LANGUAGE plpgsql. That
 * rewrite turns every name in `RETURNS TABLE (...)` into an OUT PARAMETER that
 * is in scope for the whole body. One of them — `superseded` — is also a column
 * on job_board_closures, and the body referenced it bare:
 *
 *     count(*) FILTER (WHERE superseded)
 *
 * The identical line was CORRECT in the LANGUAGE sql version, because SQL
 * functions have no such scope. The ambiguity was manufactured by a declaration
 * forty lines away, which is precisely why reading the changed lines did not
 * catch it — and why this check is mechanical rather than a habit.
 *
 * THE RULE: inside a plpgsql body, any name that is BOTH an OUT parameter and a
 * real column of a table the body reads must be qualified through an alias.
 * Qualifying costs nothing; the collision list changes every time someone edits
 * a return shape.
 */
const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

/** Column names of the tables these functions actually read. */
const COLUMNS_BY_TABLE: Record<string, string[]> = {
  job_board_closures: ["superseded", "closed_at", "posting_id", "company_token", "category", "first_seen", "posted_at", "source", "company", "title"],
  job_board_postings: ["first_seen", "last_seen", "missing_since", "effective_posted", "posted_at", "category", "source", "company_token", "remote", "salary", "title", "location", "work_mode"],
  job_board_exits: ["exited_at", "exit_reason", "days_on_board", "posting_id", "category", "source", "company_token"],
  job_board_pool_samples: ["sampled_at", "serving", "total"],
};

/** Strip SQL comments so prose about a name is never mistaken for a reference. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The newest migration that defines this function — earlier ones are superseded. */
function newestDefining(fnName: string): { file: string; sql: string } {
  const files = readdirSync(MIG_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .filter((n) => {
      // -a semantics: read as utf8 regardless; a NUL byte anywhere in a file
      // makes /usr/bin/grep skip it silently, and that has produced false
      // "no match" conclusions in this repo before.
      const s = readFileSync(resolve(MIG_DIR, n), "utf8");
      return new RegExp(`FUNCTION public\\.${fnName}\\s*\\(`).test(s);
    });
  const file = files[files.length - 1];
  return { file, sql: readFileSync(resolve(MIG_DIR, file), "utf8") };
}

describe("plpgsql OUT parameters cannot silently capture a column", () => {
  const { file, sql } = newestDefining("get_board_flow");

  it("is defined by a migration we can find", () => {
    expect(file, "no migration defines get_board_flow").toBeTruthy();
  });

  it("qualifies every OUT-parameter name that is also a column it reads", () => {
    const body = stripComments(sql.slice(sql.indexOf("AS $$"), sql.lastIndexOf("$$")));
    const outs = /RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE/.exec(sql)?.[1] ?? "";
    expect(outs, "RETURNS TABLE not found").not.toBe("");
    const outNames = outs
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);

    // Which tables does this body actually read?
    const tablesRead = Object.keys(COLUMNS_BY_TABLE).filter((t) =>
      new RegExp(`public\\.${t}\\b`).test(body),
    );
    expect(tablesRead.length, "body reads no known table — update COLUMNS_BY_TABLE").toBeGreaterThan(0);

    const colliding = outNames.filter((n) =>
      tablesRead.some((t) => COLUMNS_BY_TABLE[t].includes(n)),
    );
    // `superseded` and `serving` collide today. If this list ever empties, the
    // check below is vacuous — so assert it is non-empty and the guard is real.
    expect(colliding.length, "expected at least one OUT name to collide with a column").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const name of colliding) {
      // A bare reference: the name NOT preceded by `alias.` and not part of a
      // longer identifier. Declarations and the RETURN QUERY select list use
      // v_-prefixed locals, so they cannot match.
      const bare = new RegExp(`(?<![\\w.])${name}(?![\\w])`, "g");
      for (const m of body.matchAll(bare)) {
        const before = body.slice(Math.max(0, m.index! - 40), m.index!);
        // Allowed: inside the INSERT column list of a table we write, and in
        // the DECLARE/RETURN plumbing which only names v_ locals.
        if (/INSERT INTO[\s\S]*\($/.test(before)) continue;
        offenders.push(`${name} @ "...${before.slice(-32).replace(/\s+/g, " ")}[${name}]"`);
      }
    }
    expect(
      offenders,
      `unqualified reference to a name that is BOTH an OUT parameter and a real column — ` +
        `this is the 42702 that took get_board_flow down. Qualify it through a table alias ` +
        `(c.superseded, s.serving). Offenders:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("aliases every table it selects from", () => {
    const body = stripComments(sql.slice(sql.indexOf("AS $$"), sql.lastIndexOf("$$")));
    const unaliased: string[] = [];
    for (const m of body.matchAll(/FROM\s+public\.(\w+)\s*(\w*)/g)) {
      const [, table, alias] = m;
      if (!alias || /^(WHERE|ORDER|LIMIT|GROUP|ON|AND|INTO)$/i.test(alias)) unaliased.push(table);
    }
    expect(
      unaliased,
      `every table must carry an alias so its columns can be qualified: ${unaliased.join(", ")}`,
    ).toEqual([]);
  });
});
