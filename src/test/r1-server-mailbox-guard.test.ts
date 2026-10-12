// @vitest-environment node
//
// Node, not jsdom: auth-signed-in is bundled with esbuild (helpers/edge-harness.ts)
// and the migration runs in pglite.
/**
 * R1 SIGN-IN SERVER: A MAILBOX IS PROVEN BY THE CODE IT RECEIVED, AND AN
 * OLDER PASSWORD DOES NOT SURVIVE IT (plan items CP-006, CP-047, D15).
 *
 * Run, not read. Migration 20261014110000 is applied twice to a real Postgres
 * (pglite) that starts from Supabase's default grants (every new public table
 * and function open to anon and authenticated), beside stand-ins for GoTrue's
 * auth.users, auth.identities and auth.audit_log_entries. A small GoTrue
 * emulator writes the audit entries v2.197.0 writes (login on a code sign-in,
 * user_modified on an account change or an admin edit, user_updated_password
 * on the person's own password update) and ends sessions the way it does
 * (the person's own password update ends every OTHER session; an admin
 * password edit ends EVERY session). Then:
 *   - the guard (supabase/functions/_shared/mailbox-guard.ts) runs against that
 *     database through the PostgREST client the tests use, as service_role;
 *   - the shipped auth-signed-in handler runs end to end on the same database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PgSupabase, type Result } from "./helpers/pglite-supabase";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import {
  CHANGE_MARGIN_SECONDS,
  FRESH_SESSION_MS,
  newRotationSecret,
  newestSignIn,
  runMailboxGuard,
  type GuardAdmin,
  type GuardDeps,
  type RotateResult,
} from "../../supabase/functions/_shared/mailbox-guard";
import { hasMailboxProof, mailboxProofState } from "../../supabase/functions/_shared/mailbox-proof";
import type { WebsiteSession, WebsiteUser } from "../../supabase/functions/_shared/website-session";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILE = readdirSync(DIR).find((f) => f.startsWith("20261014110000_"));
const MIGRATION = FILE ? readFileSync(resolve(DIR, FILE), "utf8") : "";

/** Supabase's own defaults, then the GoTrue tables the migration reads. */
const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY, email text, encrypted_password varchar(255) DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE auth.identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider text NOT NULL, identity_data jsonb NOT NULL DEFAULT '{}'
  );
  CREATE TABLE auth.audit_log_entries (
    instance_id uuid, id uuid PRIMARY KEY, payload json, created_at timestamptz,
    ip_address varchar(64) NOT NULL DEFAULT ''
  );
`;

const ADMIN_ACTOR = "00000000-0000-0000-0000-000000000000";

/** PostgREST as the service role: every statement runs under SET LOCAL ROLE service_role. */
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

/**
 * GoTrue v2.197.0, as far as the guard can see it: users, sessions, the audit
 * entries each action writes, and which sessions each password change ends.
 */
class GoTrue {
  /** session id -> owner and whether it still works. */
  sessions = new Map<string, { userId: string; active: boolean }>();
  /** Every PUT /auth/v1/user the guard made. */
  sessionRotations: string[] = [];
  adminRotations: string[] = [];
  adminSignOuts: string[] = [];
  /** When set, PUT /auth/v1/user is refused with this code. */
  refuseSessionUpdate: string | null = null;

  constructor(private db: PGlite) {}

  async createUser(email: string, opts: { password?: string; identities?: Array<{ provider: string; data: Record<string, unknown> }> } = {}) {
    const id = uuid();
    await this.db.query(`INSERT INTO auth.users (id, email, encrypted_password) VALUES ($1, $2, $3)`, [id, email, opts.password ? `bcrypt:${opts.password}` : ""]);
    const identities = opts.identities ?? [{ provider: "email", data: { sub: id, email, email_verified: false } }];
    for (const i of identities) await this.db.query(`INSERT INTO auth.identities (user_id, provider, identity_data) VALUES ($1, $2, $3::jsonb)`, [id, i.provider, JSON.stringify(i.data)]);
    return id;
  }

  async audit(actorId: string, actorUsername: string, action: string, atMs: number, traits?: Record<string, unknown>) {
    const payload: Record<string, unknown> = { actor_id: actorId, actor_username: actorUsername, action, log_type: "x" };
    if (traits) payload.traits = traits;
    await this.db.query(`INSERT INTO auth.audit_log_entries (instance_id, id, payload, created_at) VALUES ($1, $2, $3::json, $4)`,
      [ADMIN_ACTOR, uuid(), JSON.stringify(payload), new Date(atMs).toISOString()]);
  }

  async emailOf(userId: string): Promise<string> {
    const { rows } = await this.db.query<{ email: string }>(`SELECT email FROM auth.users WHERE id = $1`, [userId]);
    return rows[0]?.email ?? "";
  }

  async passwordOf(userId: string): Promise<string> {
    const { rows } = await this.db.query<{ p: string }>(`SELECT coalesce(encrypted_password, '') AS p FROM auth.users WHERE id = $1`, [userId]);
    return rows[0]?.p ?? "";
  }

  /** What GET /auth/v1/user answers for the account. */
  async user(userId: string): Promise<WebsiteUser> {
    const { rows } = await this.db.query<{ email: string }>(`SELECT email FROM auth.users WHERE id = $1`, [userId]);
    const ids = await this.db.query<{ provider: string; identity_data: Record<string, unknown> }>(
      `SELECT provider, identity_data FROM auth.identities WHERE user_id = $1`, [userId]);
    return { id: userId, email: rows[0]?.email ?? null, identities: ids.rows };
  }

  token(userId: string, email: string, sessionId: string, amr: Array<{ method: string; timestamp: number }>, extra: Record<string, unknown> = {}) {
    const claims = { sub: userId, role: "authenticated", aud: "authenticated", email, session_id: sessionId, amr, exp: Math.floor(Date.now() / 1000) + 3600, ...extra };
    return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.sig`;
  }

  /**
   * A sign-in at `atMs` by `method`, logged as v2.197.0 logs it (login under
   * the account's address at that moment) unless `log` is false.
   */
  async signIn(userId: string, method: string, atMs: number, opts: { log?: boolean; extra?: Record<string, unknown> } = {}) {
    const sessionId = uuid();
    this.sessions.set(sessionId, { userId, active: true });
    const email = await this.emailOf(userId);
    if (opts.log !== false) await this.audit(userId, email, "login", atMs + 3);
    const jwt = this.token(userId, email, sessionId, [{ method, timestamp: Math.floor(atMs / 1000) }], opts.extra);
    return { sessionId, jwt };
  }

  session(user: WebsiteUser, jwt: string): WebsiteSession {
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()) as Record<string, unknown>;
    return { user, jwt, claims };
  }

  sessionIdOf(jwt: string): string {
    return String(JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).session_id);
  }

  /** PUT /auth/v1/user {password} as the session: ends every OTHER session (user.go UpdatePassword(tx, &session.ID)). */
  rotateAsSession = async (jwt: string, password: string): Promise<RotateResult> => {
    const sid = this.sessionIdOf(jwt);
    const s = this.sessions.get(sid);
    if (!s?.active) return { ok: false, status: 403, code: "session_not_found" };
    if (this.refuseSessionUpdate) return { ok: false, status: 400, code: this.refuseSessionUpdate };
    this.sessionRotations.push(sid);
    await this.setPassword(s.userId, password, Date.now());
    for (const [id, other] of this.sessions) if (other.userId === s.userId && id !== sid) other.active = false;
    return { ok: true, status: 200 };
  };

  /** The person sets a password themselves, in this session. */
  async setPassword(userId: string, password: string, atMs: number) {
    await this.db.query(`UPDATE auth.users SET encrypted_password = $2 WHERE id = $1`, [userId, `bcrypt:${password}`]);
    const email = await this.emailOf(userId);
    await this.audit(userId, email, "user_updated_password", atMs);
    await this.audit(userId, email, "user_modified", atMs + 1);
  }

  /** An address change confirmed at `atMs`: logged under the OLD address (verify.go:590), identity updated (ConfirmEmailChange). */
  async changeEmail(userId: string, next: string, atMs: number) {
    const old = await this.emailOf(userId);
    await this.audit(userId, old, "user_modified", atMs);
    await this.db.query(`UPDATE auth.users SET email = $2 WHERE id = $1`, [userId, next]);
    await this.db.query(`UPDATE auth.identities SET identity_data = identity_data || jsonb_build_object('email', $2::text) WHERE user_id = $1 AND provider = 'email'`, [userId, next]);
  }

  admin = {
    /** admin.go: user.UpdatePassword(tx, nil) ends EVERY session; logged as the admin, target in traits. */
    updateUserById: async (id: string, attrs: { password: string }) => {
      this.adminRotations.push(id);
      await this.db.query(`UPDATE auth.users SET encrypted_password = $2 WHERE id = $1`, [id, `bcrypt:${attrs.password}`]);
      await this.audit(ADMIN_ACTOR, "", "user_modified", Date.now(), { user_id: id });
      for (const s of this.sessions.values()) if (s.userId === id) s.active = false;
      return { error: null };
    },
    signOut: async (jwt: string, scope: "global" | "local" | "others" = "global") => {
      const sid = this.sessionIdOf(jwt);
      const s = this.sessions.get(sid);
      if (!s?.active) return { error: { message: "session_not_found" } };
      this.adminSignOuts.push(`${sid}:${scope}`);
      for (const [id, other] of this.sessions) if (other.userId === s.userId && (scope === "global" || id !== sid)) other.active = false;
      return { error: null };
    },
  };
}

let pg: PGlite;
let db: ServiceRoleDb;
let gotrue: GoTrue;

const deps = (over: Partial<GuardDeps> = {}): GuardDeps => ({
  admin: Object.assign(db, { auth: { ...db.auth, admin: { ...db.auth.admin, ...gotrue.admin } } }) as unknown as GuardAdmin,
  rotateAsSession: gotrue.rotateAsSession,
  ...over,
});

const proofs = async (userId: string) =>
  (await pg.query<{ email: string; method: string; password_cleared: boolean }>(`SELECT email, method, password_cleared FROM public.account_mailbox_proofs WHERE user_id = $1`, [userId])).rows;

beforeAll(async () => {
  expect(FILE, "migration 20261014110000 is missing").toBeTruthy();
  pg = new PGlite();
  await pg.exec(STAND_INS);
  // Twice: it must be safe to re-run, self-check included, with no account yet.
  await pg.exec(MIGRATION);
  await pg.exec(MIGRATION);
  db = new ServiceRoleDb(pg);
  gotrue = new GoTrue(pg);
}, 180_000);

afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

beforeEach(async () => {
  await pg.exec(`DELETE FROM public.account_mailbox_proofs; DELETE FROM public.account_password_clears; DELETE FROM auth.audit_log_entries; DELETE FROM auth.identities; DELETE FROM auth.users;`);
  gotrue.sessions.clear();
  gotrue.sessionRotations = [];
  gotrue.adminRotations = [];
  gotrue.adminSignOuts = [];
  gotrue.refuseSessionUpdate = null;
  db.rpcFaults.clear();
});

describe("migration 20261014110000, from Supabase's default grants", () => {
  it("runs a third time with an account present, so its rolled-back probe of the table's rules runs too", async () => {
    await gotrue.createUser("probe@example.com");
    await pg.exec(MIGRATION);
    expect((await pg.query(`SELECT count(*)::int AS n FROM public.account_mailbox_proofs`)).rows).toEqual([{ n: 0 }]);
  });

  it("no client role can read or write either table; service_role can, through row level security", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const t of ["account_mailbox_proofs", "account_password_clears"]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const { rows } = await pg.query<{ h: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS h`, [role, `public.${t}`, p]);
          expect(rows[0].h, `${role} ${p} ${t}`).toBe(false);
        }
      }
    }
    const id = await gotrue.createUser("a@example.com");
    const ins = await db.from("account_mailbox_proofs").insert({ user_id: id, email: "a@example.com", method: "otp", amr_at: new Date().toISOString() });
    expect((ins as Result).error).toBeNull();
    await expect(pg.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query(`SELECT * FROM public.account_mailbox_proofs`);
    })).rejects.toThrow(/permission denied/);
  });

  it("the three functions are definers with an empty search_path, refused to both client roles", async () => {
    for (const fn of ["auth_changed_since(uuid,timestamptz)", "auth_sign_in_addresses(uuid,timestamptz)", "auth_user_has_password(uuid)"]) {
      const { rows } = await pg.query<{ d: boolean; cfg: string[] | null; a: boolean; u: boolean; s: boolean }>(
        `SELECT p.prosecdef AS d, p.proconfig AS cfg,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS a,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS s
           FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${fn}`]);
      expect(rows[0], fn).toMatchObject({ d: true, a: false, u: false, s: true });
      expect(rows[0].cfg?.some((c) => /^search_path=(""|)$/.test(c)), `${fn}: ${JSON.stringify(rows[0].cfg)}`).toBe(true);
    }
    await expect(pg.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE anon");
      await tx.query(`SELECT public.auth_user_has_password(gen_random_uuid())`);
    })).rejects.toThrow(/permission denied/);
  });

  it("the table holds one row per account and lower-case address, and goes with the account", async () => {
    const id = await gotrue.createUser("b@example.com");
    const at = new Date().toISOString();
    expect(((await db.from("account_mailbox_proofs").insert({ user_id: id, email: "b@example.com", method: "otp", amr_at: at })) as Result).error).toBeNull();
    expect(((await db.from("account_mailbox_proofs").insert({ user_id: id, email: "b@example.com", method: "oauth", amr_at: at })) as Result).error?.code).toBe("23505");
    expect(((await db.from("account_mailbox_proofs").insert({ user_id: id, email: "B@example.com", method: "otp", amr_at: at })) as Result).error?.code).toBe("23514");
    expect(((await db.from("account_mailbox_proofs").insert({ user_id: id, email: "c@example.com", method: "password", amr_at: at })) as Result).error?.code).toBe("23514");
    expect(await hasMailboxProof(db, id, " B@Example.com ")).toBe(true);
    expect(await hasMailboxProof(db, id, "other@example.com")).toBe(false);
    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [id]);
    expect(await proofs(id)).toEqual([]);
  });

  it("hasMailboxProof fails closed: a missing table or a broken client is false, and the state reader says error", async () => {
    const broken = { from: () => { throw new Error("no client"); } };
    expect(await hasMailboxProof(broken, uuid(), "a@example.com")).toBe(false);
    expect(await mailboxProofState(broken, uuid(), "a@example.com")).toBe("error");
    const missing = new ServiceRoleDb(new PGlite());
    expect(await hasMailboxProof(missing, uuid(), "a@example.com")).toBe(false);
    expect(await mailboxProofState(missing, uuid(), "a@example.com")).toBe("error");
    expect(await hasMailboxProof(null, uuid(), "a@example.com")).toBe(false);
  });

  it("auth_changed_since reads the account's own changes and an admin's, from the time given, and fails closed on NULL", async () => {
    const id = await gotrue.createUser("c@example.com");
    const t = Date.now();
    const changed = async (sinceMs: number | null) =>
      (await pg.query<{ v: boolean }>(`SELECT public.auth_changed_since($1, $2) AS v`, [id, sinceMs == null ? null : new Date(sinceMs).toISOString()])).rows[0].v;
    await gotrue.audit(id, "c@example.com", "login", t);
    await gotrue.audit(id, "c@example.com", "user_recovery_requested", t + 10);
    await gotrue.audit(id, "c@example.com", "token_refreshed", t + 20);
    await gotrue.audit(uuid(), "x@example.com", "user_modified", t + 30);
    expect(await changed(t - 1000)).toBe(false);
    await gotrue.audit(ADMIN_ACTOR, "", "user_modified", t + 40, { user_id: id });
    expect(await changed(t)).toBe(true);
    expect(await changed(t + 41)).toBe(false);
    await gotrue.audit(id, "c@example.com", "user_updated_password", t + 50);
    expect(await changed(t + 45)).toBe(true);
    expect(await changed(null)).toBe(true);
  });

  it("auth_sign_in_addresses names this account's sign-ins within a minute, under the address they were made for", async () => {
    const id = await gotrue.createUser("d@example.com");
    const t = Date.now();
    const addrs = async (atMs: number) => (await pg.query<{ v: string[] }>(`SELECT public.auth_sign_in_addresses($1, $2) AS v`, [id, new Date(atMs).toISOString()])).rows[0].v;
    expect(await addrs(t)).toEqual([]);
    await gotrue.audit(id, "D@Example.com", "login", t + 500);
    await gotrue.audit(id, "d@example.com", "user_modified", t + 600);
    await gotrue.audit(uuid(), "x@example.com", "login", t + 700);
    expect(await addrs(t)).toEqual(["d@example.com"]);
    expect(await addrs(t + 61_000)).toEqual([]);
    await gotrue.audit(id, "old@example.com", "identity_linked", t + 900);
    expect((await addrs(t)).sort()).toEqual(["d@example.com", "old@example.com"]);
  });

  it("auth_user_has_password reads auth.users: an emailed-code account has none", async () => {
    const withPw = await gotrue.createUser("e@example.com", { password: "hunter22" });
    const without = await gotrue.createUser("f@example.com");
    const has = async (id: string) => (await pg.query<{ v: boolean }>(`SELECT public.auth_user_has_password($1) AS v`, [id])).rows[0].v;
    expect(await has(withPw)).toBe(true);
    expect(await has(without)).toBe(false);
    expect(await has(uuid())).toBe(false);
  });
});

describe("the guard", () => {
  const T = () => Date.now() - 5_000;

  it("a code sign-in on an account a stranger pre-registered with a password: the password is replaced once, other sessions end, and the proof is written once", async () => {
    const id = await gotrue.createUser("victim@example.com", { password: "strangers-password" });
    const stranger = await gotrue.signIn(id, "password", Date.now() - 60 * 60_000, { log: false });
    const { jwt } = await gotrue.signIn(id, "otp", T());
    const first = await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), jwt));
    expect(first).toEqual({ status: 200, body: { proven: true, passwordCleared: true } });
    expect(await gotrue.passwordOf(id)).not.toBe("bcrypt:strangers-password");
    expect(gotrue.sessions.get(stranger.sessionId)?.active).toBe(false);
    expect(gotrue.sessions.get(gotrue.sessionIdOf(jwt))?.active, "the person who proved the address stays signed in").toBe(true);
    expect(gotrue.sessionRotations).toHaveLength(1);
    expect(gotrue.adminRotations, "the admin API ends every session, this one included").toEqual([]);
    expect(gotrue.adminSignOuts).toEqual([`${gotrue.sessionIdOf(jwt)}:others`]);
    expect(await proofs(id)).toEqual([{ email: "victim@example.com", method: "otp", password_cleared: true }]);

    const again = await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), jwt));
    expect(again).toEqual({ status: 200, body: { proven: true, passwordCleared: false, reason: "already_proven" } });
    expect(gotrue.sessionRotations).toHaveLength(1);
    expect(await proofs(id)).toHaveLength(1);
  });

  it("an account with no password is proven and nothing is rotated", async () => {
    const id = await gotrue.createUser("nopw@example.com");
    const { jwt } = await gotrue.signIn(id, "otp", T());
    expect(await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), jwt))).toEqual({ status: 200, body: { proven: true, passwordCleared: false } });
    expect(gotrue.sessionRotations).toEqual([]);
  });

  it("two calls at once for one session rotate once and write one proof", async () => {
    const id = await gotrue.createUser("race@example.com", { password: "pw-before" });
    const { jwt } = await gotrue.signIn(id, "otp", T());
    const s = gotrue.session(await gotrue.user(id), jwt);
    const [a, b] = await Promise.all([runMailboxGuard(deps(), s), runMailboxGuard(deps(), s)]);
    expect(a.body.proven && b.body.proven).toBe(true);
    expect(gotrue.sessionRotations).toHaveLength(1);
    expect(await proofs(id)).toHaveLength(1);
  });

  it("the reset race: the password set after the guard answered survives every later call", async () => {
    const id = await gotrue.createUser("reset@example.com", { password: "forgotten" });
    const { jwt } = await gotrue.signIn(id, "otp", T());
    const s = () => gotrue.user(id).then((u) => gotrue.session(u, jwt));
    expect((await runMailboxGuard(deps(), await s())).body).toMatchObject({ proven: true, passwordCleared: true });
    await gotrue.setPassword(id, "chosen-after-reset", Date.now());
    expect((await runMailboxGuard(deps(), await s())).body).toMatchObject({ proven: true, passwordCleared: false });
    expect(await gotrue.passwordOf(id)).toBe("bcrypt:chosen-after-reset");
  });

  it("refuses the proof after an account change following the sign-in, clears the pre-proof password anyway, and never clears twice in a session", async () => {
    const id = await gotrue.createUser("changed@example.com", { password: "strangers-password" });
    const t = T() - 30_000;
    const { jwt } = await gotrue.signIn(id, "otp", t);
    // Another session edits the account after the sign-in (the stranger's script).
    await gotrue.audit(id, "changed@example.com", "user_modified", t + 10_000);
    const s = () => gotrue.user(id).then((u) => gotrue.session(u, jwt));
    const first = await runMailboxGuard(deps(), await s());
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ proven: false, passwordCleared: true, reason: "changed_since_sign_in" });
    expect(await proofs(id)).toEqual([]);
    expect(await gotrue.passwordOf(id), "the stranger's password does not survive the owner's code").not.toBe("bcrypt:strangers-password");
    // The person then sets a password in this session: a later call clears nothing.
    await gotrue.setPassword(id, "owners-own", Date.now());
    const second = await runMailboxGuard(deps(), await s());
    expect(second.body).toMatchObject({ proven: false, passwordCleared: false, reason: "changed_since_sign_in" });
    expect(await gotrue.passwordOf(id)).toBe("bcrypt:owners-own");
    expect(gotrue.sessionRotations).toHaveLength(1);
  });

  it("refuses a change written just BEFORE the session it minted (an address change's confirmation, amr otp, whole seconds)", async () => {
    const id = await gotrue.createUser("attacker@example.com");
    const sec = Math.floor((Date.now() - 4_000) / 1000);
    const atMs = sec * 1000 + 100;
    // verify.go:590 then issueRefreshToken(.., OTP): the change is logged under the
    // old address a few ms before the session; here it lands in the previous second.
    await gotrue.changeEmail(id, "victim@example.com", sec * 1000 - 400);
    await gotrue.audit(id, "victim@example.com", "login", atMs);
    const { jwt } = await gotrue.signIn(id, "otp", atMs, { log: false });
    const r = await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), jwt));
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("changed_since_sign_in");
    expect(CHANGE_MARGIN_SECONDS).toBeGreaterThanOrEqual(2);
    expect(await proofs(id)).toEqual([]);
  });

  it("refuses when the auth log holds the sign-in under another address, and when it holds no sign-in at all; neither clears a password", async () => {
    const id = await gotrue.createUser("now@example.com", { password: "kept-1" });
    const t = T();
    await gotrue.audit(id, "before@example.com", "login", t + 3);
    const a = await gotrue.signIn(id, "otp", t, { log: false });
    expect((await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), a.jwt))).body)
      .toMatchObject({ proven: false, passwordCleared: false, reason: "signed_in_for_another_address" });
    const id2 = await gotrue.createUser("unlogged@example.com", { password: "kept-2" });
    const b = await gotrue.signIn(id2, "otp", T(), { log: false });
    const r = await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id2), b.jwt));
    expect(r).toMatchObject({ status: 409, body: { proven: false, passwordCleared: false, reason: "audit_unconfirmed" } });
    expect(await proofs(id)).toEqual([]);
    expect(await proofs(id2)).toEqual([]);
    expect(await gotrue.passwordOf(id)).toBe("bcrypt:kept-1");
    expect(await gotrue.passwordOf(id2)).toBe("bcrypt:kept-2");
    expect(gotrue.sessionRotations).toEqual([]);
  });

  it("the session an address-change confirmation mints (amr otp, no sign-in entry) clears no password and proves nothing", async () => {
    const id = await gotrue.createUser("mover@example.com", { password: "my-own-password" });
    const t = T();
    // verify.go emailChangeVerify: user_modified under the old address, then a
    // session with amr otp and no login entry of its own.
    await gotrue.changeEmail(id, "moved@example.com", t - 2);
    const { jwt } = await gotrue.signIn(id, "otp", t, { log: false });
    const r = await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), jwt));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ proven: false, passwordCleared: false });
    expect(await gotrue.passwordOf(id)).toBe("bcrypt:my-own-password");
    expect(gotrue.sessionRotations).toEqual([]);
    expect(await proofs(id)).toEqual([]);
  });

  it("refuses a mismatched identity email, a token issued for another address, and an account with no email sign-in", async () => {
    const id = await gotrue.createUser("acct@example.com", { identities: [{ provider: "email", data: { email: "other@example.com" } }] });
    const a = await gotrue.signIn(id, "otp", T());
    expect((await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), a.jwt))).body).toMatchObject({ proven: false, reason: "identity_mismatch" });

    const id2 = await gotrue.createUser("tok@example.com");
    const sid = uuid();
    gotrue.sessions.set(sid, { userId: id2, active: true });
    await gotrue.audit(id2, "tok@example.com", "login", T());
    const stale = gotrue.token(id2, "elsewhere@example.com", sid, [{ method: "otp", timestamp: Math.floor(T() / 1000) }]);
    expect((await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id2), stale))).body).toMatchObject({ proven: false, reason: "token_email_mismatch" });

    const id3 = await gotrue.createUser("noid@example.com", { identities: [] });
    const c = await gotrue.signIn(id3, "otp", T());
    expect((await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id3), c.jwt))).body).toMatchObject({ proven: false, reason: "no_email_identity" });
    for (const u of [id, id2, id3]) expect(await proofs(u)).toEqual([]);
  });

  it("refuses a stale session and a password sign-in, and changes nothing for either", async () => {
    const id = await gotrue.createUser("stale@example.com", { password: "kept" });
    const old = await gotrue.signIn(id, "otp", Date.now() - FRESH_SESSION_MS - 60_000);
    expect(await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), old.jwt))).toEqual({ status: 200, body: { proven: false, passwordCleared: false, reason: "stale_session" } });
    const pw = await gotrue.signIn(id, "password", T());
    expect((await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), pw.jwt))).body).toMatchObject({ proven: false, reason: "not_a_mailbox_sign_in" });
    expect(await gotrue.passwordOf(id)).toBe("bcrypt:kept");
    expect(gotrue.sessionRotations).toEqual([]);
    expect(await proofs(id)).toEqual([]);
  });

  it("a Google sign-in proves the address Google verified; an unverified one proves nothing and rotates nothing", async () => {
    const id = await gotrue.createUser("g@example.com", {
      password: "pre-registered",
      identities: [
        { provider: "email", data: { email: "g@example.com" } },
        { provider: "google", data: { email: "g@example.com", email_verified: true } },
      ],
    });
    const { jwt } = await gotrue.signIn(id, "oauth", T());
    expect(await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), jwt))).toEqual({ status: 200, body: { proven: true, passwordCleared: true } });
    expect(await proofs(id)).toEqual([{ email: "g@example.com", method: "oauth", password_cleared: true }]);

    const id2 = await gotrue.createUser("h@example.com", {
      password: "kept",
      identities: [{ provider: "google", data: { email: "h@example.com", email_verified: false } }],
    });
    const b = await gotrue.signIn(id2, "oauth", T());
    expect((await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id2), b.jwt))).body).toMatchObject({ proven: false, passwordCleared: false, reason: "provider_not_verified" });
    expect(await gotrue.passwordOf(id2)).toBe("bcrypt:kept");
  });

  it("fails closed when a read fails: nothing is rotated and nothing recorded", async () => {
    const id = await gotrue.createUser("faults@example.com", { password: "kept" });
    for (const fn of ["auth_sign_in_addresses", "auth_changed_since", "auth_user_has_password"]) {
      db.rpcFaults.clear();
      db.rpcFaults.set(fn, { code: "42501", message: "permission denied" });
      const { jwt } = await gotrue.signIn(id, "otp", T());
      const r = await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), jwt));
      expect(r, fn).toMatchObject({ status: 503, body: { proven: false, passwordCleared: false, reason: "unavailable" } });
    }
    expect(await gotrue.passwordOf(id)).toBe("bcrypt:kept");
    expect(await proofs(id)).toEqual([]);
  });

  it("when GoTrue refuses the session's own update, the admin API rotates (ending every session) only if the proof is written with it", async () => {
    gotrue.refuseSessionUpdate = "current_password_required";
    const id = await gotrue.createUser("fallback@example.com", { password: "strangers" });
    const { jwt } = await gotrue.signIn(id, "otp", T());
    const r = await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id), jwt));
    expect(r).toEqual({ status: 200, body: { proven: true, passwordCleared: true, signedOut: true, reason: "every_session_ended" } });
    expect(gotrue.adminRotations).toEqual([id]);
    expect(await proofs(id)).toHaveLength(1);

    // With the proof refused, no admin rotation: the claim is given back for a retry.
    const id2 = await gotrue.createUser("fallback2@example.com", { password: "kept" });
    const t = T();
    const b = await gotrue.signIn(id2, "otp", t);
    await gotrue.audit(id2, "fallback2@example.com", "user_modified", t + 1000);
    const r2 = await runMailboxGuard(deps(), gotrue.session(await gotrue.user(id2), b.jwt));
    expect(r2).toMatchObject({ status: 503, body: { reason: "rotation_failed" } });
    expect(gotrue.adminRotations).toEqual([id]);
    expect((await pg.query(`SELECT count(*)::int AS n FROM public.account_password_clears WHERE user_id = $1`, [id2])).rows).toEqual([{ n: 0 }]);
  });

  it("names the newest sign-in method from amr, and the rotation secret fits bcrypt and any strength rule", () => {
    const t = (amr: unknown[]) => `${b64url({})}.${b64url({ amr })}.s`;
    expect(newestSignIn(t([{ method: "password", timestamp: 100 }, { method: "otp", timestamp: 200 }]))).toEqual({ method: "otp", atMs: 200_000 });
    expect(newestSignIn(t([{ method: "otp", timestamp: 300 }, { method: "password", timestamp: 200 }]))).toEqual({ method: "otp", atMs: 300_000 });
    expect(newestSignIn(t(["otp"]))).toEqual({ method: "otp", atMs: null });
    expect(newestSignIn("not-a-token")).toBeNull();
    const s = newRotationSecret();
    expect(s.length).toBeLessThanOrEqual(72);
    expect(s).toMatch(/[a-z]/);
    expect(s).toMatch(/[A-Z]/);
    expect(s).toMatch(/[0-9]/);
    expect(s).toMatch(/[^A-Za-z0-9]/);
    expect(newRotationSecret()).not.toBe(s);
  });
});

describe("the shipped auth-signed-in handler", () => {
  let handler: EdgeHandler;
  const ANON = "anon_harness_key";
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: ANON,
    SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
  };
  let rateAllowed: unknown = true;
  const tokensSeen: string[] = [];

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.__r1Service = () => {
      const admin = deps().admin as unknown as Record<string, unknown>;
      const rpc = (admin.rpc as (n: string, a: Record<string, unknown>) => unknown).bind(admin);
      return new Proxy(admin, {
        get: (t, k) => (k === "rpc"
          ? (n: string, a: Record<string, unknown>) => (n === "check_rate_limit" ? Promise.resolve({ data: rateAllowed, error: null }) : rpc(n, a))
          : Reflect.get(t, k)),
      });
    };
    g.__r1Anon = () => ({
      auth: {
        getUser: async (jwt: string) => {
          tokensSeen.push(jwt);
          const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
          const live = gotrue.sessions.get(String(claims.session_id))?.active;
          return live ? { data: { user: await gotrue.user(String(claims.sub)) }, error: null } : { data: { user: null }, error: { message: "session_not_found" } };
        },
      },
    });
    const realFetch = globalThis.fetch;
    g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${env.SUPABASE_URL}/auth/v1/user` && init?.method === "PUT") {
        const jwt = String(new Headers(init.headers).get("authorization")).replace(/^Bearer /, "");
        const r = await gotrue.rotateAsSession(jwt, JSON.parse(String(init.body)).password);
        return new Response(JSON.stringify(r.ok ? {} : { error_code: r.code }), { status: r.ok ? 200 : r.status });
      }
      return realFetch(input as RequestInfo, init);
    };
    handler = await loadEdgeHandler("auth-signed-in", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = (url, key) => key === globalThis.Deno.env.get('SUPABASE_ANON_KEY') ? globalThis.__r1Anon() : globalThis.__r1Service();",
    });
  }, 180_000);

  beforeEach(() => { rateAllowed = true; tokensSeen.length = 0; });

  const call = (method: string, headers: Record<string, string> = {}) =>
    handler(new Request("https://harness.supabase.co/functions/v1/auth-signed-in", { method, headers: { "content-type": "application/json", ...headers }, body: method === "POST" ? "{}" : undefined }));

  it("the preflight names the build, exposes it, and answers our own origin but not a stranger's", async () => {
    const ours = await call("OPTIONS", { origin: "https://resumebooster.work" });
    expect(ours.status).toBe(200);
    expect(buildIsAtLeast(ours.headers.get("x-fn-build"), "auth-signed-in", "2026-10-14", 1)).toBe(true);
    expect(ours.headers.get("x-fn-build")).toBe("auth-signed-in.2026-10-14.1");
    expect(ours.headers.get("access-control-expose-headers")).toMatch(/x-fn-build/);
    expect(ours.headers.get("access-control-allow-origin")).toBe("https://resumebooster.work");
    const preview = await call("OPTIONS", { origin: "https://id-preview--0b9d1a4e-1111-4222-8333-944445555666.lovable.app" });
    expect(preview.headers.get("access-control-allow-origin")).toBe("https://id-preview--0b9d1a4e-1111-4222-8333-944445555666.lovable.app");
    const evil = await call("OPTIONS", { origin: "https://evil.example" });
    expect(evil.headers.get("access-control-allow-origin")).toBe("https://resumebooster.work");
    expect((await call("GET")).status).toBe(405);
  });

  it("refuses with 401 before any read or write: no token, the publishable key, a connector's token, a token for another audience", async () => {
    const id = await gotrue.createUser("h1@example.com");
    const { jwt, sessionId } = await gotrue.signIn(id, "otp", Date.now() - 2000);
    const email = "h1@example.com";
    const amr = [{ method: "otp", timestamp: Math.floor((Date.now() - 2000) / 1000) }];
    const anonKeyJwt = `${b64url({ alg: "HS256" })}.${b64url({ role: "anon", iss: "supabase" })}.sig`;
    const cases: Array<[Record<string, string>, string]> = [
      [{}, "no_session"],
      [{ authorization: `Bearer ${anonKeyJwt}` }, "not_signed_in"],
      [{ authorization: `Bearer ${gotrue.token(id, email, sessionId, amr, { client_id: "mcp-connector" })}` }, "connector_token"],
      [{ authorization: `Bearer ${gotrue.token(id, email, sessionId, amr, { aud: "https://resumebooster.work/mcp" })}` }, "wrong_audience"],
    ];
    for (const [headers, reason] of cases) {
      const r = await call("POST", headers);
      expect(r.status, reason).toBe(401);
      expect(await r.json()).toMatchObject({ reason });
      expect(r.headers.get("x-fn-build")).toBe("auth-signed-in.2026-10-14.1");
    }
    expect(tokensSeen, "the claims are refused before the auth server is asked").toEqual([]);
    gotrue.sessions.get(sessionId)!.active = false;
    const ended = await call("POST", { authorization: `Bearer ${jwt}` });
    expect(ended.status).toBe(401);
    expect(await ended.json()).toMatchObject({ reason: "invalid_session" });
    expect(await proofs(id)).toEqual([]);
  });

  it("proves the address end to end, once, and answers 403 when the account's hourly allowance is spent", async () => {
    const id = await gotrue.createUser("h2@example.com", { password: "pre" });
    const { jwt } = await gotrue.signIn(id, "otp", Date.now() - 2000);
    const r = await call("POST", { authorization: `Bearer ${jwt}`, origin: "https://resumebooster.work" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ proven: true, passwordCleared: true });
    expect(r.headers.get("access-control-allow-origin")).toBe("https://resumebooster.work");
    expect(await proofs(id)).toHaveLength(1);
    const again = await call("POST", { authorization: `Bearer ${jwt}` });
    expect(await again.json()).toEqual({ proven: true, passwordCleared: false, reason: "already_proven" });
    rateAllowed = false;
    const limited = await call("POST", { authorization: `Bearer ${jwt}` });
    expect(limited.status).toBe(403);
    expect(await limited.json()).toMatchObject({ reason: "rate_limited" });
  });
});
