// @vitest-environment node
/**
 * THE WRITING ALLOWANCE'S SQL, IN A REAL POSTGRES (20261011160000).
 *
 * take_writing_tools takes one use of each named tool for an account, all or
 * none, and refuses with the reason and the UTC reset time; a spent month is
 * reported before a spent day. refund_writing_tools gives back uses taken in
 * the last fifteen minutes by that account only. The table and both functions
 * are closed to the client roles, starting from Supabase's default grants.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./helpers/agent-db";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const FILE = "20261011160000_the_writing_tools_are_counted_by_account_one_a_day_free_five_on_pro.sql";
const A = "4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21";
const B = "9b1e2d3c-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

let db: PGlite;

type Take = { allowed: boolean; reason?: string; tool?: string; limit?: number; resets_at?: string; use_ids?: string[] };
const take = async (user: string, tools: string[], perDay: number, perMonth: number | null, tier = "free"): Promise<Take> =>
  (await db.query<{ r: Take }>("SELECT public.take_writing_tools($1::uuid, $2::text[], $3, $4, $5) AS r", [user, tools, perDay, perMonth, tier])).rows[0].r;
const uses = async (user: string, tool?: string) =>
  Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.writing_tool_uses WHERE user_id = $1::uuid${tool ? " AND tool = $2" : ""}`, tool ? [user, tool] : [user])).rows[0].n);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
  `);
  await db.query("INSERT INTO auth.users (id) VALUES ($1), ($2)", [A, B]);
  await db.exec(migration(FILE));
  // Safe twice: the whole file again, self-check included.
  await db.exec(migration(FILE));
});

beforeEach(async () => {
  await db.exec("DELETE FROM public.writing_tool_uses");
});

describe("a free account: one of each tool a UTC day", () => {
  it("the first letter is allowed and the second is refused until the next UTC midnight", async () => {
    const first = await take(A, ["letter"], 1, null);
    expect(first.allowed).toBe(true);
    expect(first.use_ids).toHaveLength(1);
    const second = await take(A, ["letter"], 1, null);
    expect(second).toMatchObject({ allowed: false, reason: "daily_limit", tool: "letter", limit: 1 });
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    expect(new Date(second.resets_at!).getTime()).toBe(midnight.getTime());
  });

  it("each tool is its own day, and another account is its own allowance", async () => {
    expect((await take(A, ["letter"], 1, null)).allowed).toBe(true);
    expect((await take(A, ["resume"], 1, null)).allowed).toBe(true);
    expect((await take(A, ["prep"], 1, null)).allowed).toBe(true);
    expect((await take(B, ["letter"], 1, null)).allowed).toBe(true);
    expect(await uses(A)).toBe(3);
  });

  it("yesterday's use does not count today", async () => {
    await db.query("INSERT INTO public.writing_tool_uses (user_id, tool, tier, used_at) VALUES ($1, 'letter', 'free', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 minute')", [A]);
    expect((await take(A, ["letter"], 1, null)).allowed).toBe(true);
  });
});

describe("Pro: five a day and sixty a month", () => {
  it("five letters a day, the sixth refused", async () => {
    for (let i = 0; i < 5; i++) expect((await take(A, ["letter"], 5, 60, "pro")).allowed, `letter ${i + 1}`).toBe(true);
    expect(await take(A, ["letter"], 5, 60, "pro")).toMatchObject({ allowed: false, reason: "daily_limit", limit: 5 });
  });

  it("a spent month is reported before a spent day, with the first of next month", async () => {
    // Sixty uses earlier this month (the first day of the month, or today if that is today).
    await db.query(`INSERT INTO public.writing_tool_uses (user_id, tool, tier, used_at)
      SELECT $1::uuid, 'letter', 'pro', date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' FROM generate_series(1, 60)`, [A]);
    const r = await take(A, ["letter"], 5, 60, "pro");
    expect(r).toMatchObject({ allowed: false, reason: "monthly_limit", limit: 60 });
    const next = new Date();
    next.setUTCDate(1);
    next.setUTCHours(0, 0, 0, 0);
    next.setUTCMonth(next.getUTCMonth() + 1);
    expect(new Date(r.resets_at!).getTime()).toBe(next.getTime());
  });

  it("a package takes each tool or none", async () => {
    await take(A, ["letter"], 1, null);
    const r = await take(A, ["resume", "letter"], 1, null);
    expect(r).toMatchObject({ allowed: false, tool: "letter" });
    expect(await uses(A, "resume"), "a refused package took its résumé anyway").toBe(0);
  });
});

describe("giving a use back", () => {
  it("gives back the account's own recent use, and nobody else's", async () => {
    const r = await take(A, ["letter"], 1, null);
    const n0 = (await db.query<{ n: number }>("SELECT public.refund_writing_tools($1::uuid, $2::uuid[]) AS n", [B, r.use_ids])).rows[0].n;
    expect(n0, "another account gave this use back").toBe(0);
    const n1 = (await db.query<{ n: number }>("SELECT public.refund_writing_tools($1::uuid, $2::uuid[]) AS n", [A, r.use_ids])).rows[0].n;
    expect(n1).toBe(1);
    expect((await take(A, ["letter"], 1, null)).allowed).toBe(true);
  });

  it("an old use cannot be given back", async () => {
    const id = (await db.query<{ id: string }>("INSERT INTO public.writing_tool_uses (user_id, tool, tier, used_at) VALUES ($1, 'letter', 'free', now() - interval '1 hour') RETURNING id", [A])).rows[0].id;
    const n = (await db.query<{ n: number }>("SELECT public.refund_writing_tools($1::uuid, ARRAY[$2]::uuid[]) AS n", [A, id])).rows[0].n;
    expect(n).toBe(0);
  });
});

describe("what the function refuses outright", () => {
  for (const [label, sql] of [
    ["an unknown tool", "SELECT public.take_writing_tools(gen_random_uuid(), ARRAY['essay'], 1, NULL, 'free')"],
    ["a tool named twice", "SELECT public.take_writing_tools(gen_random_uuid(), ARRAY['letter','letter'], 1, NULL, 'free')"],
    ["no tools", "SELECT public.take_writing_tools(gen_random_uuid(), ARRAY[]::text[], 1, NULL, 'free')"],
    ["a daily figure out of bounds", "SELECT public.take_writing_tools(gen_random_uuid(), ARRAY['letter'], 1000, NULL, 'free')"],
    ["an unknown tier", "SELECT public.take_writing_tools(gen_random_uuid(), ARRAY['letter'], 1, NULL, 'gold')"],
  ] as const) {
    it(label, async () => {
      await expect(db.query(sql)).rejects.toThrow(/take_writing_tools/);
    });
  }
});

describe("closed to the client roles, from Supabase's default grants", () => {
  it("anon and authenticated hold nothing on the table and cannot run either function", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const r = await db.query<{ ok: boolean }>("SELECT has_table_privilege($1, 'public.writing_tool_uses', $2) AS ok", [role, priv]);
        expect(r.rows[0].ok, `${role} ${priv}`).toBe(false);
      }
      for (const fn of ["public.take_writing_tools(uuid, text[], integer, integer, text)", "public.refund_writing_tools(uuid, uuid[])"]) {
        const r = await db.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, fn]);
        expect(r.rows[0].ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});
