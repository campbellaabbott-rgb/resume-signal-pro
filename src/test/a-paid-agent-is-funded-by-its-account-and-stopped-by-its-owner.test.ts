// @vitest-environment node
/**
 * THE AGENT'S DATABASE HALF, EXECUTED (platform debug sweep 2026-10-04,
 * agents-api; migrations 20261005130000 and 20261005133000, and their review).
 *
 * Every property here was a defect the sweep or its review confirmed, and
 * every one is proved by running the migrations in a real Postgres (pglite)
 * over stand-in tables WITH THE LIVE TRIGGERS — agent_submissions_guard and the
 * pass refund trigger, read from the migrations that define them
 * (helpers/agent-db.ts). The first version of this file built agent_submissions
 * without them, and so passed a learned-answer retry that the live guard
 * refuses inside the candidate's own save.
 *
 *   1.07   a mandate's email is the ACCOUNT's, whatever its owner writes — and
 *          a subscription answers only the account it is bound to, or one that
 *          proved the mailbox (sign-ups are confirmed automatically)
 *   PR13   an account-linked key mint is bounded per account, per network and
 *          per door; the OAuth door keeps its own day and is never shed
 *   L9-01  request_application's enqueue flips a dismissed row, charges once
 *   L6-07  a refused pass row gives its application back once — never a row a
 *          packet was prepared from
 *   1.44   the claim reads the off switch, the pause, the blocklist, funding —
 *          by the same account key the broker reads
 *   L9-02  a claim handed back costs no attempt, and steps aside
 *   1.09   a held packet can be approved; a cancel leaves no stale reason
 *   2.14   the cooldown counts what can still go, and nothing else
 *   L9-03  the preparer's read leaves out rows that already have a packet
 *   L9-19/22 the wake starts a worker for work a started worker can end
 *   L9-07  an answered question sends back the packets it was the last answer for
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { decideRelease } from "../../supabase/functions/_shared/apply-release.ts";
import { waitForNextClaimMs } from "../../worker/src/idle.ts";
import { AGENT_STAND_INS, agentDb, liveAgentSql, migration, M_ENTITLEMENT, M_GATES } from "./helpers/agent-db";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const H = (n: number) => n.toString(16).padStart(64, "0");

/** Accounts that exist before the migrations run (the self-checks pick the oldest). */
const SEED = `
  INSERT INTO auth.users (id, email, created_at) VALUES
    ('${U1}', 'Ana@Example.com', now() - interval '30 days'),
    ('${U2}', 'bo@example.com', now() - interval '20 days');
  -- A mandate whose owner wrote someone else's address BEFORE the trigger existed.
  INSERT INTO public.agent_mandates (user_id, email, active) VALUES ('${U1}', 'resumeboostersupp@gmail.com', true);
  -- A plan bought before binding existed, on an address an account holds...
  INSERT INTO public.agent_subscribers (email, status, current_period_end)
  VALUES ('ana@example.com', 'active', now() + interval '20 days');
  -- ...and one on an address nobody has registered yet.
  INSERT INTO public.agent_subscribers (email, status, current_period_end)
  VALUES ('nobody-yet@example.com', 'active', now() + interval '20 days');
`;

let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  ((await db.query(sql, params)).rows[0] ?? {}) as T;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];
const live = async (user: string) => (await one<{ r: boolean }>(`SELECT agent_subscription_live($1) AS r`, [user])).r;

beforeAll(async () => {
  db = await agentDb({ seed: SEED });
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("the migrations' own checks leave nothing behind", () => {
  it("every row the exercised self-checks wrote was rolled back", async () => {
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM agent_subscribers WHERE email LIKE '%@self-check.invalid'`)).n).toBe(0);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM agent_submissions WHERE posting_id LIKE 'self-check:%'`)).n).toBe(0);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM agent_queue WHERE posting_id LIKE 'self-check:%'`)).n).toBe(0);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM api_key_agent_mints`)).n).toBe(0);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM api_keys`)).n).toBe(0);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM agent_passes`)).n).toBe(0);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM agent_learned_answers`)).n).toBe(0);
    expect((await one<{ s: string | null }>(`SELECT confirmation_required_since AS s FROM mailbox_proof_settings`)).s).toBeNull();
    expect((await one<{ active: boolean }>(`SELECT active FROM agent_mandates WHERE user_id = $1`, [U1])).active).toBe(true);
  });
});

describe("1.07 — the mandate's address is the account's", () => {
  it("the migration re-derived a row written before it", async () => {
    expect((await one<{ email: string }>(`SELECT email FROM agent_mandates WHERE user_id = $1`, [U1])).email)
      .toBe("ana@example.com");
  });

  it("an owner writing a subscriber's address gets their own address back", async () => {
    await db.query(`UPDATE agent_mandates SET email = 'paying-subscriber@example.com' WHERE user_id = $1`, [U1]);
    expect((await one<{ email: string }>(`SELECT email FROM agent_mandates WHERE user_id = $1`, [U1])).email)
      .toBe("ana@example.com");
    await db.query(`INSERT INTO agent_mandates (user_id, email) VALUES ($1, 'resumeboostersupp@gmail.com')`, [U2]);
    expect((await one<{ email: string }>(`SELECT email FROM agent_mandates WHERE user_id = $1`, [U2])).email)
      .toBe("bo@example.com");
  });
});

describe("1.07 completed — a subscription answers the account that bought it, not whoever holds its address", () => {
  it("a plan that existed when the migration ran is bound to the account then holding its address", async () => {
    expect((await one<{ user_id: string }>(`SELECT user_id FROM agent_subscribers WHERE email = 'ana@example.com'`)).user_id).toBe(U1);
    expect(await live(U1)).toBe(true);
    const r = await one<{ bound: boolean; status: string }>(`SELECT bound, status FROM agent_subscription_rows(ARRAY[$1::uuid])`, [U1]);
    expect(r).toEqual({ bound: true, status: "active" });
  });

  it("registering a subscriber's address — confirmed by nobody, at sign-up — does not take the plan", async () => {
    const R = "a1a1a1a1-0000-0000-0000-000000000001";
    // What an automatic confirmation looks like: confirmed the instant the account was made.
    await db.query(`INSERT INTO auth.users (id, email, created_at, email_confirmed_at) VALUES ($1, 'nobody-yet@example.com', now(), now())`, [R]);
    expect((await one<{ user_id: string | null }>(`SELECT user_id FROM agent_subscribers WHERE email = 'nobody-yet@example.com'`)).user_id).toBeNull();
    expect(await live(R)).toBe(false);
    expect(await all(`SELECT * FROM agent_subscription_rows(ARRAY[$1::uuid])`, [R])).toEqual([]);
    // Nor does it buy the registrant a paying key's limits.
    for (let i = 0; i < 5; i++) {
      await db.query(`SELECT * FROM api_key_issue_agent($1, 'x@example.com', $2, 'rb_live_x', 'net-registrant')`,
        [`a1a1a1a1-0000-0000-0000-00000000010${i}`, H(9000 + i)]);
    }
    const r = await one<{ deny_reason: string }>(`SELECT * FROM api_key_issue_agent($1, 'nobody-yet@example.com', $2, 'rb_live_x', 'net-registrant')`, [R, H(9100)]);
    expect(r.deny_reason).toBe("network_limit");
  });

  it("a confirmation proves the mailbox only after the owner records that confirmation is required — and never one made at sign-up", async () => {
    const S = "a1a1a1a1-0000-0000-0000-000000000002";
    const T = "a1a1a1a1-0000-0000-0000-000000000003";
    await db.query(`INSERT INTO agent_subscribers (email, status, current_period_end) VALUES ('sam@example.com', 'active', now() + interval '9 days'), ('tia@example.com', 'active', now() + interval '9 days')`);
    await db.query(`INSERT INTO auth.users (id, email, created_at, email_confirmed_at) VALUES
      ($1, 'sam@example.com', now() - interval '30 minutes', now() - interval '20 minutes'),
      ($2, 'tia@example.com', now() - interval '30 minutes', now() - interval '30 minutes')`, [S, T]);
    expect(await live(S)).toBe(false); // confirmation still automatic: proves nothing
    await db.query(`UPDATE mailbox_proof_settings SET confirmation_required_since = now() - interval '1 hour'`);
    expect(await live(S)).toBe(true); // confirmed ten minutes after signing up, while required
    expect(await live(T)).toBe(false); // confirmed at the instant of sign-up: nobody clicked anything
    await db.query(`UPDATE mailbox_proof_settings SET confirmation_required_since = now() + interval '1 hour'`);
    expect(await live(S)).toBe(false); // confirmed before confirmation was required
    await db.query(`UPDATE mailbox_proof_settings SET confirmation_required_since = NULL`);
  });

  it("a Google or Apple identity that verified the address proves the mailbox today", async () => {
    const G = "a1a1a1a1-0000-0000-0000-000000000004";
    await db.query(`INSERT INTO agent_subscribers (email, status, current_period_end) VALUES ('gus@example.com', 'trialing', now() + interval '6 days')`);
    await db.query(`INSERT INTO auth.users (id, email, created_at, email_confirmed_at) VALUES ($1, 'gus@example.com', now(), now())`, [G]);
    await db.query(`INSERT INTO auth.identities (user_id, provider, identity_data) VALUES ($1, 'google', '{"email":"gus@example.com","email_verified":false}')`, [G]);
    expect(await live(G)).toBe(false);
    await db.query(`UPDATE auth.identities SET identity_data = '{"email":"GUS@example.com","email_verified":true}' WHERE user_id = $1`, [G]);
    expect(await live(G)).toBe(true);
  });

  it("a plan bound to one account never answers for another that holds its address", async () => {
    const A = "a1a1a1a1-0000-0000-0000-000000000005";
    const B = "a1a1a1a1-0000-0000-0000-000000000006";
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'old-address@example.com'), ($2, 'cy@example.com')`, [A, B]);
    await db.query(`INSERT INTO agent_subscribers (email, status, current_period_end, user_id) VALUES ('cy@example.com', 'active', now() + interval '9 days', $1)`, [A]);
    expect(await live(A)).toBe(true); // A bought it under the address it has since changed away from
    expect(await live(B)).toBe(false); // B registered the address afterwards
  });
});

describe("the account-linked key mint is bounded", () => {
  const mint = (user: string, n: number, net: string | null, via = "connect") => one<{ issued_ok: boolean; deny_reason: string | null }>(
    `SELECT * FROM api_key_issue_agent($1, 'x@example.com', $2, 'rb_live_x', $3, $4)`, [user, H(n), net, via]);

  it("five mints a day per account, then account_limit — and each mint rotates the last", async () => {
    const u = "33333333-3333-3333-3333-333333333333";
    for (let i = 1; i <= 5; i++) expect((await mint(u, 100 + i, `net-a${i}`)).issued_ok).toBe(true);
    const sixth = await mint(u, 106, "net-a6");
    expect(sixth.issued_ok).toBe(false);
    expect(sixth.deny_reason).toBe("account_limit");
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`, [u])).n).toBe(1);
  });

  it("five a day per network among accounts that pay for nothing, then network_limit", async () => {
    for (let i = 0; i < 5; i++) {
      const u = `44444444-4444-4444-4444-${String(i).padStart(12, "0")}`;
      expect((await mint(u, 200 + i, "net-shared")).issued_ok).toBe(true);
    }
    const r = await mint("44444444-4444-4444-4444-999999999999", 299, "net-shared");
    expect(r.issued_ok).toBe(false);
    expect(r.deny_reason).toBe("network_limit");
  });

  it("an account with an open pass is held only to its own limit", async () => {
    const payer = "55555555-5555-5555-5555-555555555555";
    await db.query(`INSERT INTO agent_passes (user_id) VALUES ($1)`, [payer]);
    const r = await mint(payer, 300, "net-shared");
    expect(r.issued_ok).toBe(true);
  });

  it("each door keeps its own day: a connect flood cannot close the OAuth door, and the OAuth door is never shed", async () => {
    await db.query(`INSERT INTO api_key_agent_mints (user_id, mint_net, via, paying) SELECT gen_random_uuid(), 'flood-' || g, 'connect', false FROM generate_series(1, 150) g`);
    const shed = await mint("66666666-0000-0000-0000-000000000001", 400, "flood-1");
    expect(shed.deny_reason).toBe("shed");
    expect((await mint("66666666-0000-0000-0000-000000000002", 401, null, "oauth")).issued_ok).toBe(true);
    await db.query(`INSERT INTO api_key_agent_mints (user_id, mint_net, via, paying) SELECT gen_random_uuid(), NULL, 'oauth', false FROM generate_series(1, 150)`);
    expect((await mint("66666666-0000-0000-0000-000000000003", 402, null, "oauth")).issued_ok).toBe(true);
    await db.query(`INSERT INTO api_key_agent_mints (user_id, mint_net, via, paying) SELECT gen_random_uuid(), NULL, 'oauth', false FROM generate_series(1, 450)`);
    expect((await mint("66666666-0000-0000-0000-000000000004", 403, null, "oauth")).deny_reason).toBe("paused");
    await db.query(`DELETE FROM api_key_agent_mints WHERE mint_net LIKE 'flood-%' OR (via = 'oauth' AND mint_net IS NULL)`);
  });
});

describe("L9-01 / L6-07 — the paid queue", () => {
  const P = "66666666-6666-6666-6666-666666666666";
  let passId = "";
  beforeAll(async () => {
    passId = (await one<{ id: string }>(
      `INSERT INTO agent_passes (user_id, activated_at, expires_at) VALUES ($1, now(), now() + interval '6 hours') RETURNING id`, [P])).id;
  });
  const enqueue = (posting: string, passFunded: boolean) => one<{ enqueued_ok: boolean; enqueue_reason: string; pass_apps_left: number | null }>(
    `SELECT * FROM agent_queue_enqueue($1, $2, '{"title":"t","company":"Acme"}'::jsonb, $3)`, [P, posting, passFunded]);
  const used = async () => (await one<{ applications_used: number }>(`SELECT applications_used FROM agent_passes WHERE id = $1`, [passId])).applications_used;

  it("a new row is queued and paid for once; asking again changes and costs nothing", async () => {
    expect((await enqueue("breezy:acme:1", true)).enqueue_reason).toBe("queued");
    expect(await used()).toBe(1);
    expect((await enqueue("breezy:acme:1", true)).enqueue_reason).toBe("already_queued");
    expect(await used()).toBe(1);
  });

  it("a dismissed row is approved again, not called a duplicate — and an unfunded one is paid for", async () => {
    await db.query(`INSERT INTO agent_queue (user_id, posting_id, status) VALUES ($1, 'breezy:acme:2', 'dismissed')`, [P]);
    const r = await enqueue("breezy:acme:2", true);
    expect(r.enqueue_reason).toBe("requeued");
    const row = await one<{ status: string; pass_id: string }>(`SELECT status, pass_id FROM agent_queue WHERE user_id = $1 AND posting_id = 'breezy:acme:2'`, [P]);
    expect(row.status).toBe("approved");
    expect(row.pass_id).toBe(passId);
    expect(await used()).toBe(2);
  });

  it("a refused paid row gives its application back exactly once, and a new request pays again", async () => {
    const id = (await one<{ id: number }>(`SELECT id FROM agent_queue WHERE user_id = $1 AND posting_id = 'breezy:acme:1'`, [P])).id;
    expect((await one<{ r: boolean }>(`SELECT agent_queue_refuse($1, 'blocked-company') AS r`, [id])).r).toBe(true);
    expect(await used()).toBe(1);
    expect((await one<{ r: boolean }>(`SELECT agent_queue_refuse($1, 'blocked-company') AS r`, [id])).r).toBe(false);
    expect(await used()).toBe(1);
    expect((await enqueue("breezy:acme:1", true)).enqueue_reason).toBe("requeued");
    expect(await used()).toBe(2);
  });

  it("a row a packet was prepared from is never refunded as a refusal; the packet's own failure refunds it once", async () => {
    // Review of L6-07: apply-agent's fallback read (or two overlapping runs)
    // found the packet and called agent_queue_refuse('already-prepared'),
    // handing back an application the packet was still spending — and the
    // refund trigger then gave it back a second time when the packet failed.
    const row = (await one<{ id: number }>(`SELECT id FROM agent_queue WHERE user_id = $1 AND posting_id = 'breezy:acme:2'`, [P])).id;
    const pkt = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status, pass_id) VALUES ($1, 'breezy:acme:2', 'Acme', 'ready', $2) RETURNING id`, [P, passId])).id;
    const before = await used();
    expect((await one<{ r: boolean }>(`SELECT agent_queue_refuse($1, 'already-prepared') AS r`, [row])).r).toBe(false);
    expect(await used()).toBe(before);
    // The pipeline (service role) records a failure: the trigger refunds, once.
    await db.query(`UPDATE agent_submissions SET status = 'blocked', error = 'captcha appeared' WHERE id = $1`, [pkt]);
    expect(await used()).toBe(before - 1);
    await db.query(`UPDATE agent_submissions SET status = 'blocked', error = 'captcha appeared again' WHERE id = $1`, [pkt]);
    expect(await used()).toBe(before - 1);
    expect((await one<{ r: boolean }>(`SELECT agent_queue_refuse($1, 'blocked-company') AS r`, [row])).r).toBe(false);
    expect(await used()).toBe(before - 1);
  });

  it("the owner cannot write the refund receipt", async () => {
    expect((await one<{ ok: boolean }>(`SELECT has_column_privilege('authenticated', 'public.agent_queue', 'pass_refunded_at', 'UPDATE') AS ok`)).ok).toBe(false);
  });
});

describe("the claim, the last gate", () => {
  const W = "77777777-7777-7777-7777-777777777777";
  beforeAll(async () => {
    await db.query(`INSERT INTO auth.users VALUES ($1, 'wren@example.com')`, [W]);
    await db.query(`INSERT INTO agent_mandates (user_id, active, undo_window_seconds, employer_cooldown_days) VALUES ($1, true, 0, 14)`, [W]);
    await db.query(`INSERT INTO agent_subscribers (email, status, current_period_end, user_id) VALUES ('wren@example.com', 'active', now() + interval '20 days', $1)`, [W]);
  });
  let seq = 0;
  const packet = (company: string, user = W, releasedAgo = "1 minute") => one<{ id: number }>(
    `INSERT INTO agent_submissions (user_id, posting_id, company, released_at)
     VALUES ($1, $2, $3, now() - $4::interval) RETURNING id`,
    [user, `breezy:${company}:${++seq}`, company, releasedAgo]);
  const claim = async () => (await all<{ id: number; attempts: number; user_id: string }>(`SELECT id, attempts, user_id FROM agent_claim_submission('w1', 10)`))[0] ?? null;
  const clear = () => db.query(`DELETE FROM agent_submissions WHERE released_at IS NOT NULL AND submitted_at IS NULL`);

  it("hands out a funded packet of an agent that is on", async () => {
    await clear();
    const p = await packet("Acme");
    const c = await claim();
    expect(c?.id).toBe(p.id);
    expect(c?.attempts).toBe(1);
  });

  it("a claim handed back costs no attempt", async () => {
    const id = (await one<{ id: number }>(`SELECT id FROM agent_submissions WHERE user_id = $1 AND released_at IS NOT NULL`, [W])).id;
    expect((await one<{ r: boolean }>(`SELECT agent_unclaim_submission($1) AS r`, [id])).r).toBe(true);
    expect((await one<{ attempts: number }>(`SELECT attempts FROM agent_submissions WHERE id = $1`, [id])).attempts).toBe(0);
  });

  it("a packet handed back with a hold steps aside, so the next claim reaches the next packet (review of L9-02)", async () => {
    await clear();
    const head = await packet("Head", W, "2 hours");
    const next = await packet("Next", W, "1 hour");
    expect((await claim())?.id).toBe(head.id);
    await db.query(`SELECT agent_unclaim_submission($1, 10)`, [head.id]);
    expect((await claim())?.id).toBe(next.id);
    expect((await one<{ attempts: number }>(`SELECT attempts FROM agent_submissions WHERE id = $1`, [head.id])).attempts).toBe(0);
  });

  it("refuses while the agent is switched off or paused, and spends nothing", async () => {
    await clear();
    const p = await packet("Acme");
    await db.query(`UPDATE agent_mandates SET active = false WHERE user_id = $1`, [W]);
    expect(await claim()).toBeNull();
    await db.query(`UPDATE agent_mandates SET active = true, paused_until = now() + interval '7 days' WHERE user_id = $1`, [W]);
    expect(await claim()).toBeNull();
    await db.query(`UPDATE agent_mandates SET paused_until = NULL WHERE user_id = $1`, [W]);
    expect((await one<{ attempts: number }>(`SELECT attempts FROM agent_submissions WHERE id = $1`, [p.id])).attempts).toBe(0);
  });

  it("refuses an unfunded packet — a lapsed subscription and no pass on the row", async () => {
    await clear();
    await packet("Acme");
    await db.query(`UPDATE agent_subscribers SET status = 'past_due' WHERE email = 'wren@example.com'`);
    expect(await claim()).toBeNull();
    await db.query(`UPDATE agent_subscribers SET status = 'active' WHERE email = 'wren@example.com'`);
  });

  it("reads funding by the same account key the broker reads, so an address change cannot loop the queue (review)", async () => {
    // E's plan is bound to E; F's plan is a legacy row on F's OLD address
    // (unbound), and F has changed address since. The claim and
    // agent_subscription_rows — the broker's read — must agree on both.
    await clear();
    const E = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const F = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'eve-old@example.com'), ($2, 'fay-old@example.com')`, [E, F]);
    await db.query(`INSERT INTO agent_mandates (user_id, active, undo_window_seconds) VALUES ($1, true, 0), ($2, true, 0)`, [E, F]);
    await db.query(`INSERT INTO agent_subscribers (email, status, current_period_end, user_id) VALUES ('eve-old@example.com', 'active', now() + interval '9 days', $1)`, [E]);
    await db.query(`INSERT INTO agent_subscribers (email, status, current_period_end) VALUES ('fay-old@example.com', 'active', now() + interval '9 days')`);
    await db.query(`UPDATE auth.users SET email = 'eve-new@example.com' WHERE id = $1`, [E]);
    await db.query(`UPDATE auth.users SET email = 'fay-new@example.com' WHERE id = $1`, [F]);
    const f = await packet("Fay", F, "3 hours");
    const e = await packet("Eve", E, "2 hours");
    const brokerSays = async (u: string) => (await all(`SELECT * FROM agent_subscription_rows(ARRAY[$1::uuid]) WHERE status IN ('active','trialing')`, [u])).length > 0;
    // F is older, but funded by nobody now: the claim skips it, and the broker would too.
    expect(await brokerSays(F)).toBe(false);
    const c = await claim();
    expect(c?.id).toBe(e.id);
    expect(await brokerSays(E)).toBe(true);
    expect((await one<{ attempts: number }>(`SELECT attempts FROM agent_submissions WHERE id = $1`, [f.id])).attempts).toBe(0);
  });

  it("parks a released packet for an employer the candidate has since blocked", async () => {
    await clear();
    const p = await packet("Initech");
    await db.query(`UPDATE agent_mandates SET blocked_companies = ARRAY[' initech '] WHERE user_id = $1`, [W]);
    expect(await claim()).toBeNull();
    const row = await one<{ status: string; error: string }>(`SELECT status, error FROM agent_submissions WHERE id = $1`, [p.id]);
    expect(row.status).toBe("blocked");
    expect(row.error).toMatch(/^blocked-company:/);
    await db.query(`UPDATE agent_mandates SET blocked_companies = '{}' WHERE user_id = $1`, [W]);
  });

  it("parks a released packet for an employer already applied to inside the cooldown", async () => {
    await clear();
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, submitted_at, submitted_via) VALUES ($1, 'breezy:globex:sent', 'Globex', 'submitted', now() - interval '2 days', now() - interval '2 days', 'worker')`, [W]);
    const p = await packet("Globex");
    expect(await claim()).toBeNull();
    expect((await one<{ error: string }>(`SELECT error FROM agent_submissions WHERE id = $1`, [p.id])).error).toMatch(/^employer-cooldown:/);
  });
});

describe("2.14 — the cooldown counts what is on its way, and only that", () => {
  const C = "88888888-8888-8888-8888-888888888888";
  it("a released, unsent packet puts its employer in cooldown; a prepared, unreleased one does not", async () => {
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at) VALUES ($1, 'breezy:umbrella:1', 'Umbrella', now())`, [C]);
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company) VALUES ($1, 'breezy:hooli:1', 'Hooli')`, [C]);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'umbrella', 14) AS r`, [C])).r).toBe(true);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'Hooli', 14) AS r`, [C])).r).toBe(false);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'umbrella', 0) AS r`, [C])).r).toBe(false);
  });

  it("an exhausted packet, or one released before the window, never closes the employer (review)", async () => {
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at, attempts) VALUES ($1, 'breezy:acme:old', 'Acme', now() - interval '200 days', 3)`, [C]);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'Acme', 14) AS r`, [C])).r).toBe(false);
    await db.query(`UPDATE agent_submissions SET released_at = now() WHERE posting_id = 'breezy:acme:old'`);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'Acme', 14) AS r`, [C])).r).toBe(false);
    await db.query(`UPDATE agent_submissions SET attempts = 2 WHERE posting_id = 'breezy:acme:old'`);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'Acme', 14) AS r`, [C])).r).toBe(true);
  });
});

describe("1.09 — a held packet can go, the on-ramp clears, a cancel leaves no stale reason", () => {
  const O = "99999999-9999-9999-9999-999999999999";
  beforeAll(async () => {
    await db.query(`INSERT INTO auth.users VALUES ($1, 'oli@example.com')`, [O]);
    // The DATABASE DEFAULTS: hold_first_n 3, auto_released_count 0, a 900 s window.
    await db.query(`INSERT INTO agent_mandates (user_id, active) VALUES ($1, true)`, [O]);
    for (let i = 1; i <= 4; i++) {
      await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, release_refusal) VALUES ($1, $2, $3, 'held-for-review')`, [O, `breezy:co${i}:${i}`, `Co${i}`]);
    }
  });
  const decide = (id: number, what: string, user = O) => one<{ decided_ok: boolean; decide_reason: string; decided_claimable_at: string | null }>(
    `SELECT * FROM agent_packet_decide($1, $2, $3)`, [user, id, what]);
  const ids = async () => (await all<{ id: number }>(`SELECT id FROM agent_submissions WHERE user_id = $1 AND posting_id LIKE 'breezy:co%' ORDER BY id`, [O])).map((r) => r.id);

  it("with the defaults, the next release is held — and stays held with no approval", async () => {
    const m = await one<{ hold_first_n: number; auto_released_count: number }>(`SELECT hold_first_n, auto_released_count FROM agent_mandates WHERE user_id = $1`, [O]);
    const d = decideRelease({
      applyMode: "auto", packetReady: true, blockerCount: 0, source: "breezy", allowedSources: ["breezy"],
      sentToday: 0, dailyCap: 5, alreadySubmitted: false, fitPct: 80, minFitPct: 55, duplicate: false,
      senderOnline: true, holdFirstN: m.hold_first_n, autoReleasedCount: m.auto_released_count,
    });
    expect(d).toMatchObject({ release: false, code: "held-for-review" });
  });

  it("approving releases it inside the cancel window and moves the on-ramp; three approvals clear it", async () => {
    const [a, b, c] = await ids();
    for (const id of [a, b, c]) {
      const r = await decide(id, "approve");
      expect(r.decided_ok).toBe(true);
      expect(r.decided_claimable_at).toBeTruthy();
    }
    const m = await one<{ hold_first_n: number; auto_released_count: number }>(`SELECT hold_first_n, auto_released_count FROM agent_mandates WHERE user_id = $1`, [O]);
    expect(m.auto_released_count).toBe(3);
    const d = decideRelease({
      applyMode: "auto", packetReady: true, blockerCount: 0, source: "breezy", allowedSources: ["breezy"],
      sentToday: 3, dailyCap: 5, alreadySubmitted: false, fitPct: 80, minFitPct: 55, duplicate: false,
      senderOnline: true, holdFirstN: m.hold_first_n, autoReleasedCount: m.auto_released_count,
    });
    expect(d).toEqual({ release: true });
  });

  it("refuses an approval for an agent that is off, or someone else's packet", async () => {
    const [, , , d] = await ids();
    await db.query(`UPDATE agent_mandates SET active = false WHERE user_id = $1`, [O]);
    expect((await decide(d, "approve")).decide_reason).toBe("agent_off");
    await db.query(`UPDATE agent_mandates SET active = true WHERE user_id = $1`, [O]);
    expect((await decide(d, "approve", U2)).decide_reason).toBe("not_found");
  });

  it("cancel stops a packet no worker holds, and never one in a worker's hands", async () => {
    const [a, , , d] = await ids();
    await db.query(`UPDATE agent_submissions SET claimed_at = now() WHERE id = $1`, [a]);
    expect((await decide(a, "cancel")).decide_reason).toBe("in_flight");
    const r = await decide(d, "cancel");
    expect(r.decided_ok).toBe(true);
    const row = await one<{ status: string; release_refusal: string }>(`SELECT status, release_refusal FROM agent_submissions WHERE id = $1`, [d]);
    expect(row).toEqual({ status: "blocked", release_refusal: "cancelled-by-you" });
  });

  it("a cancel clears a leftover 'will retry' reason, so whether a pass is refunded never hangs on it (review)", async () => {
    // The refund trigger fires on 'blocked' with a non-empty error. A packet a
    // worker once refused for a transient reason kept "will retry: ..." — so
    // the owner's cancel refunded a pass only when that leftover was there.
    const pass = (await one<{ id: string }>(`INSERT INTO agent_passes (user_id, activated_at, expires_at, applications_used) VALUES ($1, now(), now() + interval '6 hours', 1) RETURNING id`, [O])).id;
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, error, pass_id) VALUES ($1, 'breezy:retry:1', 'Retry Co', 'ready', now(), 'will retry: driver error: timeout', $2) RETURNING id`,
      [O, pass])).id;
    expect((await decide(id, "cancel")).decided_ok).toBe(true);
    const row = await one<{ status: string; error: string; pass_refunded_at: string | null }>(`SELECT status, error, pass_refunded_at FROM agent_submissions WHERE id = $1`, [id]);
    expect(row).toEqual({ status: "blocked", error: "", pass_refunded_at: null });
    expect((await one<{ applications_used: number }>(`SELECT applications_used FROM agent_passes WHERE id = $1`, [pass])).applications_used).toBe(1);
  });
});

describe("L9-03 — the preparer reads only unprepared rows", () => {
  it("a row with a packet is left out, so the window always holds work", async () => {
    const Q = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    for (let i = 0; i < 12; i++) {
      await db.query(`INSERT INTO agent_queue (user_id, posting_id, status, created_at) VALUES ($1, $2, 'ready', now() - make_interval(mins => $3))`, [Q, `breezy:q:${i}`, i]);
    }
    for (let i = 0; i < 10; i++) await db.query(`INSERT INTO agent_submissions (user_id, posting_id) VALUES ($1, $2)`, [Q, `breezy:q:${i}`]);
    const rows = await all<{ posting_id: string }>(`SELECT posting_id FROM agent_queue_unprepared($1, ARRAY['ready','approved'], false, 10)`, [Q]);
    expect(rows.map((r) => r.posting_id).sort()).toEqual(["breezy:q:10", "breezy:q:11"]);
  });
});

describe("L9-19 / L9-22 — the wake starts a worker for exactly the work a started worker can end", () => {
  const V = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const work = async () => (await one<{ w: Record<string, number | boolean | null> }>(`SELECT agent_work_pending() AS w`)).w;

  it("an unreleased packet held for review and an unfunded one wake nothing; a claimable funded one does", async () => {
    await db.query(`DELETE FROM agent_submissions`);
    await db.query(`INSERT INTO auth.users VALUES ($1, 'vi@example.com')`, [V]);
    await db.query(`INSERT INTO agent_mandates (user_id, active) VALUES ($1, true)`, [V]);
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, release_refusal) VALUES ($1, 'breezy:v:1', 'held-for-review')`, [V]);
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, released_at) VALUES ($1, 'breezy:v:2', now())`, [V]);
    let w = await work();
    expect(w.pending).toBe(0);
    expect(w.waiting_on_sender).toBe(0);
    expect(w.should_run).toBe(false);
    const pass = (await one<{ id: string }>(`INSERT INTO agent_passes (user_id) VALUES ($1) RETURNING id`, [V])).id;
    await db.query(`UPDATE agent_submissions SET pass_id = $1 WHERE posting_id = 'breezy:v:2'`, [pass]);
    w = await work();
    expect(w.pending).toBe(1);
    expect(w.should_run).toBe(true);
  });

  it("offline -> wake -> heartbeat -> release -> the woken worker waits out the window -> claim", async () => {
    // The worker is an ephemeral job: "a heartbeat in the last 900 s" is true
    // for minutes a day. The review's chain, end to end, on the real SQL, the
    // real release decision and the worker's own wait rule.
    await db.query(`DELETE FROM agent_submissions`);
    await db.query(`DELETE FROM agent_worker_heartbeat`);
    await db.query(`UPDATE agent_mandates SET undo_window_seconds = 900 WHERE user_id = $1`, [V]);
    const pass = (await one<{ id: string }>(`SELECT id FROM agent_passes WHERE user_id = $1`, [V])).id;
    // 1. Prepared at :23 with no sender anywhere: refused 'sender-offline'.
    const online = async (s: number) => (await one<{ r: boolean }>(`SELECT agent_sender_online($1) AS r`, [s])).r;
    const decide = async () => decideRelease({
      applyMode: "auto", packetReady: true, blockerCount: 0, source: "breezy", allowedSources: ["breezy"],
      sentToday: 0, dailyCap: 5, alreadySubmitted: false, fitPct: 80, minFitPct: 55, duplicate: false,
      senderOnline: await online(8 * 3600), holdFirstN: 0, autoReleasedCount: 0,
    });
    const first = await decide();
    expect(first).toMatchObject({ release: false, code: "sender-offline" });
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, release_refusal, pass_id) VALUES ($1, 'breezy:chain:1', 'Chain Co', 'sender-offline', $2) RETURNING id`,
      [V, pass])).id;
    // 2. The wake counts it — the one wait a started worker ends.
    let w = await work();
    expect(w.waiting_on_sender).toBe(1);
    expect(w.should_run).toBe(true);
    // 3. The woken worker heartbeats, finds nothing claimable, and (with no
    //    window to wait for yet) leaves.
    await db.query(`SELECT agent_worker_ping('gha-1', '2026-10-05.1', 0)`);
    expect(await all(`SELECT id FROM agent_claim_submission('gha-1', 10)`)).toEqual([]);
    // 4. apply-agent's next run: a sender ran inside the backstop period, so
    //    the re-decided packet is released with its cancel window.
    expect(await decide()).toEqual({ release: true });
    await db.query(`UPDATE agent_submissions SET released_at = now(), release_refusal = '', claimable_at = now() + interval '900 seconds' WHERE id = $1`, [id]);
    // 5. The wake now counts it as soon-claimable, and says when.
    w = await work();
    expect(w.soon).toBe(1);
    expect(w.should_run).toBe(true);
    const wait = waitForNextClaimMs(w.next_claimable_seconds);
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThan(890_000);
    // 6. The window passes (simulated), and the claim hands it out.
    await db.query(`UPDATE agent_submissions SET claimable_at = now() - interval '1 second' WHERE id = $1`, [id]);
    expect((await one<{ id: number }>(`SELECT id FROM agent_claim_submission('gha-1', 10)`)).id).toBe(id);
  });
});

describe("L9-07 — an answered question sends the packets it was the last answer for, through the live guard", () => {
  const L = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const q = (keys: string[] | null, extra: Record<string, unknown> = {}) => JSON.stringify([
    { kind: "worker", stage: "question-unanswerable", detail: "1 required question(s) the agent cannot answer", ...(keys ? { question_keys: keys, unlearnable: 0 } : {}), ...extra },
  ]);
  const ins = (posting: string, blockers: string, attempts = 3, passId: string | null = null) => one<{ id: number }>(
    `INSERT INTO agent_submissions (user_id, posting_id, status, released_at, attempts, error, blockers, pass_id)
     VALUES ($1, $2, 'blocked', now(), $3, 'refused', $4::jsonb, $5) RETURNING id`, [L, posting, attempts, blockers, passId]);
  const st = async (id: number) => one<{ status: string; attempts: number; blockers: unknown[]; error: string }>(
    `SELECT status, attempts, blockers, error FROM agent_submissions WHERE id = $1`, [id]);
  // What PendingQuestionsPanel does: an upsert on (user_id, question_key).
  const answer = (key: string, value: string) => db.query(
    `INSERT INTO agent_learned_answers (user_id, question_key, question_label, answer_kind, answer_value)
     VALUES ($1, $2, $2, 'fill', $3)
     ON CONFLICT (user_id, question_key) DO UPDATE SET answer_value = EXCLUDED.answer_value`, [L, key, value]);

  beforeAll(async () => { await db.query(`INSERT INTO auth.users VALUES ($1, 'lu@example.com')`, [L]); });

  it("the candidate's save succeeds, and the packet whose only question it answers is back in line with its blockers cleared", async () => {
    const stopped = await ins("breezy:l:1", q(["travel"]));
    await expect(answer("travel", "Yes")).resolves.toBeTruthy();
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM agent_learned_answers WHERE user_id = $1`, [L])).n).toBe(1);
    expect(await st(stopped.id)).toEqual({ status: "ready", attempts: 0, blockers: [], error: "" });
  });

  it("an edit of an answer retries too; a packet still waiting on another answer does not go until that one comes", async () => {
    const two = await ins("breezy:l:2", q(["travel", "notice"]));
    await answer("travel", "Yes, up to 20%");
    expect((await st(two.id)).status).toBe("blocked");
    await answer("notice", "Two weeks");
    expect((await st(two.id)).status).toBe("ready");
  });

  it("never an unlearnable question, a packet that may have gone, or one already refunded to a pass", async () => {
    const unlearnable = await ins("breezy:l:3", q(["visa"], { unlearnable: 1 }));
    const unsure = await ins("breezy:l:4", JSON.stringify([
      { kind: "worker", stage: "question-unanswerable", question_keys: ["visa"] }, { kind: "uncertain-submit", detail: "no confirmation" }]), 99);
    const pass = (await one<{ id: string }>(`INSERT INTO agent_passes (user_id, applications_used) VALUES ($1, 1) RETURNING id`, [L])).id;
    // Refused on a question with a pass: the refund trigger gives the
    // application back at once, as the pipeline writes it...
    const paid = await ins("breezy:l:5", q(["visa"]), 1, pass);
    expect((await one<{ applications_used: number }>(`SELECT applications_used FROM agent_passes WHERE id = $1`, [pass])).applications_used).toBe(0);
    await answer("visa", "Yes");
    expect((await st(unlearnable.id)).status).toBe("blocked");
    expect((await st(unsure.id)).status).toBe("blocked");
    // ...and an answer never sends a refunded application again.
    expect((await st(paid.id)).status).toBe("blocked");
  });

  it("a refusal written before the worker stamped keys goes back on any answer (it cannot say which)", async () => {
    const legacy = await ins("breezy:l:6", q(null));
    await answer("anything", "x");
    expect((await st(legacy.id)).status).toBe("ready");
  });
});

describe("every new definer is closed to the publishable key", () => {
  for (const sig of [
    "public.api_key_issue_agent(uuid,text,text,text,text,text)",
    "public.agent_queue_enqueue(uuid,text,jsonb,boolean)",
    "public.agent_queue_refuse(bigint,text)",
    "public.agent_claim_submission(text,integer)",
    "public.agent_unclaim_submission(bigint,integer)",
    "public.agent_packet_decide(uuid,bigint,text)",
    "public.agent_queue_unprepared(uuid,text[],boolean,integer)",
    "public.agent_employer_in_cooldown(uuid,text,integer)",
    "public.agent_work_pending()",
    "public.agent_mandate_email_is_the_accounts()",
    "public.agent_retry_after_learned_answer()",
    "public.account_mailbox_proven(uuid)",
    "public.agent_subscription_rows(uuid[])",
    "public.agent_subscription_live(uuid)",
  ]) {
    it(`${sig}: anon and authenticated cannot execute it; service_role can`, async () => {
      const r = await one<{ a: boolean; u: boolean; s: boolean }>(
        `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS a,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS u,
                has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS s`, [sig]);
      expect(r).toEqual({ a: false, u: false, s: true });
    });
  }

  it("the owner's mailbox switch is readable and writable by nobody but the service role", async () => {
    const r = await one<{ a: boolean; u: boolean }>(
      `SELECT has_table_privilege('anon', 'public.mailbox_proof_settings', 'SELECT') AS a,
              has_table_privilege('authenticated', 'public.mailbox_proof_settings', 'UPDATE') AS u`);
    expect(r).toEqual({ a: false, u: false });
  });
});

describe("the migrations' own self-checks refuse the defects they were written for", () => {
  // Each mutation puts one reviewed defect back into the migration text; the
  // file's exercised self-check must then stop it from applying. A self-check
  // that passes the defect it names is a word search with extra steps.
  const SEED_ONE = `INSERT INTO auth.users (id, email, created_at) VALUES ('${U1}', 'Ana@Example.com', now() - interval '1 day');`;
  const apply = async (m1: (s: string) => string, m2: (s: string) => string): Promise<string> => {
    const fresh = new PGlite();
    try {
      await fresh.exec(AGENT_STAND_INS);
      await fresh.exec(liveAgentSql());
      await fresh.exec(SEED_ONE);
      await fresh.exec(m1(migration(M_ENTITLEMENT)));
      await fresh.exec(m2(migration(M_GATES)));
      return "applied";
    } catch (e) {
      return String((e as Error).message);
    } finally {
      await fresh.close();
    }
  };
  const same = (s: string) => s;
  const cut = (needle: string, by = "") => (s: string) => {
    expect(s, `the mutation's needle is gone from the migration: ${needle}`).toContain(needle);
    return s.replace(needle, by);
  };

  it("the files as written apply", async () => {
    expect(await apply(same, same)).toBe("applied");
  }, 30_000);

  const CASES: Array<[string, (s: string) => string, (s: string) => string, RegExp]> = [
    ["the retry leaves blockers on a ready packet", same, cut("blockers = '[]'::jsonb,"), /status=ready cannot carry blockers/],
    ["the cooldown counts an exhausted packet", same, cut("AND s.attempts < 3\n", "\n"), /exhausted packet kept its employer in cooldown/],
    ["a hand-back does not step aside", same, cut("THEN greatest(coalesce(claimable_at, now()), now() + make_interval(mins => least(p_hold_minutes, 120)))", "THEN claimable_at"), /did not step the packet aside/],
    ["the wake ignores packets waiting on a sender", same, (s) => cut("'waiting_on_sender', v_waiting,", "'waiting_on_sender', 0,")(cut("(v_ready > 0 OR v_soon > 0 OR v_waiting > 0)", "(v_ready > 0)")(s)), /wake did not count/],
    ["a cancel keeps the stale retry reason", same, cut("claimed_at = NULL, claimed_by = '', error = ''", "claimed_at = NULL, claimed_by = ''"), /left the old retry reason/],
    ["a prepared row is refunded as a refusal", cut("     AND NOT EXISTS (\n       SELECT 1 FROM public.agent_submissions s\n        WHERE s.user_id = q.user_id AND s.posting_id = q.posting_id\n     )\n   FOR UPDATE;", "   FOR UPDATE;"), same, /prepared packet was refunded/],
    ["an unbound plan answers an unproven address", cut("          AND public.account_mailbox_proven(u.id))", "          )"), same, /unbound subscription answered/],
    ["the OAuth door is shed like the connect door", cut("IF v_via <> 'oauth' AND v_n >= c_global_soft", "IF v_n >= c_global_soft"), same, /OAuth door shed/],
    ["the doors share one day", cut("AND am.via = v_via AND am.created_at", "AND am.created_at"), same, /OAuth flood paused the connect door/],
  ];
  for (const [name, m1, m2, msg] of CASES) {
    it(`${name}: the file refuses to apply`, async () => {
      expect(await apply(m1, m2)).toMatch(msg);
    }, 30_000);
  }
});
