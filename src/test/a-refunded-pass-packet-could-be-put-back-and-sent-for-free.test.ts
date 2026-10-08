import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, migration } from "./helpers/agent-db";

/**
 * Sweep S8-010, on the real claim, the live guard and the live refund trigger.
 *
 * A pass holder blocks Acme; the claim parks the released Acme packet
 * ('blocked', released_at still set) and the refund trigger gives the
 * application back. The owner unblocks Acme and PATCHes status = 'ready' (it is
 * in their column grant), and the claim funded any row with a pass_id, so the
 * worker sent it while the pass showed it unused. Wave 2 charges a given-back
 * application again when it is sent, but caps the charge at the pass's total,
 * so on a pass with nothing left the send was free.
 */
const U = "33333333-3333-4333-8333-333333333333";
let db: PGlite;
let passId = "";
let packetId = 0;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  ((await db.query(sql, params)).rows[0] ?? {}) as T;
const claim = async () => (await db.query<{ id: number }>(`SELECT id FROM agent_claim_submission('w1', 10)`)).rows[0]?.id ?? null;
const used = async () => (await one<{ n: number }>(`SELECT applications_used AS n FROM agent_passes WHERE id = $1`, [passId])).n;

beforeAll(async () => {
  db = await agentDb();
  await db.exec(migration("20261009121000_a_refunded_pass_application_is_sent_only_if_it_is_paid_for_again.sql"));
  // The owner's column grant, as 20260917180000 wrote it.
  await db.exec(`GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT ON public.agent_submissions TO authenticated;
    GRANT UPDATE (status, submitted_at, submitted_via, attempts, claimed_at, claimed_by) ON public.agent_submissions TO authenticated;`);
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'pat@example.com')`, [U]);
  await db.query(`INSERT INTO agent_mandates (user_id, email, active, undo_window_seconds, employer_cooldown_days, blocked_companies)
                  VALUES ($1, 'pat@example.com', true, 0, 0, ARRAY['Acme'])`, [U]);
  passId = (await one<{ id: string }>(
    `INSERT INTO agent_passes (user_id, activated_at, expires_at, applications_total, applications_used)
     VALUES ($1, now(), now() + interval '6 hours', 1, 1) RETURNING id`, [U])).id;
  packetId = (await one<{ id: number }>(
    `INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, pass_id)
     VALUES ($1, 'breezy:acme:1', 'Acme', 'ready', now() - interval '1 minute', $2) RETURNING id`, [U, passId])).id;
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("a parked, refunded pass packet", () => {
  it("is parked and given back by the claim", async () => {
    expect(await claim()).toBeNull();
    const row = await one<{ status: string; refunded: boolean }>(
      `SELECT status, pass_refunded_at IS NOT NULL AS refunded FROM agent_submissions WHERE id = $1`, [packetId]);
    expect(row).toEqual({ status: "blocked", refunded: true });
    expect(await used()).toBe(0);
  });

  it("cannot be put back on the line by its owner", async () => {
    await db.query(`UPDATE agent_mandates SET blocked_companies = '{}' WHERE user_id = $1`, [U]);
    await db.exec(`SET ROLE authenticated`);
    try {
      await expect(db.query(`UPDATE agent_submissions SET status = 'ready' WHERE id = $1`, [packetId])).rejects.toThrow(/record it as sent/);
    } finally {
      await db.exec(`RESET ROLE`);
    }
    expect((await one<{ status: string }>(`SELECT status FROM agent_submissions WHERE id = $1`, [packetId])).status).toBe("blocked");
  });

  it("the owner can still record a send they made themselves", async () => {
    const other = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status) VALUES ($1, 'breezy:beta:1', 'Beta', 'ready') RETURNING id`, [U])).id;
    await db.exec(`SET ROLE authenticated`);
    try {
      await db.query(`UPDATE agent_submissions SET status = 'submitted', submitted_at = now(), submitted_via = 'manual' WHERE id = $1`, [other]);
    } finally {
      await db.exec(`RESET ROLE`);
    }
    expect((await one<{ status: string }>(`SELECT status FROM agent_submissions WHERE id = $1`, [other])).status).toBe("submitted");
  });

  it("is not sent on a pass that could not charge it again", async () => {
    // Whatever puts it back (the pipeline here), a pass with nothing left
    // cannot pay for it a second time, so the claim does not hand it out.
    await db.query(`UPDATE agent_submissions SET status = 'ready', error = '' WHERE id = $1`, [packetId]);
    await db.query(`UPDATE agent_passes SET applications_used = applications_total WHERE id = $1`, [passId]);
    expect(await claim()).toBeNull();
  });

  it("is sent, as wave 2 decided, when the pass can charge it again", async () => {
    await db.query(`UPDATE agent_passes SET applications_used = 0 WHERE id = $1`, [passId]);
    expect(await claim()).toBe(packetId);
  });
});
