// @vitest-environment node
/**
 * A TOKEN MINTED FOR A CONNECTED APP WORKS ONLY AT THE CONNECTOR (S9-001).
 *
 * WHAT WAS WRONG (latent: the OAuth server is off, so no such token exists
 * yet). Once the owner enables Supabase's OAuth server, approving the consent
 * page in Claude or ChatGPT mints an access token that differs from a website
 * session only by a client_id claim and the MCP server's audience. Its role
 * stayed "authenticated" and the auth server's /user answers for it, so:
 *   - agent-connect minted a new rb_live_ key in plaintext for whoever held it;
 *   - agent-access, agent-pass-status, withdraw-subscription, the dormant
 *     agent checkouts and check-subscription's signed-in read acted as the
 *     person;
 *   - PostgREST and Storage ran it as the person: the agent mandate (resume
 *     text, phone), the queue, the submissions and the saved resume;
 *   - and the checkouts' own check let a token whose role was not
 *     "authenticated" through to the auth server as "not a signed-in user's".
 *
 * WHAT HOLDS NOW, proved here against the shipped SQL (pglite, logged in as
 * the API's own login role) and the shipped handlers:
 *   1. the access-token hook (20261103160000) gives a connector token role
 *      mcp_client and the MCP audience, leaves every website sign-in exactly as
 *      it was, and refuses a connector token it cannot bind;
 *   2. the API's login role cannot switch to mcp_client, so no table, view or
 *      function answers such a token; a connector token minted while the hook
 *      is off (role authenticated) still reaches no row of any table with row
 *      level security, nor the resumes bucket (20261103161000); a website
 *      session reads and writes its own rows as before;
 *   3. every site function that asks the auth server who a bearer is refuses
 *      both kinds of connector token BEFORE it asks, and the website session
 *      still gets through;
 *   4. the connector (agent-mcp's verifyOAuthBearer, which reads with the
 *      service role) still accepts the hooked token and names the person;
 *   5. no function outside agent-mcp asks the auth server about a bearer
 *      without being one of the callers proved here or in the named suites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { APPLY_AGENT_SWITCH_ON } from "./helpers/apply-agent-switch-on";
import { buildIsAtLeast } from "./helpers/fn-build";
import { codeOf } from "./helpers/strip-comments";
import { freshWorld, installDeno, loadCheckouts, post as postCheckout, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { AUTH_ISSUER, MCP_URL, verifyOAuthBearer } from "../../supabase/functions/agent-mcp/oauth";
import { provenCaller } from "../../supabase/functions/_shared/model-spend-gate";

const ROOT = resolve(__dirname, "../..");
const MIG = (stamp: string) => {
  const f = readdirSync(join(ROOT, "supabase/migrations")).find((n) => n.startsWith(`${stamp}_`));
  if (!f) throw new Error(`no migration ${stamp}`);
  return readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
};
const OLD_HOOK = MIG("20260917130000");
const HOOK = MIG("20261103160000");
const ROWS = MIG("20261103161000");
const RESUME_POLICIES = MIG("20260730202622");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "9a8b7c6d-5e4f-4a2b-8c0d-9e8f7a6b5c4d";

/** What the auth server signs for a website sign-in, and the event it hands the hook. */
const SITE_CLAIMS = {
  iss: AUTH_ISSUER, aud: "authenticated", sub: A, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
  role: "authenticated", email: "seeker@example.com", phone: "", aal: "aal1", session_id: "sess-1", is_anonymous: false,
};
const event = (claims: Record<string, unknown>) => ({ user_id: A, authentication_method: "oauth_provider/authorization_code", claims });
/** A connector token as the OAuth server mints it before any hook runs: the site's claims plus client_id. */
const UNHOOKED_CLAIMS = { ...SITE_CLAIMS, client_id: CLIENT_ID };

// ── the database: Supabase's roles and defaults, the real policies ─────────

const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE ROLE supabase_auth_admin NOLOGIN;
  CREATE ROLE authenticator LOGIN NOINHERIT;
  GRANT anon, authenticated, service_role TO authenticator;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth; CREATE SCHEMA storage;
  GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;

  CREATE TABLE public.agent_mandates (user_id uuid PRIMARY KEY, resume_text text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', resume_file_url text);
  CREATE TABLE public.agent_queue (id bigserial PRIMARY KEY, user_id uuid NOT NULL, job_id text);
  CREATE TABLE public.agent_submissions (id bigserial PRIMARY KEY, user_id uuid NOT NULL, status text);
  CREATE TABLE public.saved_searches (id bigserial PRIMARY KEY, user_id uuid NOT NULL, q text);
  DO $s$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['agent_mandates', 'agent_queue', 'agent_submissions', 'saved_searches'] LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('CREATE POLICY own_rows ON public.%I FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
    END LOOP;
  END $s$;
  -- A function PUBLIC may execute that acts on auth.uid(): the kind of thing
  -- only the role switch, never a table policy, keeps a connector token from.
  CREATE FUNCTION public.my_resume() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT resume_text FROM public.agent_mandates WHERE user_id = auth.uid() $$;

  CREATE TABLE storage.objects (id bigserial PRIMARY KEY, bucket_id text NOT NULL, name text NOT NULL, owner uuid);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT ALL ON storage.objects TO anon, authenticated, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
`;

const SEED = `
  INSERT INTO public.agent_mandates (user_id, resume_text, phone) VALUES ('${A}', 'A''s resume text', '+1 555 0100'), ('${B}', 'B''s resume text', '+1 555 0200');
  INSERT INTO public.agent_queue (user_id, job_id) VALUES ('${A}', 'gh:1');
  INSERT INTO public.agent_submissions (user_id, status) VALUES ('${A}', 'sent');
  INSERT INTO public.saved_searches (user_id, q) VALUES ('${A}', 'nurse');
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('resumes', '${A}/cv.pdf', '${A}');
`;

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) await db.close().catch(() => {}); });

async function boot(opts: { hook: boolean; rows: boolean }): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(STAND_INS);
  await db.exec(RESUME_POLICIES);
  await db.exec(OLD_HOOK);
  if (opts.hook) { await db.exec(HOOK); await db.exec(HOOK); }
  if (opts.rows) { await db.exec(ROWS); await db.exec(ROWS); }
  await db.exec(SEED);
  return db;
}

const hookOf = async (db: PGlite, ev: unknown) =>
  (await db.query<{ out: Record<string, unknown> }>("SELECT public.custom_access_token_hook($1::jsonb) AS out", [JSON.stringify(ev)])).rows[0].out;

/**
 * Runs `sql` the way PostgREST and Storage do for a bearer with these claims:
 * logged in as authenticator, switched to the token's role, the claims set.
 */
async function asToken(db: PGlite, claims: Record<string, unknown>, sql: string, params: unknown[] = []) {
  const role = String(claims.role);
  if (!/^[a-z_]+$/.test(role)) throw new Error(`refusing role ${role}`);
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.query("SET LOCAL SESSION AUTHORIZATION authenticator");
      await tx.query(`SET LOCAL ROLE ${role}`);
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return (await tx.query<Record<string, unknown>>(sql, params)).rows;
    });
    return { rows, error: null as string | null };
  } catch (e) {
    return { rows: [] as Record<string, unknown>[], error: String((e as Error).message) };
  } finally {
    // PGlite's transaction() keeps a SET LOCAL SESSION AUTHORIZATION past the
    // transaction's end (and RESET restores authenticator, not the login), so
    // the superuser reads below would run as authenticator without this.
    await db.exec("SET SESSION AUTHORIZATION postgres; RESET ROLE;");
  }
}

const READS: Array<[string, string]> = [
  ["agent_mandates", "SELECT resume_text, phone FROM public.agent_mandates"],
  ["agent_queue", "SELECT job_id FROM public.agent_queue"],
  ["agent_submissions", "SELECT status FROM public.agent_submissions"],
  ["saved_searches", "SELECT q FROM public.saved_searches"],
  ["the resumes bucket", "SELECT name FROM storage.objects WHERE bucket_id = 'resumes'"],
];
/** Writes as the person, each leaving `mark` where it lands. */
const writes = (mark: string): Array<[string, string]> => [
  ["agent_mandates", `UPDATE public.agent_mandates SET phone = '${mark}' RETURNING user_id`],
  ["agent_queue", `INSERT INTO public.agent_queue (user_id, job_id) VALUES ('${A}', '${mark}') RETURNING id`],
  ["the resumes bucket", `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('resumes', '${A}/${mark}.pdf', '${A}') RETURNING id`],
];
const WRITES = writes("site");
/** Where `mark` landed, read as the superuser. */
const landed = async (db: PGlite, mark: string) => ({
  phone: (await db.query(`SELECT 1 FROM public.agent_mandates WHERE phone = $1`, [mark])).rows.length,
  queue: (await db.query(`SELECT 1 FROM public.agent_queue WHERE job_id = $1`, [mark])).rows.length,
  file: (await db.query(`SELECT 1 FROM storage.objects WHERE name = $1`, [`${A}/${mark}.pdf`])).rows.length,
});

describe("1. the access-token hook (20261103160000)", () => {
  let db: PGlite;
  let old: PGlite;
  beforeAll(async () => {
    db = await boot({ hook: true, rows: true });
    old = await boot({ hook: false, rows: false });
  }, 120_000);

  it("teeth: the hook as it stood kept a connector token's role 'authenticated'", async () => {
    const out = await hookOf(old, event(UNHOOKED_CLAIMS));
    expect((out.claims as Record<string, unknown>).role).toBe("authenticated");
  });

  it("a website sign-in comes back exactly as it went in, an empty client_id included", async () => {
    expect(await hookOf(db, event(SITE_CLAIMS))).toEqual(event(SITE_CLAIMS));
    expect(await hookOf(db, event({ ...SITE_CLAIMS, client_id: "" }))).toEqual(event({ ...SITE_CLAIMS, client_id: "" }));
    // Not an object: returned as received, never an error that blocks sign-in.
    expect(await hookOf(db, { user_id: A, claims: "x" })).toEqual({ user_id: A, claims: "x" });
  });

  it("a connector token gets role mcp_client and the MCP audience, and nothing else changes", async () => {
    const out = await hookOf(db, event(UNHOOKED_CLAIMS));
    const claims = out.claims as Record<string, unknown>;
    expect(claims.role).toBe("mcp_client");
    expect(claims.aud).toBe(MCP_URL);
    const { role: _r, aud: _a, ...rest } = claims;
    const { role: _r2, aud: _a2, ...before } = UNHOOKED_CLAIMS;
    expect(rest).toEqual(before);
    expect(out.user_id).toBe(A);
  });

  it("a connector token the hook cannot bind is refused, not handed back as it came", async () => {
    const out = await hookOf(db, event({ ...SITE_CLAIMS, client_id: 42 }));
    expect(out.claims).toBeUndefined();
    expect(out.error).toMatchObject({ http_code: 403 });
  });

  it("only the auth server's role may run it, and the API's login role cannot become mcp_client", async () => {
    const r = (await db.query<Record<string, boolean>>(`
      SELECT has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') AS auth,
             has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') AS signed_in,
             pg_has_role('authenticator', 'mcp_client', 'MEMBER') AS switchable,
             (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'mcp_client') AS can_login`)).rows[0];
    expect(r).toEqual({ auth: true, anon: false, signed_in: false, switchable: false, can_login: false });
  });
});

describe("2. the database refuses a connector token, hooked or not, and serves a website session", () => {
  let db: PGlite;
  let noRows: PGlite;
  let hooked: Record<string, unknown>;
  beforeAll(async () => {
    db = await boot({ hook: true, rows: true });
    noRows = await boot({ hook: true, rows: false });
    hooked = (await hookOf(db, event(UNHOOKED_CLAIMS))).claims as Record<string, unknown>;
  }, 120_000);

  it("the website session reads and writes its own rows and file, and only its own", async () => {
    for (const [what, sql] of READS) {
      const r = await asToken(db, SITE_CLAIMS, sql);
      expect(r.error, what).toBeNull();
      expect(r.rows.length, what).toBe(1);
    }
    expect((await asToken(db, SITE_CLAIMS, READS[0][1])).rows).toEqual([{ resume_text: "A's resume text", phone: "+1 555 0100" }]);
    for (const [what, sql] of WRITES) {
      const r = await asToken(db, SITE_CLAIMS, sql);
      expect(r.error, what).toBeNull();
      expect(r.rows.length, what).toBe(1);
    }
    expect(await landed(db, "site")).toEqual({ phone: 1, queue: 1, file: 1 });
    expect((await asToken(db, SITE_CLAIMS, "SELECT public.my_resume() AS t")).rows).toEqual([{ t: "A's resume text" }]);
  });

  it("a hooked connector token is refused at the role switch: no table, no bucket, no function", async () => {
    for (const [what, sql] of [...READS, ...writes("hooked"), ["a definer PUBLIC may run", "SELECT public.my_resume() AS t"]]) {
      const r = await asToken(db, hooked, sql);
      expect(r.error, what).toMatch(/permission denied to set role "mcp_client"/);
      expect(r.rows, what).toEqual([]);
    }
  });

  it("teeth: without 20261103161000, a connector token minted while the hook is off reads the person's resume", async () => {
    const r = await asToken(noRows, UNHOOKED_CLAIMS, READS[0][1]);
    expect(r.rows).toEqual([{ resume_text: "A's resume text", phone: "+1 555 0100" }]);
  });

  it("a connector token minted while the hook is off reaches no row of any table and no file, and writes none", async () => {
    for (const [what, sql] of READS) {
      const r = await asToken(db, UNHOOKED_CLAIMS, sql);
      expect(r.error, what).toBeNull();
      expect(r.rows, `${what}: read as the person`).toEqual([]);
    }
    const [update, ...inserts] = writes("stolen");
    expect((await asToken(db, UNHOOKED_CLAIMS, update[1])).rows, "updated the mandate").toEqual([]);
    for (const [what, sql] of inserts) {
      expect((await asToken(db, UNHOOKED_CLAIMS, sql)).error, what).toMatch(/row-level security/);
    }
    expect(await landed(db, "stolen")).toEqual({ phone: 0, queue: 0, file: 0 });
    expect(await landed(db, "hooked")).toEqual({ phone: 0, queue: 0, file: 0 });
  });

  it("the policy came from the catalogue: every table with row level security carries it, restrictive, for the signed-in role", async () => {
    const r = (await db.query<{ tbl: string; permissive: boolean; roles: string }>(`
      SELECT c.oid::regclass::text AS tbl, p.polpermissive AS permissive, array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (p.polroles)), ',') AS roles
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'a_connector_token_reaches_no_row'
       WHERE c.relrowsecurity AND n.nspname IN ('public', 'storage') ORDER BY 1`)).rows;
    expect(r.map((x) => x.tbl)).toEqual(["agent_mandates", "agent_queue", "agent_submissions", "saved_searches", "storage.objects"]);
    for (const x of r) expect(x, x.tbl).toMatchObject({ permissive: false, roles: "authenticated" });
  });
});

// ── the site's functions ────────────────────────────────────────────────────

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.c2ln`;
const HOOKED_CLAIMS = { ...UNHOOKED_CLAIMS, aud: MCP_URL, role: "mcp_client" };
const WEBSITE = jwt(SITE_CLAIMS);
const HOOKED = jwt(HOOKED_CLAIMS);
const UNHOOKED = jwt(UNHOOKED_CLAIMS);
const CONNECTOR_TOKENS: Array<[string, string]> = [["a hooked connector token (role mcp_client)", HOOKED], ["a connector token minted with the hook off", UNHOOKED]];
const PERSON = { id: A, email: "seeker@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };

const ENV: Record<string, string | undefined> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key",
  SUPABASE_ANON_KEY: "anon_harness_key",
  STRIPE_SECRET_KEY: "sk_test_harness",
  EU_UK_SALES: "on",
};

/** The auth server answers every token below as the person: a refusal is the function's own. */
const CLIENT = `export function createClient(url, key, opts) {
  const s = globalThis.__ctState;
  const bearer = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer\\s+/i, "");
  const answer = (label) => label === "rpc:check_rate_limit" || label === "rpc:check_global_rate_limit" ? true : null;
  const chain = (label) => new Proxy(function () {}, {
    get: (_x, p) => {
      if (p === "then") return (ok) => ok({ data: answer(label), error: null });
      if (typeof p === "symbol") return undefined;
      return () => { s.touched.push(label + "." + String(p)); return chain(label); };
    },
  });
  return {
    from: (t) => { s.touched.push("from:" + t); return chain("from:" + t); },
    rpc: (n) => { s.touched.push("rpc:" + n); return chain("rpc:" + n); },
    storage: { from: () => chain("storage") },
    auth: {
      getUser: async (jwt) => {
        const t = jwt ?? bearer;
        s.asked.push(t);
        return s.users.includes(t) ? { data: { user: s.person }, error: null } : { data: { user: null }, error: { status: 403, message: "bad jwt" } };
      },
      admin: { getUserById: async () => ({ data: { user: s.person }, error: null }) },
    },
  };
}`;
const STRIPE = `export default class Stripe {
  constructor() {
    const s = globalThis.__ctState;
    const node = (path) => new Proxy(function () {}, {
      get: (_x, p) => (typeof p === "symbol" || p === "then") ? undefined : node(path + "." + String(p)),
      apply: () => { s.stripe.push(path); return Promise.resolve({ data: [], has_more: false }); },
    });
    return node("stripe");
  }
}`;
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  "https://esm.sh/stripe@18.5.0": STRIPE,
};

type State = { asked: string[]; touched: string[]; stripe: string[]; users: string[]; person: typeof PERSON };
let state: State;

/** [function, method, body, the signed-out status its identity gate answers] */
const SITE_FUNCTIONS: Array<[string, "POST" | "GET", unknown, number]> = [
  ["agent-connect", "POST", {}, 401],
  ["agent-access", "POST", {}, 401],
  ["agent-pass-status", "GET", null, 401],
  ["withdraw-subscription", "POST", { preview: true }, 401],
  ["create-pass-checkout", "POST", {}, 401],
  ["create-agent-checkout", "POST", {}, 401],
];

describe("3. every site function that asks the auth server refuses a connector token before it asks", () => {
  const h: Record<string, EdgeHandler> = {};
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => ENV[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    // The two agent checkouts are off sale and answer 410 before they read a
    // token; with the switch on (their dormant code) the identity gate runs.
    for (const [fn] of SITE_FUNCTIONS) h[fn] = await loadEdgeHandler(fn, fn.startsWith("create-") ? { ...STUBS, ...APPLY_AGENT_SWITCH_ON } : STUBS);
    h["check-subscription"] = await loadEdgeHandler("check-subscription", STUBS);
  }, 240_000);

  beforeEach(() => {
    state = { asked: [], touched: [], stripe: [], users: [WEBSITE, HOOKED, UNHOOKED], person: PERSON };
    const g = globalThis as Record<string, unknown>;
    g.__ctState = state;
    g.fetch = async () => new Response("{}", { status: 404 });
  });

  const call = (fn: string, method: "POST" | "GET", body: unknown, bearer: string) =>
    h[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, apikey: ENV.SUPABASE_ANON_KEY!, "cf-connecting-ip": "198.51.100.9", origin: "https://resumebooster.work" },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }));

  for (const [fn, method, body, signedOut] of SITE_FUNCTIONS) {
    for (const [name, token] of CONNECTOR_TOKENS) {
      it(`${fn}: ${name} is answered signed-out, and the auth server, Stripe and the person's rows are never asked`, async () => {
        const res = await call(fn, method, body, token);
        expect(res.status).toBe(signedOut);
        expect(state.asked, "the auth server was asked to vouch for it").toEqual([]);
        expect(state.stripe, "Stripe was called").toEqual([]);
        expect(state.touched.filter((t) => !t.startsWith("rpc:check_rate_limit")), "the person's rows were read or written").toEqual([]);
        expect(buildIsAtLeast(res.headers.get("x-fn-build"), fn, "2026-11-03"), String(res.headers.get("x-fn-build"))).toBe(true);
      });
    }

    it(`${fn}: the person's website session is still asked about and let through`, async () => {
      const res = await call(fn, method, body, WEBSITE);
      expect(state.asked).toEqual([WEBSITE]);
      expect(res.status, `${fn} answered the website session signed-out`).not.toBe(signedOut);
    });
  }

  it("check-subscription reads a connector token as nobody: the auth server is never asked, the website session is", async () => {
    for (const [, token] of CONNECTOR_TOKENS) {
      state.asked.length = 0;
      await call("check-subscription", "POST", {}, token);
      expect(state.asked).toEqual([]);
    }
    state.asked.length = 0;
    await call("check-subscription", "POST", {}, WEBSITE);
    expect(state.asked).toEqual([WEBSITE]);
  });
});

describe("3b. the checkouts and the billing portal refuse a hooked token too (role mcp_client)", () => {
  let h: Record<string, EdgeHandler>;
  let world: W4bWorld;
  let asked: string[];
  beforeAll(async () => {
    installDeno();
    h = await loadCheckouts(["create-checkout", "create-subscription-checkout", "create-portal-session"]);
  }, 240_000);
  beforeEach(() => {
    world = freshWorld({ [WEBSITE]: PERSON, [HOOKED]: PERSON });
    const client = (globalThis as unknown as Record<string, { auth: { getUser: (t?: string) => Promise<unknown> } }>).__w4bClient;
    const getUser = client.auth.getUser;
    asked = [];
    client.auth.getUser = async (t?: string) => { asked.push(String(t)); return getUser(t); };
  });

  for (const [fn, body] of [["create-checkout", { currency: "usd" }], ["create-subscription-checkout", {}], ["create-portal-session", {}]] as const) {
    it(`${fn}: 401 connector_token, nothing asked, nothing charged or written`, async () => {
      const res = await postCheckout(h[fn], fn, body, { bearer: HOOKED });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ reason: "connector_token" });
      expect(asked).toEqual([]);
      expect(world.stripe.touched).toEqual([]);
      expect(world.db.writes).toEqual([]);
    });
  }
});

describe("3c. the model-spend gate never counts a hooked token as the person", () => {
  it("provenCaller answers no one for role mcp_client, without asking the auth server", async () => {
    installDeno();
    const asked: string[] = [];
    const db = {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({}),
      auth: { getUser: async (t: string) => { asked.push(t); return { data: { user: PERSON }, error: null }; } },
    };
    expect(await provenCaller(db, new Headers({ authorization: `Bearer ${HOOKED}` }), undefined)).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe("4. the connector still knows who the person is", () => {
  it("agent-mcp's verifier accepts the hook's own output and names the person", async () => {
    const db = await boot({ hook: true, rows: true });
    const claims = (await hookOf(db, event(UNHOOKED_CLAIMS))).claims as Record<string, unknown>;
    const asked: string[] = [];
    const fetchStub = (async (url: string, init?: { headers?: Record<string, string> }) => {
      asked.push(String(url));
      const token = String(init?.headers?.Authorization ?? "").replace(/^Bearer /, "");
      // GoTrue's /user, which answers for any token it signed and still holds a session for.
      return token === jwt(claims) ? new Response(JSON.stringify({ id: A, email: "seeker@example.com" }), { status: 200 }) : new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    const verdict = await verifyOAuthBearer(jwt(claims), { fetch: fetchStub, anonKey: "anon_harness_key" });
    expect(verdict).toMatchObject({ ok: true, sub: A, clientId: CLIENT_ID });
    expect(asked).toEqual([`${AUTH_ISSUER}/user`]);
    // And the connector still refuses the website session itself.
    expect(await verifyOAuthBearer(WEBSITE, { fetch: fetchStub, anonKey: "anon_harness_key" })).toMatchObject({ ok: false, reason: "aud" });
  });
});

// ── the static half: who may ask the auth server about a bearer ─────────────

/**
 * Every file outside agent-mcp whose code asks the auth server about a bearer
 * token, and where its refusal of a connector token is proved.
 */
const CALLERS: Record<string, string> = {
  "_shared/website-session.ts": "the website-session check itself (R1): refuses client_id, any role but authenticated and any other audience (r1-server-website-session)",
  "_shared/checkout-buyer.ts": "section 3b here and w4b-a-connected-apps-token-never-buys-or-opens-billing",
  "_shared/signed-in-email.ts": "section 3 (check-subscription) here",
  "_shared/model-spend-gate.ts": "section 3c here: refuses any role but authenticated, so every hooked token",
  "agent-connect/index.ts": "section 3 here",
  "agent-access/index.ts": "section 3 here",
  "agent-pass-status/index.ts": "section 3 here",
  "withdraw-subscription/index.ts": "section 3 here",
  "create-pass-checkout/index.ts": "section 3 here",
  "create-agent-checkout/index.ts": "section 3 here",
  "create-portal-session/index.ts": "section 3b here",
  "free-keyword-scan/index.ts": "through websiteSessionOf (r1-server-website-session)",
  "free-keyword-scan-stream/index.ts": "through websiteSessionOf (r1-server-website-session)",
  "generate-apply-package/index.ts": "through websiteSessionOf (r1-server-website-session)",
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe("5. no function outside the connector asks the auth server about a bearer unless it is proved above", () => {
  const FN_DIR = join(ROOT, "supabase/functions");
  const askers = sources(FN_DIR)
    .map((p) => relative(FN_DIR, p))
    .filter((rel) => !rel.startsWith("agent-mcp/"))
    .filter((rel) => /\bgetUser\s*\(/.test(codeOf(readFileSync(join(FN_DIR, rel), "utf8"))))
    .sort();

  it("the census found the callers (positive control)", () => {
    expect(askers.length).toBeGreaterThanOrEqual(10);
    expect(askers).toContain("agent-connect/index.ts");
  });

  it("every caller is one of the proved ones, and every proved one still calls", () => {
    expect(askers.filter((f) => !(f in CALLERS)), "a new caller: refuse a connector token before it asks (websiteClaimsRefusal or websiteSessionOf), prove it, and name it here").toEqual([]);
    expect(Object.keys(CALLERS).filter((f) => !askers.includes(f)), "a caller listed here no longer asks").toEqual([]);
  });

  it("in each function file, a website-session check comes before the first call", () => {
    const gate = /\b(websiteClaimsRefusal|websiteTokenRefusal|websiteSessionOf|requireWebsiteSession|checkoutCaller|signedInUser)\s*\(/;
    for (const rel of askers.filter((f) => f.endsWith("/index.ts"))) {
      const code = codeOf(readFileSync(join(FN_DIR, rel), "utf8"));
      const first = code.search(/\bgetUser\s*\(/);
      const checked = code.search(gate);
      expect(checked >= 0 && checked < first, `${rel}: getUser is asked before any website-session check`).toBe(true);
    }
  });
});
