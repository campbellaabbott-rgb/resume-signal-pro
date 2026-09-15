import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A RESERVED WORD IS NOT A CTE NAME.
 *
 * WHAT HAPPENED. 20260909212000 named a common table expression `both`:
 *
 *   both AS ( ... )  ...  FROM both b
 *
 * BOTH is a reserved word in PostgreSQL. The pglite the harnesses run parsed
 * it; the production server did not, and the file failed to apply on
 * 2026-09-09 — silently, because nothing reads the tables it creates yet.
 * It was applied six days later, on 2026-09-15, by the deploy runner as an
 * edited copy that quoted the name ("both"), staged under a name the repo
 * does not carry. The repo file was then brought to the applied text. Until
 * that day get_company_growth (20260909227000) could not have been applied
 * either — it joins the flow table 212000 creates — and the "Actively
 * hiring" posting-rate half would have read as an error on every board.
 *
 * THE PROPERTY. No migration names a CTE, or aliases a FROM/JOIN item, with
 * a word PostgreSQL reserves, unquoted. The list below is the "reserved"
 * column of the server's keyword table (src/include/parser/kwlist.h,
 * RESERVED_KEYWORD), not the non-reserved words that are legal as names.
 * Comments are stripped first: a guard must read code, never prose.
 *
 * WHY A TEXT GUARD AND NOT THE HARNESS. The harness runs pglite, which is the
 * parser that ACCEPTED the bad name. A property the runtime under test
 * cannot see has to be stated as text.
 */

const DIR = resolve(__dirname, "../../supabase/migrations");

/** PostgreSQL RESERVED_KEYWORD set (kwlist.h). Non-reserved and col-name
 *  keywords (e.g. `name`, `version`, `rows`, `window`) are deliberately
 *  absent: they are legal identifiers. */
export const PG_RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric",
  "both", "case", "cast", "check", "collate", "column", "constraint", "create",
  "current_catalog", "current_date", "current_role", "current_time",
  "current_timestamp", "current_user", "default", "deferrable", "desc",
  "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign",
  "from", "grant", "group", "having", "in", "initially", "intersect", "into",
  "lateral", "leading", "limit", "localtime", "localtimestamp", "not", "null",
  "offset", "on", "only", "or", "order", "placing", "primary", "references",
  "returning", "select", "session_user", "some", "symmetric", "system_user",
  "table", "then", "to", "trailing", "true", "union", "unique", "user", "using",
  "variadic", "when", "where", "window", "with",
]);

/** Drop line comments (double dash), block comments (slash-star) and string
 *  literals, so a word inside prose or a message can never trip the scan. */
export function codeOnly(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Every unquoted CTE name in a WITH list: `WITH x AS (`, `, x AS (`,
 *  `WITH RECURSIVE x AS (`, and `x(cols) AS (`. Returns the offending names. */
export function reservedCteNames(sql: string): string[] {
  const code = codeOnly(sql);
  const out: string[] = [];
  const re = /(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*(?:not\s+)?materialized\s*\(|(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const name = (m[1] ?? m[2] ?? "").toLowerCase();
    if (PG_RESERVED.has(name)) out.push(name);
  }
  return out;
}

/** Every unquoted alias after a FROM / JOIN item: `FROM both b` is fine (the
 *  alias is `b`); `FROM x both` is not. Returns the offending aliases. */
export function reservedFromAliases(sql: string): string[] {
  const code = codeOnly(sql);
  const out: string[] = [];
  const re = /\b(?:from|join)\s+(?:[a-z_][a-z0-9_.]*|\([^()]*\))\s+(?:as\s+)?([a-z_][a-z0-9_]*)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const alias = m[1].toLowerCase();
    // words that legitimately FOLLOW a FROM item without being an alias
    if (["where", "on", "using", "join", "left", "right", "inner", "outer", "full", "cross", "natural", "group", "order", "limit", "offset", "union", "except", "intersect", "returning", "for", "window", "having", "with", "as", "lateral", "tablesample", "fetch", "into", "and", "or", "when", "then", "else", "end", "not", "in", "is", "only"].includes(alias)) continue;
    if (PG_RESERVED.has(alias)) out.push(alias);
  }
  return out;
}

describe("a reserved word is not a CTE name", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

  it("no migration names a CTE with a PostgreSQL reserved word", () => {
    const bad: string[] = [];
    for (const f of files) {
      const names = reservedCteNames(readFileSync(resolve(DIR, f), "utf8"));
      for (const n of names) bad.push(`${f}: CTE "${n}"`);
    }
    expect(bad, "quote the name or rename it — pglite accepts these, the server does not").toEqual([]);
  });

  it("no migration aliases a FROM item with a PostgreSQL reserved word", () => {
    const bad: string[] = [];
    for (const f of files) {
      const names = reservedFromAliases(readFileSync(resolve(DIR, f), "utf8"));
      for (const n of names) bad.push(`${f}: alias "${n}"`);
    }
    expect(bad).toEqual([]);
  });

  it("the file that taught this lesson carries the quoted name and the note", () => {
    const f = files.find((x) => x.startsWith("20260909212000_"));
    expect(f).toBeDefined();
    const sql = readFileSync(resolve(DIR, f!), "utf8");
    expect(codeOnly(sql)).toMatch(/"both"\s+AS\s*\(/);
    expect(codeOnly(sql)).toMatch(/FROM\s+"both"\s+b\b/);
    expect(sql).toMatch(/20260909212000_fixed/); // the staged name the runner applied
  });
});

describe("a reserved word is not a CTE name — has teeth", () => {
  it("catches the exact shape 212000 shipped, and not its quoted repair", () => {
    expect(reservedCteNames("WITH x AS (SELECT 1),\n  both AS (SELECT 2)\nSELECT * FROM both b")).toEqual(["both"]);
    expect(reservedCteNames('WITH x AS (SELECT 1),\n  "both" AS (SELECT 2)\nSELECT * FROM "both" b')).toEqual([]);
    expect(reservedCteNames("WITH RECURSIVE order AS (SELECT 1) SELECT 1")).toEqual(["order"]);
    expect(reservedCteNames("WITH orders(id) AS MATERIALIZED (SELECT 1) SELECT 1")).toEqual([]);
  });
  it("ignores the word in a comment or a string, which is where prose lives", () => {
    expect(reservedCteNames("-- both AS (\nWITH x AS (SELECT 'both AS (') SELECT 1")).toEqual([]);
    expect(reservedCteNames("/* , both AS ( */ WITH x AS (SELECT 1) SELECT 1")).toEqual([]);
  });
  it("catches a reserved alias but not a reserved word that merely follows the item", () => {
    expect(reservedFromAliases("SELECT * FROM t both")).toEqual(["both"]);
    expect(reservedFromAliases("SELECT * FROM t WHERE 1=1")).toEqual([]);
    expect(reservedFromAliases("SELECT * FROM t b JOIN u c ON b.id = c.id")).toEqual([]);
  });
});
