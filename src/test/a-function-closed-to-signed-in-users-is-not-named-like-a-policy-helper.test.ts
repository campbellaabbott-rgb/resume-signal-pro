// @vitest-environment node
/**
 * Round A's deploy stopped at its fifteenth migration on 2026-11-18. Lovable's
 * tool refused the file whole: it took EXECUTE away from the authenticated
 * role on a function whose name opened with "is_", and the tool reads a name
 * like that as a row-security policy helper, which signed-in users must be
 * able to run. No policy named the function; the tool refused it anyway, and
 * every file after it waited.
 *
 * The rule the tool applies is read here from the one refusal it gave: a
 * REVOKE that names authenticated, on a function whose name opens with is_,
 * has_ or can_. Every migration in the directory is read (no file before the
 * refused one did it, so none is exempt), in code only: comments and quoted
 * strings are set aside in one pass, so a statement quoted in prose or a
 * NOTICE is not judged. A REVOKE built at run time (EXECUTE format(...)) is a
 * string and is not read; no migration does that to a function's grants.
 *
 * The fix is the name, never the grant: the helper stays closed to client
 * roles and is called by name, so rename it (20261112170000's is now
 * scan_industry_known).
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIG = resolve(__dirname, "../../supabase/migrations");

/** SQL with its comments and quoted strings set aside, read left to right in one pass. */
function codeOnly(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (t) => (t.startsWith("'") ? "''" : " "));
}

const HELPER_SHAPED = /^(?:is|has|can)_/i;

/** The function names a REVOKE closes to authenticated whose names read like a policy helper. */
export function helperShapedRevokes(sql: string): string[] {
  const out: string[] = [];
  for (const stmt of codeOnly(sql).split(";")) {
    const m = /\bREVOKE\b[\s\S]*?\bON\s+FUNCTIONS?\s+([\s\S]*?)\bFROM\b([\s\S]*)$/i.exec(stmt);
    if (!m || !/\bauthenticated\b/i.test(m[2])) continue;
    const targets = m[1].replace(/\([^()]*\)/g, "");
    for (const t of targets.split(",")) {
      const name = t.trim().replace(/^"?public"?\./i, "").replace(/"/g, "");
      if (HELPER_SHAPED.test(name)) out.push(name);
    }
  }
  return out;
}

describe("a REVOKE from authenticated never names a function shaped like a policy helper", () => {
  it("reads the statement Lovable refused, and leaves what it did not", () => {
    expect(helperShapedRevokes("REVOKE ALL ON FUNCTION public.is_x(text) FROM PUBLIC, anon, authenticated;")).toEqual(["is_x"]);
    expect(helperShapedRevokes("revoke execute on function has_y(uuid, text) from authenticated;")).toEqual(["has_y"]);
    expect(helperShapedRevokes("REVOKE ALL ON FUNCTION public.a(text), public.can_b(int) FROM authenticated;")).toEqual(["can_b"]);
    expect(helperShapedRevokes("REVOKE ALL ON FUNCTION public.scan_industry_known(text) FROM PUBLIC, anon, authenticated;")).toEqual([]);
    expect(helperShapedRevokes("REVOKE ALL ON FUNCTION public.is_x(text) FROM PUBLIC, anon;")).toEqual([]);
    expect(helperShapedRevokes("GRANT EXECUTE ON FUNCTION public.is_x(text) TO authenticated;")).toEqual([]);
    expect(helperShapedRevokes("-- REVOKE ALL ON FUNCTION public.is_x(text) FROM authenticated;\nSELECT 1;")).toEqual([]);
    expect(helperShapedRevokes("RAISE NOTICE 'REVOKE ALL ON FUNCTION is_x(text) FROM authenticated';")).toEqual([]);
  });

  it("no migration does it", () => {
    const found: string[] = [];
    for (const f of readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort()) {
      for (const name of helperShapedRevokes(readFileSync(resolve(MIG, f), "utf8"))) found.push(`${f}: ${name}`);
    }
    expect(found).toEqual([]);
  });
});
