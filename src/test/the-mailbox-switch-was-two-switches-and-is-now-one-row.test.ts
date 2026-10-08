// @vitest-environment node
//
// Node, not jsdom: the scan-credits handler is bundled with esbuild, and the
// SQL half runs in pglite.
/**
 * THE MAILBOX SWITCH WAS TWO SWITCHES, AND IS NOW ONE ROW.
 *
 * WHAT WAS WRONG (wave 2, entitlements). "Has this account proven it reads its
 * address" had two off-switches that nothing kept together:
 *   - the scan side (_shared/mailbox-proof.ts: scan credits, the Account page,
 *     the scanner) read an EMAIL_CONFIRMED_SINCE secret;
 *   - the agent side (account_mailbox_proven, 20261005130000) read
 *     mailbox_proof_settings.confirmation_required_since.
 * The owner's closing step was documented as "set the secret" in one file and
 * "run the UPDATE" in the other. Doing either alone switched the proof on for
 * half the platform and left the other half refusing every password account.
 *
 * NOW the row is the switch for every caller. The secret is read only when the
 * row cannot be read at all; a row that answers NULL means "not switched on"
 * even with the secret set.
 *
 * Run, not read: the module's rule, the shipped scan-credits handler, and the
 * row itself in pglite answering both the SQL predicate and the module.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { agentDb } from "./helpers/agent-db";
import { PgSupabase } from "./helpers/pglite-supabase";
import {
  confirmationRequiredSince,
  provenMailbox,
  resetAutoconfirmCache,
} from "../../supabase/functions/_shared/mailbox-proof";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const passwordJwt = (sub: string) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] })}.sig`;

const USER = "00000000-0000-4000-8000-0000000000f1";
const SWITCHED_ON = new Date(Date.now() - 6 * 3600_000).toISOString();
const CONFIRMED_AFTER = new Date(Date.now() - 3600_000).toISOString();
const user = { id: USER, email: "buyer@example.com", email_confirmed_at: CONFIRMED_AFTER };
const authSaysOff = (async () => new Response(JSON.stringify({ mailer_autoconfirm: false }), { status: 200 })) as unknown as typeof fetch;

/** A client whose mailbox_proof_settings read answers `row` (or fails). */
const switchDb = (row: { confirmation_required_since: string | null } | null, error: { message: string } | null = null) => {
  const reads: string[] = [];
  return {
    reads,
    from: (table: string) => {
      reads.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: error ? null : row, error }),
      };
      return q;
    },
  };
};

beforeEach(() => {
  resetAutoconfirmCache();
});

describe("the rule reads the row, and the secret only when the row cannot be read", () => {
  const base = { supabaseUrl: "https://p.supabase.co", anonKey: "anon", fetchImpl: authSaysOff };

  it("the row switched on, no secret anywhere: a confirmation after the switch proves the address", async () => {
    const db = switchDb({ confirmation_required_since: SWITCHED_ON });
    expect(await provenMailbox(user, passwordJwt(USER), { ...base, db, confirmedSince: null })).toBe("buyer@example.com");
    expect(db.reads).toEqual(["mailbox_proof_settings"]);
  });

  it("the row answers NULL: not switched on, even though the secret is set", async () => {
    const db = switchDb({ confirmation_required_since: null });
    expect(await provenMailbox(user, passwordJwt(USER), { ...base, db, confirmedSince: SWITCHED_ON })).toBeNull();
  });

  it("the row cannot be read: the documented fallback (the secret) answers, and only that once", async () => {
    const broken = switchDb(null, { message: "relation does not exist" });
    expect(await confirmationRequiredSince({ db: broken, confirmedSince: SWITCHED_ON })).toBe(SWITCHED_ON);
    // The next call with a readable row is answered by the row.
    expect(await confirmationRequiredSince({ db: switchDb({ confirmation_required_since: null }), confirmedSince: SWITCHED_ON })).toBeNull();
  });

  it("a missing row is unreadable too; a garbage value is not a time", async () => {
    expect(await confirmationRequiredSince({ db: switchDb(null), confirmedSince: SWITCHED_ON })).toBe(SWITCHED_ON);
    expect(await confirmationRequiredSince({ db: switchDb({ confirmation_required_since: "soon" }), confirmedSince: SWITCHED_ON })).toBeNull();
  });
});

describe("the shipped scan-credits handler takes its switch from the row", () => {
  let handler: EdgeHandler;
  let row: { confirmation_required_since: string | null };
  let balanceArgs: Array<Record<string, unknown>>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness",
    SUPABASE_ANON_KEY: "anon_harness",
    STRIPE_SECRET_KEY: "sk_test_harness",
  };

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.fetch = async (url: string) =>
      String(url).endsWith("/auth/v1/settings")
        ? new Response(JSON.stringify({ mailer_autoconfirm: false }), { status: 200 })
        : new Response("{}", { status: 404 });
    handler = await loadEdgeHandler("scan-credits", {
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__switchClient;",
    });
  }, 180_000);

  beforeEach(() => {
    balanceArgs = [];
    row = { confirmation_required_since: null };
    delete env.EMAIL_CONFIRMED_SINCE;
    (globalThis as Record<string, unknown>).__switchClient = {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "check_rate_limit") return { data: true, error: null };
        if (name === "scan_credit_balance") { balanceArgs.push(args); return { data: args.p_email ? 6 : 0, error: null }; }
        return { data: 0, error: null };
      },
      from: (table: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          in: () => q,
          maybeSingle: async () => ({ data: table === "mailbox_proof_settings" ? row : null, error: null }),
          then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
        };
        return q;
      },
    };
  });

  const ask = async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/scan-credits", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${passwordJwt(USER)}`, "cf-connecting-ip": "198.51.100.9" },
      body: JSON.stringify({ sessions: [] }),
    }));
    return await res.json() as Record<string, unknown>;
  };

  it("the owner's one UPDATE (no secret set) opens the address's pool to a confirmed password account", async () => {
    row = { confirmation_required_since: SWITCHED_ON };
    const r = await ask();
    expect(r.mailboxProven).toBe(true);
    expect(r.credits).toBe(6);
    expect(balanceArgs[0]?.p_email).toBe("buyer@example.com");
  });

  it("the secret alone, with the row saying not yet, opens nothing", async () => {
    env.EMAIL_CONFIRMED_SINCE = SWITCHED_ON;
    const r = await ask();
    expect(r.mailboxProven).toBe(false);
    expect(balanceArgs[0]?.p_email).toBeNull();
  });
});

describe("one row answers the SQL predicate and the module alike", () => {
  it("before the UPDATE both say unproven; after it both say proven", async () => {
    const uid = "00000000-0000-4000-8000-0000000000f2";
    const db = await agentDb({
      seed: `INSERT INTO auth.users (id, email, email_confirmed_at, created_at)
             VALUES ('${uid}', 'buyer@example.com', '${CONFIRMED_AFTER}', '${SWITCHED_ON}'::timestamptz - interval '1 day');`,
    });
    const client = new PgSupabase(db);
    const sqlProven = async () => (await db.query<{ p: boolean }>(`SELECT public.account_mailbox_proven('${uid}') AS p`)).rows[0].p;
    const tsProven = async () => {
      resetAutoconfirmCache();
      return provenMailbox({ id: uid, email: "buyer@example.com", email_confirmed_at: CONFIRMED_AFTER }, passwordJwt(uid),
        { db: client, supabaseUrl: "https://p.supabase.co", fetchImpl: authSaysOff });
    };

    expect(await sqlProven()).toBe(false);
    expect(await tsProven()).toBeNull();

    await db.exec(`UPDATE public.mailbox_proof_settings SET confirmation_required_since = '${SWITCHED_ON}'`);
    expect(await sqlProven()).toBe(true);
    expect(await tsProven()).toBe("buyer@example.com");
    await db.close();
  });
});
