// @vitest-environment node
/**
 * A FIELD CURVE NO PAGE CALLS ANSWERS ONLY THE SERVICE ROLE (CW2-SC5).
 *
 * WHAT WAS WRONG. The field table's curve is a definer read over the whole
 * closure ledger with a five-minute header. No page has called it since
 * 20260928004823: every page that shows it, and /v1/stats, read its rows from
 * the hourly stats cache, which a definer function computes as its owner. It
 * stayed granted to anon and authenticated all the same (20261112192500 kept
 * the grant, and the census listed it allowlisted), so anyone holding the
 * publishable key could start a five-minute statement on the pooled
 * connections at will; a client that gives up does not cancel it.
 *
 * WHAT THIS HOLDS, in pglite started from Supabase's default grants, with the
 * curve and the cache function owned by a role that is not a superuser (a
 * superuser passes every privilege check, which would make the cache check
 * vacuous):
 *   1. control: as 20261112192500 left it, both client roles can call it;
 *   2. after 20261113101000 anon and authenticated are refused, service_role
 *      reads, PUBLIC holds nothing, and the hourly cache still computes it;
 *   3. the census re-issued in the same file names it nowhere, and the one it
 *      replaces would have reported it allowlisted but not callable;
 *   4. the re-issued census is 20261112191000's, letter for letter, less the
 *      one row;
 *   5. the file closes nothing when the signature is missing, and refuses to
 *      finish when the cache's owner would lose the curve;
 *   6. it runs twice to the same grants;
 *   7. no browser, worker or edge function file calls the curve in code, so
 *      the closure breaks no page.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { migFile } from "./helpers/fixed-clock-sql";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";
import { CLIENT_CALLABLE, CLOSED_AFTER_CENSUS } from "./helpers/client-callable-allowlist";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000 });

const FIX = "20261113101000_a_field_curve_no_page_calls_answers_only_the_service_role.sql";
const CENSUS_BEFORE = "20261112191000_trending_fields_read_only_boards_watched_through_both_weeks.sql";
const FN = "get_category_fill_curve";
const SIG = `public.${FN}(integer,integer)`;

/** The census definition a file issues, from its CREATE to its closing tag. */
const censusOf = (sql: string) => {
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.client_callable_census()");
  const end = sql.indexOf("$census$;", at);
  return at < 0 || end < 0 ? "" : sql.slice(at, end + "$census$;".length);
};

// The curve and the cache function as the live database holds them, each a
// stub with the live signature, both owned by one non-superuser role; the
// curve's grants exactly as 20261112192500 left them.
const schema = (opts: { curve?: boolean; cacheOwner?: string; publicGrant?: boolean } = {}) => `
  ${SUPABASE_DEFAULTS}
  CREATE ROLE curve_owner NOLOGIN;
  CREATE ROLE cache_owner NOLOGIN;
  GRANT USAGE ON SCHEMA public TO curve_owner, cache_owner;
  ${opts.curve === false ? "" : `
  CREATE FUNCTION public.${FN}(p_days int DEFAULT 90, p_min_n int DEFAULT 300)
    RETURNS TABLE (category text, n int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $$ SELECT 'sales'::text, p_days $$;
  ALTER FUNCTION public.${FN}(int, int) OWNER TO curve_owner;
  REVOKE ALL ON FUNCTION public.${FN}(int, int) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.${FN}(int, int) TO anon, authenticated, service_role;
  ${opts.publicGrant ? `GRANT EXECUTE ON FUNCTION public.${FN}(int, int) TO PUBLIC;` : ""}
  CREATE FUNCTION public.refresh_stats_cache() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public
    AS $$ SELECT count(*)::int FROM public.${FN}(90, 300) $$;
  ALTER FUNCTION public.refresh_stats_cache() OWNER TO ${opts.cacheOwner ?? "curve_owner"};
  REVOKE ALL ON FUNCTION public.refresh_stats_cache() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.refresh_stats_cache() TO service_role;`}
`;

async function db(opts?: Parameters<typeof schema>[0]): Promise<PGlite> {
  const d = new PGlite();
  await d.exec(schema(opts));
  return d;
}

/** "read" when the role can call the curve, else the error message. */
async function callAs(d: PGlite, role: string, sql = `SELECT * FROM public.${FN}(90, 300)`): Promise<string> {
  await d.exec(`SET ROLE ${role}`);
  try { await d.query(sql); return "read"; } catch (e) { return String((e as Error).message); } finally { await d.exec("RESET ROLE"); }
}

const census = async (d: PGlite) =>
  (await d.query<{ c: { allowlisted_not_callable: string[] } }>("SELECT public.client_callable_census() AS c")).rows[0].c;

const acl = async (d: PGlite) =>
  (await d.query<{ acl: string }>(`SELECT proacl::text AS acl FROM pg_proc WHERE oid = '${SIG}'::regprocedure`)).rows[0].acl;

describe("control: as 20261112192500 left it, the publishable key reaches the curve", () => {
  it("anon and authenticated both call it, and the census of 20261112191000 lists it open", async () => {
    const d = await db();
    expect(await callAs(d, "anon")).toBe("read");
    expect(await callAs(d, "authenticated")).toBe("read");
    expect(censusOf(migFile(CENSUS_BEFORE))).toContain(`'${SIG}'`);
  });
});

describe("after 20261113101000", () => {
  it("anon and authenticated are refused, service_role reads, and PUBLIC holds nothing", async () => {
    const d = await db();
    await d.exec(migFile(FIX));
    expect(await callAs(d, "anon")).toMatch(/permission denied for function get_category_fill_curve/);
    expect(await callAs(d, "authenticated")).toMatch(/permission denied for function get_category_fill_curve/);
    expect(await callAs(d, "service_role")).toBe("read");
    expect(await acl(d), "a grant to PUBLIC is an entry with no role before the equals sign").not.toMatch(/(^|[{,])=X/);
  });

  it("the hourly cache still computes the curve, as its function's owner", async () => {
    const d = await db();
    await d.exec(migFile(FIX));
    expect(await callAs(d, "service_role", "SELECT public.refresh_stats_cache()")).toBe("read");
    await d.exec("SET ROLE service_role");
    try {
      expect((await d.query<{ n: number }>("SELECT public.refresh_stats_cache() AS n")).rows[0].n, "the cache read no curve rows").toBe(1);
    } finally { await d.exec("RESET ROLE"); }
  });

  it("the census it re-issues names the curve nowhere, and the census it replaces would report it uncallable", async () => {
    const d = await db();
    await d.exec(migFile(FIX));
    const src = (await d.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = 'public.client_callable_census()'::regprocedure")).rows[0].s;
    expect(src).not.toContain(FN);
    expect((await census(d)).allowlisted_not_callable).not.toContain(SIG);
    // The same closed curve under the census 20261112191000 issued: the row it
    // keeps for a function closed on purpose reads as a page that broke.
    await d.exec(censusOf(migFile(CENSUS_BEFORE)));
    expect((await census(d)).allowlisted_not_callable).toContain(SIG);
  });

  it("the census is 20261112191000's letter for letter, less the one row", () => {
    const before = censusOf(migFile(CENSUS_BEFORE));
    const after = censusOf(migFile(FIX));
    expect(before).not.toBe("");
    expect(after).not.toBe(before);
    expect(before.split("\n").filter((l) => !l.includes(`'${SIG}'`)).join("\n")).toBe(after);
  });

  it("closes nothing when the signature is missing", async () => {
    const d = await db({ curve: false });
    await expect(d.exec(migFile(FIX))).rejects.toThrow(/is not in the catalogue; nothing was closed/);
    const made = (await d.query<{ f: string | null }>("SELECT to_regprocedure('public.client_callable_census()')::text AS f")).rows[0].f;
    expect(made, "the census was re-issued although the file stopped").toBeNull();
  });

  it("refuses to finish when the cache's owner held the curve only through PUBLIC", async () => {
    const d = await db({ cacheOwner: "cache_owner", publicGrant: true });
    expect(await callAs(d, "service_role", "SELECT public.refresh_stats_cache()"), "the control: the cache computes before the file").toBe("read");
    await expect(d.exec(migFile(FIX))).rejects.toThrow(/owner of refresh_stats_cache cannot execute get_category_fill_curve/);
  });

  it("runs twice to the same grants", async () => {
    const d = await db();
    await d.exec(migFile(FIX));
    const once = await acl(d);
    await d.exec(migFile(FIX));
    expect(await acl(d)).toBe(once);
  });
});

describe("the allowlist moved the row, and no client file calls the curve", () => {
  it("the census allowlist no longer holds the curve, and the closed-after list does, closed by this file", () => {
    expect(CLIENT_CALLABLE.map((a) => a.sig)).not.toContain(SIG);
    const row = CLOSED_AFTER_CENSUS.find((c) => c.was.sig === SIG);
    expect(row?.closedIn).toBe(FIX.slice(0, 14));
  });

  it("no browser, worker or edge function file calls it in code", () => {
    const ROOT = resolve(__dirname, "../..");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { if (!["node_modules", "dist", "test", "__tests__"].includes(e)) walk(p, out); }
        else if (/\.(ts|tsx|js|mjs)$/.test(e) && !/\.test\./.test(e) && !p.endsWith("integrations/supabase/types.ts")) out.push(p);
      }
      return out;
    };
    const files = [...walk(resolve(ROOT, "src")), ...walk(resolve(ROOT, "worker/src")), ...walk(resolve(ROOT, "supabase/functions"))];
    expect(files.length).toBeGreaterThan(300);
    const call = new RegExp(`\\.rpc\\(\\s*["'\`]${FN}["'\`]|rest/v1/rpc/${FN}\\b`);
    const callers = files.filter((p) => call.test(codeOf(readFileSync(p, "utf8")))).map((p) => p.slice(ROOT.length + 1));
    expect(callers, "these files would get 42501 once the curve is closed").toEqual([]);
    // Teeth: the same scan finds a call written the way the pages write one.
    expect(call.test(codeOf(`await supabase.rpc("${FN}", { p_days: 90 });`))).toBe(true);
  });
});
