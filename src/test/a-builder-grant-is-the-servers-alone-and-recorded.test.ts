// @vitest-environment node
/**
 * A BUILDER GRANT IS THE SERVER'S ALONE, AND RECORDED (API4 W1, lane A4;
 * migration 20261206120000).
 *
 * WHAT HAPPENED. The planned Builder card ($49: 5,000 calls a day and 120 a
 * minute) has no checkout. Billing is built only after someone asks in
 * writing (src/config/builder-plan.ts), and the recommended answer to OD-A8
 * is a 30-day free grant per written request, counted as the price test. A
 * key's limits are its own api_keys row, which api_key_check reads on every
 * keyed call, so until now the only way to grant Builder was a hand-typed
 * UPDATE: it recorded nobody, no date and no reason, never ended, could not
 * be taken back cleanly and could not be counted.
 *
 * THE PROPERTY. Run, not read: the file is applied twice to pglite started
 * from Supabase's default grants, and the calls are served by the live
 * api_key_check (the last migration that defines it).
 *   - anon and authenticated can neither execute api_key_grant_tier nor read
 *     or write api_tier_grants. The service role runs the grant and reads the
 *     record, and cannot write the record except through the function;
 *   - a grant moves a free key to the card's limits and records who ran it,
 *     when, why, the limits it replaced, and an expiry 30 days out;
 *   - a grant expires. The first allowed call past the expiry closes it and
 *     the next call runs on the old limits; a grant on a key that made no
 *     call is closed by the next grant call;
 *   - a revoke puts the old limits back and is recorded beside the grant,
 *     which is kept;
 *   - every refusal changes nothing, and a key with no grant answers every
 *     call exactly as it did before the file applied;
 *   - the file replaces no function an earlier migration defines, and its
 *     Builder numbers are the card's.
 *
 * TEETH. Each wall is removed in turn from a copy of the file. With the
 * file's self-check kept, the copy refuses to apply. With the self-check gone
 * too, the checks above fail: anon reads the record, anon grants itself
 * Builder, and an expired grant keeps serving Builder.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";
import { definitionOf } from "./helpers/fixed-clock-sql";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "supabase/migrations");
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const FILE = ALL.find((f) => f.startsWith("20261206120000_"));
if (!FILE) throw new Error("migration 20261206120000 is missing");
const MIGRATION = read(FILE);

/** Line-leading comments dropped: what the database runs. */
const codeOf = (sql: string) => sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const CODE = codeOf(MIGRATION);

/** The live api_key_check: the last migration that defines it. */
const CHECK_FILES = ALL.filter((f) => read(f).includes("FUNCTION public.api_key_check("));
const CHECK_DEF = definitionOf(read(CHECK_FILES[CHECK_FILES.length - 1]), "api_key_check");

/** The Builder card's numbers, as public-api states them. */
const PUBLIC_API = readFileSync(resolve(ROOT, "supabase/functions/public-api/index.ts"), "utf8");
const CARD = /const BUILDER_PROPOSED = \{ perDay: (\d+), perMinute: (\d+) \}/.exec(PUBLIC_API);
const BUILDER = { perDay: Number(CARD?.[1]), perMinute: Number(CARD?.[2]) };

/** One integer constant of the grant function, or null when the file does not spell it. */
const constant = (name: string, code = CODE): number | null => {
  const m = new RegExp(`\\b${name} constant integer := (\\d+);`).exec(code);
  return m ? Number(m[1]) : null;
};

/** Every public function a migration defines, by name. */
const definedFunctions = (sql: string): Set<string> =>
  new Set([...codeOf(sql).matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi)].map((m) => m[1].toLowerCase()));

/** The walls, exactly as the file writes them, and its closing self-check. */
const TABLE_REVOKE = "REVOKE ALL ON TABLE public.api_tier_grants FROM PUBLIC, anon, authenticated, service_role;";
const FN_REVOKE = "REVOKE ALL ON FUNCTION public.api_key_grant_tier(uuid, text, text) FROM PUBLIC, anon, authenticated;";
const TRIGGER = /CREATE TRIGGER api_keys_tier_grant_lapse[^;]*;/;
const SELF_CHECK_AT = MIGRATION.lastIndexOf("\nDO $$");
const WITHOUT_SELF_CHECK = MIGRATION.slice(0, SELF_CHECK_AT);
const without = (sql: string, wall: string | RegExp): string => {
  const out = typeof wall === "string" ? sql.split(wall).join("") : sql.replace(wall, "");
  if (out === sql) throw new Error(`${String(wall)} is not in the file, so removing it proves nothing`);
  return out;
};

/** api_keys, its counters and the pass table, shaped as api_key_check reads them live. */
const STAND_INS = `
  CREATE TABLE public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
    name text NOT NULL, owner_email text, tier text NOT NULL DEFAULT 'trial',
    rate_per_min integer NOT NULL DEFAULT 60, daily_quota integer NOT NULL DEFAULT 1000,
    created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz,
    notes text, user_id uuid);
  ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
  CREATE TABLE public.api_rate (key_id uuid NOT NULL, minute timestamptz NOT NULL, calls integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key_id, minute));
  CREATE TABLE public.api_quota (key_id uuid NOT NULL, day date NOT NULL, calls integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key_id, day));
  CREATE TABLE public.api_usage (key_id uuid NOT NULL, day date NOT NULL, endpoint text NOT NULL,
    calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day, endpoint));
  CREATE TABLE public.agent_passes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    session_hours integer NOT NULL DEFAULT 6, applications_total integer NOT NULL DEFAULT 10,
    applications_used integer NOT NULL DEFAULT 0, rate_per_min integer NOT NULL DEFAULT 60,
    daily_quota integer NOT NULL DEFAULT 5000, shelf_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
    activated_at timestamptz, expires_at timestamptz, closed_at timestamptz, close_reason text);
`;

const open: PGlite[] = [];
async function database(...files: string[]): Promise<PGlite> {
  const pg = new PGlite();
  open.push(pg);
  await pg.exec(SUPABASE_DEFAULTS + STAND_INS);
  await pg.exec(CHECK_DEF);
  for (const f of files) await pg.exec(f);
  return pg;
}
afterAll(async () => {
  for (const pg of open) {
    try { await pg.close(); } catch { /* best effort */ }
  }
});

async function as<T>(pg: PGlite, role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await pg.exec(`SET ROLE ${role}`);
  try {
    return (await pg.query<T>(sql, params)).rows;
  } finally {
    await pg.exec("RESET ROLE");
  }
}

type Out = {
  ok: boolean; reason: string; grant_id?: string; key_tier?: string; rate_per_min?: number;
  daily_quota?: number; expires_at?: string; restored?: boolean; lapsed?: number;
};
const grant = async (pg: PGlite, keyId: string, tier: string | null, note: string | null, role = "service_role") =>
  (await as<{ out: Out }>(pg, role, "SELECT public.api_key_grant_tier($1::uuid, $2, $3) AS out", [keyId, tier, note]))[0].out;

type Decision = {
  is_allowed: boolean; deny_reason: string | null; key_tier: string | null;
  rate_limit: number; rate_used: number; quota_limit: number; quota_used: number;
};
const check = async (pg: PGlite, hash: string) =>
  (await as<Decision>(pg, "service_role",
    "SELECT is_allowed, deny_reason, key_tier, rate_limit, rate_used, quota_limit, quota_used FROM public.api_key_check($1, '/v1/jobs')",
    [hash]))[0];

let serial = 0;
async function newKey(pg: PGlite, over: { tier?: string; rate?: number; quota?: number; revoked?: boolean; hash?: string } = {}) {
  serial += 1;
  const hash = over.hash ?? `hash-${serial}`;
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, rate_per_min, daily_quota, revoked_at)
     VALUES ($1, $2, 'k', $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() END) RETURNING id`,
    [hash, `rb_live_${serial}`, `k${serial}@example.invalid`, over.tier ?? "free", over.rate ?? 60, over.quota ?? 1000, over.revoked ?? false]);
  return { id: rows[0].id, hash };
}
const keyRow = async (pg: PGlite, id: string) =>
  (await pg.query<{ tier: string; rate_per_min: number; daily_quota: number }>(
    "SELECT tier, rate_per_min, daily_quota FROM public.api_keys WHERE id = $1", [id])).rows[0];

type GrantRow = {
  id: string; key_id: string; tier: string; rate_per_min: number; daily_quota: number;
  prior_tier: string; prior_rate_per_min: number; prior_daily_quota: number; note: string; granted_by: string;
  granted_at: Date; expires_at: Date; ended_at: Date | null; end_reason: string | null; ended_by: string | null;
  end_note: string | null; restored: boolean | null;
};
const grantsOf = async (pg: PGlite, keyId: string) =>
  (await pg.query<GrantRow>("SELECT * FROM public.api_tier_grants WHERE key_id = $1 ORDER BY granted_at, id", [keyId])).rows;
/** Thirty-one days pass: the open grant on this key is past its expiry. */
const pastExpiry = (pg: PGlite, keyId: string) =>
  pg.query(`UPDATE public.api_tier_grants SET granted_at = now() - interval '31 days', expires_at = now() - interval '1 minute'
             WHERE key_id = $1 AND ended_at IS NULL`, [keyId]);

const STRANGER_INSERT = `INSERT INTO public.api_tier_grants (key_id, tier, rate_per_min, daily_quota, prior_tier,
  prior_rate_per_min, prior_daily_quota, note, granted_by, expires_at)
  VALUES ($1, 'builder', 120, 5000, 'free', 60, 1000, 'x', 'x', now() + interval '1 day')`;

describe(`${FILE}: the file itself`, () => {
  it("opens with Lovable's review line and stays well under the size the runner takes", () => {
    const [first, second] = MIGRATION.split("\n");
    expect(first).toMatch(/^-- lovable-cron-fallback-reviewed: no cron; \S/);
    expect(second).toBe("--");
    expect(Buffer.byteLength(MIGRATION)).toBeLessThan(70_000);
  });

  it("defines two functions of its own and replaces none that an earlier migration defines", () => {
    const earlier = new Set(ALL.filter((f) => f < FILE).flatMap((f) => [...definedFunctions(read(f))]));
    // The reader sees the live functions this file must not replace.
    expect(earlier.has("api_key_check")).toBe(true);
    expect(earlier.has("api_key_issue_agent")).toBe(true);
    const mine = [...definedFunctions(MIGRATION)].sort();
    expect(mine).toEqual(["api_key_grant_tier", "api_tier_grant_lapse"]);
    expect(mine.filter((f) => earlier.has(f))).toEqual([]);
  });

  it("grants the Builder card's numbers for thirty days", () => {
    expect(CARD, "public-api/index.ts no longer spells BUILDER_PROPOSED: point this guard at the card's numbers").not.toBeNull();
    expect({ perDay: constant("c_builder_quota"), perMinute: constant("c_builder_rate") }).toEqual(BUILDER);
    expect(constant("c_grant_days")).toBe(30);
  });

  it("TEETH: the constant reader finds nothing in a file that does not spell the constant", () => {
    expect(constant("c_builder_rate", CODE.replace("c_builder_rate constant", "c_rate constant"))).toBeNull();
  });

  it("writes each wall once, and ends with its self-check", () => {
    expect(MIGRATION.split(TABLE_REVOKE)).toHaveLength(2);
    expect(MIGRATION.split(FN_REVOKE)).toHaveLength(2);
    expect(MIGRATION.match(new RegExp(TRIGGER.source, "g"))).toHaveLength(1);
    expect(MIGRATION.slice(SELF_CHECK_AT)).toContain("builder-grant-selfcheck-rollback");
  });
});

describe(`${FILE}, applied twice from Supabase's default grants`, () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await database(MIGRATION, MIGRATION);
  });

  it("anon and authenticated can neither run the grant nor read or write its record", async () => {
    const key = await newKey(pg);
    for (const role of ["anon", "authenticated"]) {
      await expect(grant(pg, key.id, "builder", "a stranger", role), role).rejects.toThrow(/permission denied/);
      await expect(as(pg, role, "SELECT * FROM public.api_tier_grants"), role).rejects.toThrow(/permission denied/);
      await expect(as(pg, role, STRANGER_INSERT, [key.id]), role).rejects.toThrow(/permission denied/);
      await expect(as(pg, role, "UPDATE public.api_tier_grants SET note = 'x'"), role).rejects.toThrow(/permission denied/);
      await expect(as(pg, role, "DELETE FROM public.api_tier_grants"), role).rejects.toThrow(/permission denied/);
    }
    expect(await keyRow(pg, key.id)).toEqual({ tier: "free", rate_per_min: 60, daily_quota: 1000 });
    expect(await grantsOf(pg, key.id)).toEqual([]);
  });

  it("the catalogue agrees: no client role holds the table or either function", async () => {
    const { rows } = await pg.query(`
      SELECT r AS role,
             has_table_privilege(r, 'public.api_tier_grants', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS tbl,
             has_function_privilege(r, 'public.api_key_grant_tier(uuid,text,text)', 'EXECUTE') AS grant_fn,
             has_function_privilege(r, 'public.api_tier_grant_lapse()', 'EXECUTE') AS lapse_fn
        FROM unnest(ARRAY['anon', 'authenticated']) AS r`);
    expect(rows).toEqual([
      { role: "anon", tbl: false, grant_fn: false, lapse_fn: false },
      { role: "authenticated", tbl: false, grant_fn: false, lapse_fn: false },
    ]);
    const rls = await pg.query<{ on: boolean; policies: number }>(`
      SELECT c.relrowsecurity AS on, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c WHERE c.oid = 'public.api_tier_grants'::regclass`);
    expect(rls.rows[0]).toEqual({ on: true, policies: 0 });
  });

  it("the service role runs the grant and reads the record, and writes the record only through the function", async () => {
    const key = await newKey(pg);
    expect((await grant(pg, key.id, "builder", "written request by email; price test")).ok).toBe(true);
    expect(await as(pg, "service_role", "SELECT key_id FROM public.api_tier_grants WHERE key_id = $1", [key.id])).toHaveLength(1);
    await expect(as(pg, "service_role", "UPDATE public.api_tier_grants SET note = 'rewritten' WHERE key_id = $1", [key.id]))
      .rejects.toThrow(/permission denied/);
    await expect(as(pg, "service_role", "DELETE FROM public.api_tier_grants WHERE key_id = $1", [key.id]))
      .rejects.toThrow(/permission denied/);
    await expect(as(pg, "service_role", STRANGER_INSERT, [key.id])).rejects.toThrow(/permission denied/);
    expect((await grantsOf(pg, key.id))[0].note).toBe("written request by email; price test");
  });

  it("a grant moves a free key to the card's limits and records who, when, why and what it replaced", async () => {
    const key = await newKey(pg);
    expect(await check(pg, key.hash)).toMatchObject({ is_allowed: true, key_tier: "free", rate_limit: 60, quota_limit: 1000 });

    const out = await grant(pg, key.id, "builder", "  written request 2026-12-08 by email; asked about $49  ");
    expect(out).toMatchObject({
      ok: true, reason: "granted", key_tier: "builder",
      rate_per_min: BUILDER.perMinute, daily_quota: BUILDER.perDay, lapsed: 0,
    });

    const [g] = await grantsOf(pg, key.id);
    expect(g).toMatchObject({
      id: out.grant_id, tier: "builder", rate_per_min: BUILDER.perMinute, daily_quota: BUILDER.perDay,
      prior_tier: "free", prior_rate_per_min: 60, prior_daily_quota: 1000,
      note: "written request 2026-12-08 by email; asked about $49", granted_by: "service_role",
      ended_at: null, end_reason: null, ended_by: null, end_note: null, restored: null,
    });
    expect(Math.abs(Date.now() - new Date(g.granted_at).getTime())).toBeLessThan(60_000);
    expect(Math.round((new Date(g.expires_at).getTime() - new Date(g.granted_at).getTime()) / 86_400_000)).toBe(30);

    expect(await check(pg, key.hash)).toMatchObject({
      is_allowed: true, key_tier: "builder", rate_limit: BUILDER.perMinute, quota_limit: BUILDER.perDay,
    });
  });

  it("run from the SQL editor, with no role set, the record names the session's user", async () => {
    const key = await newKey(pg);
    const { rows } = await pg.query<{ out: Out }>(
      "SELECT public.api_key_grant_tier($1::uuid, 'builder', 'owner, from the SQL editor') AS out", [key.id]);
    expect(rows[0].out.ok).toBe(true);
    expect((await grantsOf(pg, key.id))[0].granted_by).toBe("postgres");
  });

  it("a grant never lowers a limit the key already had", async () => {
    const key = await newKey(pg, { rate: 600 });
    expect(await grant(pg, key.id, "builder", "price test")).toMatchObject({ ok: true, rate_per_min: 600, daily_quota: BUILDER.perDay });
  });

  it("a grant expires: the first allowed call past its expiry closes it, and the next call runs on the old limits", async () => {
    const key = await newKey(pg);
    await grant(pg, key.id, "builder", "price test");
    await pastExpiry(pg, key.id);

    const crossing = await check(pg, key.hash);
    expect(crossing).toMatchObject({ is_allowed: true, key_tier: "builder" });
    const [g] = await grantsOf(pg, key.id);
    expect(g).toMatchObject({ end_reason: "expired", ended_by: "expiry", restored: true });
    expect(g.ended_at).not.toBeNull();
    expect(await keyRow(pg, key.id)).toEqual({ tier: "free", rate_per_min: 60, daily_quota: 1000 });

    expect(await check(pg, key.hash)).toMatchObject({ is_allowed: true, key_tier: "free", rate_limit: 60, quota_limit: 1000 });
  });

  it("a grant on a key that made no call since its expiry is closed by the next grant call", async () => {
    const idle = await newKey(pg);
    const other = await newKey(pg);
    await grant(pg, idle.id, "builder", "price test");
    await pastExpiry(pg, idle.id);

    const out = await grant(pg, other.id, "builder", "price test, a second requester");
    expect(out.ok).toBe(true);
    expect(out.lapsed).toBeGreaterThanOrEqual(1);
    expect(await keyRow(pg, idle.id)).toEqual({ tier: "free", rate_per_min: 60, daily_quota: 1000 });
    expect((await grantsOf(pg, idle.id))[0]).toMatchObject({ end_reason: "expired", ended_by: "expiry", restored: true });
  });

  it("a revoke puts the old limits back and is recorded beside the grant, which is kept", async () => {
    const key = await newKey(pg, { rate: 90, quota: 1500 });
    await grant(pg, key.id, "builder", "written request 2026-12-09");

    const out = await grant(pg, key.id, "FREE", "the requester asked to stop");
    expect(out).toMatchObject({ ok: true, reason: "revoked", key_tier: "free", rate_per_min: 90, daily_quota: 1500, restored: true });
    expect(await keyRow(pg, key.id)).toEqual({ tier: "free", rate_per_min: 90, daily_quota: 1500 });
    const rows = await grantsOf(pg, key.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      note: "written request 2026-12-09", end_reason: "revoked", ended_by: "service_role",
      end_note: "the requester asked to stop", restored: true,
    });
    expect(await check(pg, key.hash)).toMatchObject({ key_tier: "free", rate_limit: 90, quota_limit: 1500 });

    // Nothing open is left to end, and asking again changes nothing.
    expect(await grant(pg, key.id, "free", "again")).toMatchObject({ ok: false, reason: "no_open_grant" });
    expect(await grantsOf(pg, key.id)).toEqual(rows);

    // A later grant is a second row; the first is still there.
    expect((await grant(pg, key.id, "builder", "came back with a new request")).ok).toBe(true);
    expect(await grantsOf(pg, key.id)).toHaveLength(2);
  });

  it("an end leaves a key that something else changed as it is, and says so", async () => {
    const key = await newKey(pg);
    await grant(pg, key.id, "builder", "price test");
    await pg.query("UPDATE public.api_keys SET daily_quota = 9000 WHERE id = $1", [key.id]);

    const out = await grant(pg, key.id, "free", "the requester asked to stop");
    expect(out).toMatchObject({ ok: true, reason: "revoked", restored: false, key_tier: "builder", daily_quota: 9000 });
    expect(await keyRow(pg, key.id)).toEqual({ tier: "builder", rate_per_min: BUILDER.perMinute, daily_quota: 9000 });
    expect((await grantsOf(pg, key.id))[0]).toMatchObject({ end_reason: "revoked", restored: false });
  });

  it("every refusal changes nothing", async () => {
    const free = await newKey(pg);
    const revoked = await newKey(pg, { revoked: true });
    const other = await newKey(pg, { tier: "enterprise", rate: 999, quota: 99_999 });
    await grant(pg, free.id, "builder", "the first grant");

    const keys = async () => (await pg.query("SELECT id, tier, rate_per_min, daily_quota, revoked_at FROM public.api_keys ORDER BY id")).rows;
    const grants = async () => (await pg.query("SELECT * FROM public.api_tier_grants ORDER BY id")).rows;
    const keysBefore = await keys();
    const grantsBefore = await grants();

    const cases: Array<[string, string | null, string | null, string]> = [
      ["00000000-0000-4000-8000-00000000dead", "builder", "no such key", "unknown_key"],
      [revoked.id, "builder", "a revoked key", "key_revoked"],
      [other.id, "builder", "a key on another tier", "not_free"],
      [free.id, "builder", "a second grant", "already_granted"],
      [other.id, "free", "nothing to revoke", "no_open_grant"],
      [free.id, "builder", "   ", "note_required"],
      [free.id, "builder", null, "note_required"],
      [free.id, "builder", "y".repeat(501), "note_too_long"],
      [free.id, "enterprise", "a tier it does not know", "unknown_tier"],
      [free.id, null, "no tier", "unknown_tier"],
    ];
    for (const [id, tier, note, reason] of cases) {
      expect(await grant(pg, id, tier, note), `${tier} / ${reason}`).toMatchObject({ ok: false, reason });
    }
    expect(await keys()).toEqual(keysBefore);
    expect(await grants()).toEqual(grantsBefore);
  });

  it("a key set to Builder by hand, with no grant, keeps its limits on every call", async () => {
    const key = await newKey(pg, { tier: "builder", rate: 120, quota: 5000 });
    for (let i = 0; i < 3; i += 1) {
      expect(await check(pg, key.hash)).toMatchObject({ is_allowed: true, key_tier: "builder", rate_limit: 120 });
    }
    expect(await keyRow(pg, key.id)).toEqual({ tier: "builder", rate_per_min: 120, daily_quota: 5000 });
  });

  it("the expiry trigger fires only on a Builder key's last-used stamp", async () => {
    const { rows } = await pg.query<{ def: string }>(`
      SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t
       WHERE t.tgrelid = 'public.api_keys'::regclass AND NOT t.tgisinternal`);
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/BEFORE UPDATE OF last_used_at ON public\.api_keys FOR EACH ROW WHEN \(\(old\.tier = 'builder'::text\)\)/);
  });
});

/** Waits out the last seconds of a minute, so a run of calls shares one minute bucket. */
async function freshMinute() {
  const s = new Date().getUTCSeconds();
  if (s >= 50) await new Promise((r) => setTimeout(r, (61 - s) * 1000));
}

describe("a key with no grant answers every call as it did before the file applied", () => {
  async function scenario(pg: PGlite, tag: string) {
    await freshMinute();
    const keys: Array<[string, { tier?: string; rate?: number; quota?: number; revoked?: boolean }]> = [
      ["free", {}],
      ["tight", { rate: 2 }],
      ["spent", { quota: 1 }],
      ["revoked", { revoked: true }],
      ["by-hand", { tier: "builder", rate: 120, quota: 5000 }],
    ];
    const calls: unknown[] = [];
    for (const [name, over] of keys) {
      const k = await newKey(pg, { ...over, hash: `${tag}-${name}` });
      for (let i = 0; i < 3; i += 1) calls.push([name, i, await check(pg, k.hash)]);
    }
    calls.push(["unknown", 0, await check(pg, `${tag}-nobody`)]);
    const rows = (await pg.query<{ key_hash: string }>(`
      SELECT key_hash, tier, rate_per_min, daily_quota, revoked_at IS NOT NULL AS revoked, last_used_at IS NOT NULL AS used
        FROM public.api_keys WHERE key_hash LIKE $1 ORDER BY key_hash`, [`${tag}-%`])).rows
      .map((r) => ({ ...r, key_hash: r.key_hash.slice(tag.length) }));
    return { calls, rows };
  }

  it("the same answers and the same key rows, before and after", async () => {
    const pg = await database();
    const before = await scenario(pg, "before");
    await pg.exec(MIGRATION);
    const after = await scenario(pg, "after");
    expect(after).toEqual(before);
    // The scenario reaches each refusal it means to compare.
    const reasons = (before.calls as Array<[string, number, Decision]>).map(([, , d]) => d.deny_reason);
    expect(reasons).toEqual(expect.arrayContaining(["rate_limited", "quota_exceeded", "revoked", "unknown_key"]));
  });
});

describe("TEETH: each wall, removed from a copy of the file", () => {
  it("with the self-check kept, a copy missing any wall refuses to apply; with only the self-check gone, the walls hold", async () => {
    const pg = await database();
    const refusals: Array<[string | RegExp, RegExp]> = [
      [TABLE_REVOKE, /api_tier_grants grants anon a privilege/],
      [FN_REVOKE, /api_key_grant_tier\(uuid,text,text\) is executable by a client role/],
      [TRIGGER, /the grant expiry trigger is missing from api_keys/],
    ];
    for (const [wall, message] of refusals) {
      await expect(pg.exec(without(MIGRATION, wall)), String(wall)).rejects.toThrow(message);
    }
    await pg.exec(WITHOUT_SELF_CHECK);
    const key = await newKey(pg);
    await expect(grant(pg, key.id, "builder", "a stranger", "anon")).rejects.toThrow(/permission denied/);
    await expect(as(pg, "anon", "SELECT * FROM public.api_tier_grants")).rejects.toThrow(/permission denied/);
    await grant(pg, key.id, "builder", "price test");
    await pastExpiry(pg, key.id);
    await check(pg, key.hash);
    expect(await check(pg, key.hash)).toMatchObject({ key_tier: "free" });
  });

  it("without the table revoke, anon reads the record (Supabase's default grant, which bare roles would hide)", async () => {
    const pg = await database(without(WITHOUT_SELF_CHECK, TABLE_REVOKE));
    await expect(as(pg, "anon", "SELECT * FROM public.api_tier_grants")).resolves.toEqual([]);
  });

  it("without the function revoke, anon grants itself Builder", async () => {
    const pg = await database(without(WITHOUT_SELF_CHECK, FN_REVOKE));
    const key = await newKey(pg);
    expect(await grant(pg, key.id, "builder", "a stranger", "anon")).toMatchObject({ ok: true, key_tier: "builder" });
    expect(await keyRow(pg, key.id)).toMatchObject({ tier: "builder" });
  });

  it("without the trigger, an expired grant keeps serving Builder", async () => {
    const pg = await database(without(WITHOUT_SELF_CHECK, TRIGGER));
    const key = await newKey(pg);
    await grant(pg, key.id, "builder", "price test");
    await pastExpiry(pg, key.id);
    await check(pg, key.hash);
    expect(await check(pg, key.hash)).toMatchObject({ key_tier: "builder", rate_limit: BUILDER.perMinute });
    expect((await grantsOf(pg, key.id))[0].ended_at).toBeNull();
  });
});
