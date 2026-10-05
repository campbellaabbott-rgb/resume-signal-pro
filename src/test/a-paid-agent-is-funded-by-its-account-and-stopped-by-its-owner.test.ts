/**
 * THE AGENT'S DATABASE HALF, EXECUTED (platform debug sweep 2026-10-04,
 * agents-api; migrations 20261005130000 and 20261005133000).
 *
 * Every property here was a defect the sweep confirmed on main, and every one
 * is proved by running the migrations in a real Postgres (pglite) over
 * stand-in tables carrying the columns the SQL touches — never by reading the
 * SQL's spelling:
 *
 *   1.07   a mandate's email is the ACCOUNT's, whatever its owner writes
 *   PR13   an account-linked key mint is bounded per account, per network
 *          and per day — and a paying account is held only to its own limit
 *   L9-01  request_application's enqueue flips a dismissed / unfunded row
 *          instead of calling it a duplicate, and charges a pass only once
 *   L6-07  a refused pass-funded row gives its application back, once
 *   1.44   the claim reads the off switch, the pause, the blocklist, funding
 *   L9-02  a claim handed back costs no attempt
 *   1.09   a held packet can be approved; three approvals clear the on-ramp
 *   2.14   the cooldown counts what is released and on its way
 *   L9-03  the preparer's read leaves out rows that already have a packet
 *   L9-19  the wake counts only claimable, funded work
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideRelease } from "../../supabase/functions/_shared/apply-release.ts";

const MIG = resolve(__dirname, "../../supabase/migrations");
const M1 = readFileSync(resolve(MIG, "20261005130000_an_entitlement_is_read_by_the_account_and_a_signed_in_key_has_limits.sql"), "utf8");
const M2 = readFileSync(resolve(MIG, "20261005133000_a_held_packet_can_go_and_the_last_gate_reads_the_stop_button.sql"), "utf8");

/** The tables the two files touch, with the columns the SQL reads and writes. */
const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

  CREATE TABLE public.agent_mandates (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id),
    email text NOT NULL DEFAULT '',
    active boolean NOT NULL DEFAULT false,
    paused_until timestamptz,
    blocked_companies text[] NOT NULL DEFAULT '{}',
    employer_cooldown_days integer NOT NULL DEFAULT 14,
    hold_first_n integer NOT NULL DEFAULT 3,
    auto_released_count integer NOT NULL DEFAULT 0,
    undo_window_seconds integer NOT NULL DEFAULT 900,
    auto_apply_daily_cap integer NOT NULL DEFAULT 5
  );
  CREATE TABLE public.agent_subscribers (
    email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
    current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.agent_passes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    applications_total integer NOT NULL DEFAULT 10, applications_used integer NOT NULL DEFAULT 0,
    activated_at timestamptz, expires_at timestamptz, shelf_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
    closed_at timestamptz, close_reason text
  );
  CREATE TABLE public.agent_queue (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL, posting_id text NOT NULL,
    title text NOT NULL DEFAULT '', company text NOT NULL DEFAULT '', company_token text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '', apply_url text NOT NULL DEFAULT '', salary text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT 'other', posted_at timestamptz, fit_pct integer,
    reasons jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'ready',
    created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
    search_id bigint, search_label text NOT NULL DEFAULT '', pass_id uuid,
    UNIQUE (user_id, posting_id)
  );
  GRANT SELECT ON public.agent_queue TO authenticated;
  GRANT UPDATE (status, decided_at) ON public.agent_queue TO authenticated;
  CREATE TABLE public.agent_submissions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL, posting_id text NOT NULL, company text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT 'breezy', status text NOT NULL DEFAULT 'ready',
    released_at timestamptz, release_refusal text NOT NULL DEFAULT '', claimable_at timestamptz,
    claimed_at timestamptz, claimed_by text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0,
    submitted_at timestamptz, error text NOT NULL DEFAULT '', pass_id uuid, pass_refunded_at timestamptz,
    blockers jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.agent_learned_answers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL,
    question_key text NOT NULL, question_label text NOT NULL, answer_kind text NOT NULL,
    answer_value text NOT NULL DEFAULT '', UNIQUE (user_id, question_key)
  );
  CREATE TABLE public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL, key_prefix text NOT NULL,
    name text, owner_email text, tier text, user_id uuid, revoked_at timestamptz, notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`;

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const H = (n: number) => n.toString(16).padStart(64, "0");

let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  ((await db.query(sql, params)).rows[0] ?? {}) as T;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(`INSERT INTO auth.users VALUES ('${U1}', 'Ana@Example.com'), ('${U2}', 'bo@example.com');`);
  // A mandate whose owner wrote someone else's address BEFORE the trigger existed.
  await db.exec(`INSERT INTO public.agent_mandates (user_id, email, active) VALUES ('${U1}', 'resumeboostersupp@gmail.com', true);`);
  await db.exec(M1);
  await db.exec(M2);
}, 60_000);
afterAll(async () => { await db?.close(); });

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

describe("the account-linked key mint is bounded", () => {
  const mint = (user: string, n: number, net: string | null) => one<{ issued_ok: boolean; deny_reason: string | null }>(
    `SELECT * FROM api_key_issue_agent($1, 'x@example.com', $2, 'rb_live_x', $3)`, [user, H(n), net]);

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

  it("the owner cannot write the refund receipt", async () => {
    expect((await one<{ ok: boolean }>(`SELECT has_column_privilege('authenticated', 'public.agent_queue', 'pass_refunded_at', 'UPDATE') AS ok`)).ok).toBe(false);
  });
});

describe("the claim, the last gate", () => {
  const W = "77777777-7777-7777-7777-777777777777";
  beforeAll(async () => {
    await db.query(`INSERT INTO auth.users VALUES ($1, 'wren@example.com')`, [W]);
    await db.query(`INSERT INTO agent_mandates (user_id, active, undo_window_seconds, employer_cooldown_days) VALUES ($1, true, 0, 14)`, [W]);
    await db.query(`INSERT INTO agent_subscribers (email, status, current_period_end) VALUES ('wren@example.com', 'active', now() + interval '20 days')`);
  });
  let seq = 0;
  const packet = (company: string) => one<{ id: number }>(
    `INSERT INTO agent_submissions (user_id, posting_id, company, released_at)
     VALUES ($1, $2, $3, now() - interval '1 minute') RETURNING id`,
    [W, `breezy:${company}:${++seq}`, company]);
  const claim = async () => (await all<{ id: number; attempts: number }>(`SELECT id, attempts FROM agent_claim_submission('w1', 10)`))[0] ?? null;
  const clear = () => db.query(`DELETE FROM agent_submissions WHERE user_id = $1`, [W]);

  it("hands out a funded packet of an agent that is on", async () => {
    await clear();
    const p = await packet("Acme");
    const c = await claim();
    expect(c?.id).toBe(p.id);
    expect(c?.attempts).toBe(1);
  });

  it("a claim handed back costs no attempt", async () => {
    const id = (await one<{ id: number }>(`SELECT id FROM agent_submissions WHERE user_id = $1`, [W])).id;
    expect((await one<{ r: boolean }>(`SELECT agent_unclaim_submission($1) AS r`, [id])).r).toBe(true);
    expect((await one<{ attempts: number }>(`SELECT attempts FROM agent_submissions WHERE id = $1`, [id])).attempts).toBe(0);
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
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, submitted_at) VALUES ($1, 'breezy:globex:sent', 'Globex', 'submitted', now() - interval '2 days', now() - interval '2 days')`, [W]);
    const p = await packet("Globex");
    expect(await claim()).toBeNull();
    expect((await one<{ error: string }>(`SELECT error FROM agent_submissions WHERE id = $1`, [p.id])).error).toMatch(/^employer-cooldown:/);
  });
});

describe("2.14 — the cooldown counts what is on its way", () => {
  it("a released, unsent packet puts its employer in cooldown; a prepared, unreleased one does not", async () => {
    const C = "88888888-8888-8888-8888-888888888888";
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at) VALUES ($1, 'breezy:umbrella:1', 'Umbrella', now())`, [C]);
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company) VALUES ($1, 'breezy:hooli:1', 'Hooli')`, [C]);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'umbrella', 14) AS r`, [C])).r).toBe(true);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'Hooli', 14) AS r`, [C])).r).toBe(false);
    expect((await one<{ r: boolean }>(`SELECT agent_employer_in_cooldown($1, 'umbrella', 0) AS r`, [C])).r).toBe(false);
  });
});

describe("1.09 — a held packet can go, and the on-ramp clears", () => {
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
  const ids = async () => (await all<{ id: number }>(`SELECT id FROM agent_submissions WHERE user_id = $1 ORDER BY id`, [O])).map((r) => r.id);

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
    // The fourth packet, re-decided by apply-agent's next run with the count it reads now:
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
});

describe("L9-03 — the preparer reads only unprepared rows", () => {
  it("a row with a packet is left out, so the window always holds work", async () => {
    const Q = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    for (let i = 0; i < 12; i++) {
      await db.query(`INSERT INTO agent_queue (user_id, posting_id, status, created_at) VALUES ($1, $2, 'ready', now() - make_interval(mins => $3))`, [Q, `breezy:q:${i}`, i]);
    }
    // The ten newest already have packets.
    for (let i = 0; i < 10; i++) await db.query(`INSERT INTO agent_submissions (user_id, posting_id) VALUES ($1, $2)`, [Q, `breezy:q:${i}`]);
    const rows = await all<{ posting_id: string }>(`SELECT posting_id FROM agent_queue_unprepared($1, ARRAY['ready','approved'], false, 10)`, [Q]);
    expect(rows.map((r) => r.posting_id).sort()).toEqual(["breezy:q:10", "breezy:q:11"]);
  });
});

describe("L9-19 — the wake counts what a worker could take", () => {
  it("an unreleased packet and an unfunded one wake nothing; a claimable funded one does", async () => {
    await db.query(`DELETE FROM agent_submissions`);
    const V = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await db.query(`INSERT INTO auth.users VALUES ($1, 'vi@example.com')`, [V]);
    await db.query(`INSERT INTO agent_mandates (user_id, active) VALUES ($1, true)`, [V]);
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, release_refusal) VALUES ($1, 'breezy:v:1', 'held-for-review')`, [V]);
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, released_at) VALUES ($1, 'breezy:v:2', now())`, [V]);
    let w = (await one<{ w: Record<string, unknown> }>(`SELECT agent_work_pending() AS w`)).w;
    expect(w.pending).toBe(0);
    expect(w.should_run).toBe(false);
    // The pass stamped on the row funds it, with no subscription anywhere.
    const pass = (await one<{ id: string }>(`INSERT INTO agent_passes (user_id) VALUES ($1) RETURNING id`, [V])).id;
    await db.query(`UPDATE agent_submissions SET pass_id = $1 WHERE posting_id = 'breezy:v:2'`, [pass]);
    w = (await one<{ w: Record<string, unknown> }>(`SELECT agent_work_pending() AS w`)).w;
    expect(w.pending).toBe(1);
    expect(w.should_run).toBe(true);
  });
});

describe("L9-07 — an answered question sends the packets it stopped, never one that may have gone", () => {
  it("a question-blocked packet is back in line; an uncertain one and a refunded one are not", async () => {
    const L = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const q = JSON.stringify([{ kind: "worker", stage: "question-unanswerable", detail: "1 required question(s) the agent cannot answer" }]);
    const unsure = JSON.stringify([{ kind: "worker", stage: "question-unanswerable" }, { kind: "uncertain-submit", detail: "no confirmation" }]);
    const ins = (posting: string, blockers: string, extra = "") => one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, status, released_at, attempts, error, blockers ${extra ? ", pass_refunded_at" : ""})
       VALUES ($1, $2, 'blocked', now(), 3, 'refused', $3::jsonb ${extra ? ", now()" : ""}) RETURNING id`, [L, posting, blockers]);
    const stopped = await ins("breezy:l:1", q);
    const uncertain = await ins("breezy:l:2", unsure);
    const refunded = await ins("breezy:l:3", q, "refunded");
    await db.query(`INSERT INTO agent_learned_answers (user_id, question_key, question_label, answer_kind, answer_value) VALUES ($1, 'travel', 'Willing to travel?', 'choose', 'Yes')`, [L]);
    const st = async (id: number) => one<{ status: string; attempts: number }>(`SELECT status, attempts FROM agent_submissions WHERE id = $1`, [id]);
    expect(await st(stopped.id)).toEqual({ status: "ready", attempts: 0 });
    expect((await st(uncertain.id)).status).toBe("blocked");
    expect((await st(refunded.id)).status).toBe("blocked");
  });
});

describe("every new definer is closed to the publishable key", () => {
  for (const sig of [
    "public.api_key_issue_agent(uuid,text,text,text,text,text)",
    "public.agent_queue_enqueue(uuid,text,jsonb,boolean)",
    "public.agent_queue_refuse(bigint,text)",
    "public.agent_claim_submission(text,integer)",
    "public.agent_unclaim_submission(bigint)",
    "public.agent_packet_decide(uuid,bigint,text)",
    "public.agent_queue_unprepared(uuid,text[],boolean,integer)",
    "public.agent_employer_in_cooldown(uuid,text,integer)",
    "public.agent_work_pending()",
    "public.agent_mandate_email_is_the_accounts()",
    "public.agent_retry_after_learned_answer()",
  ]) {
    it(`${sig}: anon and authenticated cannot execute it; service_role can`, async () => {
      const r = await one<{ a: boolean; u: boolean; s: boolean }>(
        `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS a,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS u,
                has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS s`, [sig]);
      expect(r).toEqual({ a: false, u: false, s: true });
    });
  }
});
