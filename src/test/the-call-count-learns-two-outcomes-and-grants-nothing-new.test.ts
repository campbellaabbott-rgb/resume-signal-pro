// @vitest-environment node
/**
 * THE CALL COUNT LEARNS TWO OUTCOMES AND GRANTS NOTHING NEW (lane
 * fix/1121-connector-errors, item 2 as corrected to owner decision D3;
 * spec-3's migration).
 *
 * The connector now answers a search sent a name it does not take (counted
 * would_refuse: the count the later refusal is switched on from) and a call
 * whose name or value it read as another (counted corrected). Before this,
 * mcp_count_call stored both words as 'other'. 20261206130000 replaces the
 * counter and the owner's reader. RUN here in pglite started from Supabase's
 * own default grants (which give anon and authenticated EXECUTE on every new
 * function), twice, self-check included.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./helpers/agent-db";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";

const RATE = "20260915100000_a_shared_egress_makes_a_per_address_bucket_a_global_one_so_both_exist.sql";
const CALLS = "20261011101000_every_connector_call_is_counted_by_host_and_outcome_and_never_by_who.sql";
const THIS = "20261206130000_a_call_count_names_a_corrected_or_refusable_search.sql";
const COUNT = "public.mcp_count_call(text, text, text, text)";
const REPORT = "public.mcp_connector_report(integer)";

const STAND_INS = `
  CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_prefix text, tier text, daily_quota integer, revoked_at timestamptz);
  CREATE TABLE public.api_usage (key_id uuid, day date, endpoint text, calls integer);
`;

async function boot(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_DEFAULTS);
  await db.exec(migration(RATE));
  await db.exec(STAND_INS);
  await db.exec(migration(CALLS));
  return db;
}
const can = async (db: PGlite, role: string, sig: string) =>
  (await db.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig])).rows[0].ok;

let db: PGlite;
beforeAll(async () => {
  db = await boot();
  await db.exec(migration(THIS));
  await db.exec(migration(THIS));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("who may run them: the service role only, from Supabase's default grants", () => {
  it("anon and authenticated cannot execute the counter or the reader; the service role can", async () => {
    for (const sig of [COUNT, REPORT]) {
      for (const role of ["anon", "authenticated"]) expect(await can(db, role, sig), `${role} ${sig}`).toBe(false);
      expect(await can(db, "service_role", sig), sig).toBe(true);
    }
  });

  it("the revoke is this file's own: with both functions dropped, this file alone closes them again", async () => {
    const fresh = await boot();
    try {
      await fresh.exec(`DROP FUNCTION ${REPORT}; DROP FUNCTION ${COUNT};`);
      await fresh.exec(migration(THIS));
      for (const sig of [COUNT, REPORT]) {
        for (const role of ["anon", "authenticated"]) expect(await can(fresh, role, sig), `${role} ${sig}`).toBe(false);
      }
    } finally {
      await fresh.close();
    }
  }, 120_000);

  it("TOOTH: the same file with its REVOKE lines taken out leaves anon able to run the counter, and its self-check refuses", async () => {
    const fresh = await boot();
    try {
      await fresh.exec(`DROP FUNCTION ${REPORT}; DROP FUNCTION ${COUNT};`);
      const unrevoked = migration(THIS).split("\n").filter((l) => !/^REVOKE ALL ON FUNCTION/.test(l)).join("\n");
      expect(unrevoked).not.toEqual(migration(THIS));
      await expect(fresh.exec(unrevoked)).rejects.toThrow(/self-check: a client role can run/);
    } finally {
      await fresh.close();
    }
  }, 120_000);

  it("a client role that tries to count is refused by the database", async () => {
    await db.exec("SET ROLE anon");
    try {
      await expect(db.query("SELECT public.mcp_count_call('claude', 'keyless', 'search_jobs', 'corrected')")).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});

describe("both outcomes are counted, as themselves and as answered calls", () => {
  it("corrected and would_refuse are stored as their own words; an unknown word is still 'other'", async () => {
    await db.exec("DELETE FROM public.mcp_calls_daily");
    await db.exec("SET ROLE service_role");
    try {
      for (const o of ["ok", "corrected", "corrected", "would_refuse", "argument", "refused_day", "not-a-word"]) {
        await db.query("SELECT public.mcp_count_call('claude', 'keyless', 'search_jobs', $1)", [o]);
      }
    } finally {
      await db.exec("RESET ROLE");
    }
    const rows = (await db.query<{ outcome: string; calls: number }>("SELECT outcome, calls FROM public.mcp_calls_daily ORDER BY outcome")).rows;
    expect(rows).toEqual([
      { outcome: "argument", calls: 1 },
      { outcome: "corrected", calls: 2 },
      { outcome: "ok", calls: 1 },
      { outcome: "other", calls: 1 },
      { outcome: "refused_day", calls: 1 },
      { outcome: "would_refuse", calls: 1 },
    ]);
  });

  it("the owner's reader shows both on their own rows and counts them with ok and cached as answered, never a refusal", async () => {
    await db.exec("SET ROLE service_role");
    try {
      await db.query("SELECT public.mcp_count_call('claude', 'keyless', 'search_jobs', 'cached')");
      const report = (await db.query<{ kind: string; tool: string; outcome: string | null; calls: string }>(
        "SELECT kind, tool, outcome, calls::text AS calls FROM public.mcp_connector_report(1) WHERE tool = 'search_jobs' ORDER BY kind, outcome",
      )).rows;
      const calls = Object.fromEntries(report.filter((r) => r.kind === "calls").map((r) => [r.outcome, Number(r.calls)]));
      expect(calls).toMatchObject({ corrected: 2, would_refuse: 1, ok: 1, cached: 1, argument: 1, refused_day: 1 });
      const answered = report.filter((r) => r.kind === "answered");
      // ok 1 + cached 1 + corrected 2 + would_refuse 1; argument, refused_day and other are not answers.
      expect(answered).toEqual([{ kind: "answered", tool: "search_jobs", outcome: null, calls: "5" }]);
    } finally {
      await db.exec("RESET ROLE");
    }
  });

  it("the reader still runs as its caller, and no self-check row is left behind", async () => {
    const definer = (await db.query<{ d: boolean }>(`SELECT prosecdef AS d FROM pg_proc WHERE oid = '${REPORT}'::regprocedure`)).rows[0].d;
    expect(definer).toBe(false);
    expect((await db.query("SELECT 1 FROM public.mcp_calls_daily WHERE tool LIKE 'zz%'")).rows).toEqual([]);
  });
});
