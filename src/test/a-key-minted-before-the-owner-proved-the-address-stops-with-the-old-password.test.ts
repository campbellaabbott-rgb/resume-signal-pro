// @vitest-environment node
/**
 * A KEY MINTED BEFORE THE OWNER PROVED THE ADDRESS STOPS WITH THE OLD
 * PASSWORD (S14X-228).
 *
 * WHAT WAS WRONG. Sign-ups confirm themselves, so a stranger can register
 * victim@example.com with a password, sign in, and mint an API or connector
 * key (agent-connect needs only a session). When the real owner later signs
 * in with an emailed code, the account guard clears the stranger's password
 * and ends every other session, and the key went on working: api_keys is
 * bound by user_id, and the guard never touched it.
 *
 * WHAT HOLDS NOW, run against migration 20261014110000 in a real Postgres
 * (pglite) that starts from Supabase's default grants, with an api_keys
 * stand-in holding the columns the guard writes: a sign-in the auth log
 * vouches for, on an account with a password, turns off every live key of
 * that account made before the sign-in, and names their prefixes in the
 * answer. A key made after it, another account's key and an account proven
 * at another address (S12-177) are untouched. A write that fails answers 503
 * and takes the claim and the proof back, so nothing stands half done.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PgSupabase } from "./helpers/pglite-supabase";
import { runMailboxGuard, type GuardAdmin, type GuardDeps, type RotateResult } from "../../supabase/functions/_shared/mailbox-guard";
import type { WebsiteSession, WebsiteUser } from "../../supabase/functions/_shared/website-session";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILE = readdirSync(DIR).find((f) => f.startsWith("20261014110000_"));
const MIGRATION = FILE ? readFileSync(resolve(DIR, FILE), "utf8") : "";

/** Supabase's own defaults, the GoTrue tables the migration reads, and the key table's columns. */
const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, encrypted_password varchar(255) DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE auth.identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider text NOT NULL, identity_data jsonb NOT NULL DEFAULT '{}'
  );
  CREATE TABLE auth.audit_log_entries (instance_id uuid, id uuid PRIMARY KEY, payload json, created_at timestamptz, ip_address varchar(64) NOT NULL DEFAULT '');
  CREATE TABLE public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
    name text NOT NULL DEFAULT 'k', owner_email text NOT NULL DEFAULT '', user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
  );
`;

/** PostgREST as the service role. */
class ServiceRoleDb extends PgSupabase {
  override async run(sql: string, params: unknown[] = []) {
    try {
      const rows = await this.db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE service_role");
        return (await tx.query<Record<string, unknown>>(sql, params)).rows;
      });
      return { rows, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { rows: [] as Record<string, unknown>[], error: { code: err.code, message: String(err.message ?? e) } };
    }
  }
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const uuid = () => crypto.randomUUID();

let pg: PGlite;
let db: ServiceRoleDb;
const rotations: string[] = [];

async function account(email: string, password?: string): Promise<string> {
  const id = uuid();
  await pg.query(`INSERT INTO auth.users (id, email, encrypted_password) VALUES ($1, $2, $3)`, [id, email, password ? `bcrypt:${password}` : ""]);
  await pg.query(`INSERT INTO auth.identities (user_id, provider, identity_data) VALUES ($1, 'email', $2::jsonb)`, [id, JSON.stringify({ sub: id, email })]);
  return id;
}

/** A code sign-in at `atMs`, logged as GoTrue v2.197.0 logs it, as the session the guard is handed. */
async function codeSignIn(userId: string, email: string, atMs: number): Promise<WebsiteSession> {
  await pg.query(`INSERT INTO auth.audit_log_entries (instance_id, id, payload, created_at) VALUES ($1, $2, $3::json, $4)`,
    [uuid(), uuid(), JSON.stringify({ actor_id: userId, actor_username: email, action: "login" }), new Date(atMs + 3).toISOString()]);
  const claims = { sub: userId, email, session_id: uuid(), amr: [{ method: "otp", timestamp: Math.floor(atMs / 1000) }], exp: Math.floor(Date.now() / 1000) + 3600 };
  const jwt = `${b64url({ alg: "HS256" })}.${b64url(claims)}.sig`;
  const user: WebsiteUser = { id: userId, email, identities: [{ provider: "email", identity_data: { email } }] };
  return { user, jwt, claims };
}

async function key(userId: string | null, prefix: string, createdMs: number, revokedMs?: number) {
  await pg.query(`INSERT INTO public.api_keys (key_hash, key_prefix, user_id, created_at, revoked_at) VALUES ($1, $2, $3, $4, $5)`,
    [`h-${prefix}`, prefix, userId, new Date(createdMs).toISOString(), revokedMs ? new Date(revokedMs).toISOString() : null]);
}
const keys = async () =>
  Object.fromEntries((await pg.query<{ key_prefix: string; revoked_at: string | null }>(`SELECT key_prefix, revoked_at FROM public.api_keys`)).rows
    .map((r) => [r.key_prefix, r.revoked_at ? new Date(r.revoked_at).getTime() : null]));

const deps = (): GuardDeps => ({
  admin: Object.assign(db, { auth: { admin: {
    updateUserById: async () => ({ error: null }),
    signOut: async () => ({ error: null }),
  } } }) as unknown as GuardAdmin,
  rotateAsSession: async (jwt: string, password: string): Promise<RotateResult> => {
    const sub = String(JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub);
    rotations.push(sub);
    await pg.query(`UPDATE auth.users SET encrypted_password = $2 WHERE id = $1`, [sub, `bcrypt:${password}`]);
    return { ok: true, status: 200 };
  },
});

beforeAll(async () => {
  expect(FILE, "migration 20261014110000 is missing").toBeTruthy();
  pg = new PGlite();
  await pg.exec(STAND_INS);
  await pg.exec(MIGRATION);
  db = new ServiceRoleDb(pg);
}, 180_000);
afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });
beforeEach(async () => {
  await pg.exec(`DELETE FROM public.api_keys; DELETE FROM public.account_mailbox_proofs; DELETE FROM public.account_password_clears; DELETE FROM auth.audit_log_entries; DELETE FROM auth.identities; DELETE FROM auth.users;`);
  await pg.exec(`GRANT UPDATE ON public.api_keys TO service_role`);
  rotations.length = 0;
});

describe("S14X-228: the keys go with the pre-proof password", () => {
  it("a key made before the owner's code sign-in is turned off and named; one made after it, a revoked one and another account's stay as they were", async () => {
    const at = Date.now() - 5_000;
    const id = await account("victim@example.com", "strangers-password");
    const other = await account("someone@example.com");
    await key(id, "rbk_live_strang", at - 10 * 60_000);
    await key(id, "rbk_live_oldrev", at - 20 * 60_000, at - 15 * 60_000);
    await key(id, "rbk_live_owners", Date.now() + 1_000);
    await key(other, "rbk_live_others", at - 10 * 60_000);
    const before = await keys();

    const r = await runMailboxGuard(deps(), await codeSignIn(id, "victim@example.com", at));

    expect(r).toEqual({ status: 200, body: { proven: true, passwordCleared: true, keysRevoked: ["rbk_live_strang"] } });
    const after = await keys();
    expect(after.rbk_live_strang, "the stranger's key still works after the owner proved the address").not.toBeNull();
    expect(after.rbk_live_owners).toBeNull();
    expect(after.rbk_live_others).toBeNull();
    expect(after.rbk_live_oldrev, "an already revoked key keeps the time it was revoked").toBe(before.rbk_live_oldrev);
    expect(rotations).toEqual([id]);
  });

  it("a key write that fails answers 503, takes back the claim and the proof, and rotates nothing; the retry finishes once", async () => {
    const at = Date.now() - 5_000;
    const id = await account("flaky@example.com", "strangers-2");
    await key(id, "rbk_live_flaky1", at - 60_000);
    const s = await codeSignIn(id, "flaky@example.com", at);
    await pg.exec(`REVOKE UPDATE ON public.api_keys FROM service_role`);

    const first = await runMailboxGuard(deps(), s);
    expect(first).toMatchObject({ status: 503, body: { proven: false, passwordCleared: false, reason: "keys_not_revoked" } });
    expect(rotations).toEqual([]);
    expect((await pg.query(`SELECT 1 FROM public.account_mailbox_proofs WHERE user_id = $1`, [id])).rows).toEqual([]);
    expect((await pg.query(`SELECT 1 FROM public.account_password_clears WHERE user_id = $1`, [id])).rows).toEqual([]);
    expect((await keys()).rbk_live_flaky1).toBeNull();

    await pg.exec(`GRANT UPDATE ON public.api_keys TO service_role`);
    const second = await runMailboxGuard(deps(), s);
    expect(second).toEqual({ status: 200, body: { proven: true, passwordCleared: true, keysRevoked: ["rbk_live_flaky1"] } });
    expect(rotations).toEqual([id]);
  });

  it("an account already proven at another address keeps its keys, as it keeps its password (S12-177)", async () => {
    const at = Date.now() - 5_000;
    const id = await account("moved@example.com", "owners-own");
    await pg.query(`INSERT INTO public.account_mailbox_proofs (user_id, email, method, amr_at) VALUES ($1, 'earlier@example.com', 'otp', $2)`, [id, new Date(at - 86_400_000).toISOString()]);
    await key(id, "rbk_live_owner1", at - 60_000);

    const r = await runMailboxGuard(deps(), await codeSignIn(id, "moved@example.com", at));

    expect(r).toEqual({ status: 200, body: { proven: true, passwordCleared: false } });
    expect((await keys()).rbk_live_owner1).toBeNull();
    expect(rotations).toEqual([]);
  });

  it("an account with no password has nothing a stranger could have used, and keeps its keys", async () => {
    const at = Date.now() - 5_000;
    const id = await account("nopw@example.com");
    await key(id, "rbk_live_nopw01", at - 60_000);
    expect(await runMailboxGuard(deps(), await codeSignIn(id, "nopw@example.com", at))).toEqual({ status: 200, body: { proven: true, passwordCleared: false } });
    expect((await keys()).rbk_live_nopw01).toBeNull();
  });
});
