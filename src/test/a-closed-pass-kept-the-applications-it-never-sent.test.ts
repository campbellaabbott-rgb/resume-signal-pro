// @vitest-environment node
//
// Node, not jsdom: the SQL runs in pglite with the live agent triggers.
/**
 * A CLOSED PASS KEPT THE APPLICATIONS IT NEVER SENT.
 *
 * WHAT WAS WRONG (platform sweep 2026-10-04, L9-13). The Agent Pass page
 * promises "a send that never happened gives its application back", and the
 * refund trigger gave one back only for a packet that went stale, or blocked
 * with an error or at 99 attempts. A packet blocked at preparation (error '',
 * attempts 0), one left ready and never released or exhausted at three
 * attempts, one whose preparation failed, and a queue row that never became a
 * packet each kept the application the buyer paid for.
 *
 * OWNER DECISION 2026-10-04: at pass close, every never-sent application is
 * given back. The same page promises "sends already requested finish even
 * after the clock ends", and the first version of the settlement broke that:
 * it stamped every approved queue row with no packet, and the preparer
 * refuses a stamped row, so a request made before the clock ran out was
 * silently never prepared (review of 20261008132000). Run here against the
 * live triggers (helpers/agent-db), the real preparer read, approval and
 * claim (20261005133000) and the file 20261008132000, through a real closer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb } from "./helpers/agent-db";

const M = "20261008132000_a_closed_pass_gives_back_every_application_it_never_sent.sql";
const USER = "00000000-0000-4000-8000-00000000a901";
const EARLIER = "00000000-0000-4000-8000-00000000a902";
const EARLY_PASS = "00000000-0000-4000-8000-0000000000c1";

let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string): Promise<T> => (await db.query<T>(sql)).rows[0];
const used = async (pass: string) => (await one<{ n: number }>(`SELECT applications_used AS n FROM public.agent_passes WHERE id = '${pass}'`)).n;
const stamped = async (table: string, posting: string) =>
  (await one<{ r: boolean }>(`SELECT pass_refunded_at IS NOT NULL AS r FROM public.${table} WHERE posting_id = '${posting}'`)).r;

beforeAll(async () => {
  db = await agentDb({
    seed: `INSERT INTO auth.users (id, email) VALUES ('${USER}', 'buyer@example.com'), ('${EARLIER}', 'earlier@example.com');`,
  });
  await db.exec(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  // An active mandate, so the real approval and claim can run.
  await db.exec(`INSERT INTO public.agent_mandates (user_id, active, apply_mode, undo_window_seconds, auto_apply_daily_cap) VALUES ('${USER}', true, 'review', 0, 20)`);
  // A pass that closed before the file ran: one request still waiting to be
  // prepared, one row its owner dismissed.
  await db.exec(`
    INSERT INTO public.agent_passes (id, user_id, applications_used, activated_at, expires_at, closed_at, close_reason)
    VALUES ('${EARLY_PASS}', '${EARLIER}', 2, now() - interval '9 hours', now() - interval '3 hours', now() - interval '3 hours', 'session_ended');
    INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES
      ('${EARLIER}', 'early:requested', 'approved', '${EARLY_PASS}'),
      ('${EARLIER}', 'early:dismissed', 'dismissed', '${EARLY_PASS}');`);
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", M), "utf8"));
}, 240_000);

afterAll(async () => { await db?.close(); });

/** A live pass with one application in each shape; answers its id. */
async function passWithEveryShape(tag: string): Promise<string> {
  await db.exec(`UPDATE public.agent_passes SET closed_at = now(), close_reason = 'session_ended' WHERE user_id = '${USER}' AND closed_at IS NULL`);
  const pass = (await one<{ id: string }>(`
    INSERT INTO public.agent_passes (user_id, applications_total, applications_used, activated_at, expires_at)
    VALUES ('${USER}', 10, 7, now() - interval '5 hours', now() + interval '1 hour') RETURNING id`)).id;
  await db.exec(`
    INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES
      ('${USER}', '${tag}:queued', 'approved', '${pass}'),
      ('${USER}', '${tag}:dismissed-by-owner', 'dismissed', '${pass}'),
      ('${USER}', '${tag}:held', 'approved', '${pass}'),
      ('${USER}', '${tag}:prep-blocked', 'approved', '${pass}'),
      ('${USER}', '${tag}:exhausted', 'approved', '${pass}'),
      ('${USER}', '${tag}:in-flight', 'approved', '${pass}'),
      ('${USER}', '${tag}:sent', 'approved', '${pass}');
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, pass_id, released_at, release_refusal, attempts, claimed_at, submitted_at, submitted_via, blockers) VALUES
      ('${USER}', '${tag}:held', '${tag} Held Co', 'ready', '${pass}', NULL, 'review-mode', 0, NULL, NULL, NULL, '[]'),
      ('${USER}', '${tag}:prep-blocked', '${tag} Blocked Co', 'blocked', '${pass}', NULL, 'not-ready', 0, NULL, NULL, NULL, '["unanswerable"]'),
      ('${USER}', '${tag}:exhausted', '${tag} Exhausted Co', 'ready', '${pass}', now(), '', 3, NULL, NULL, NULL, '[]'),
      ('${USER}', '${tag}:in-flight', '${tag} Flight Co', 'ready', '${pass}', now(), '', 1, now(), NULL, NULL, '[]'),
      ('${USER}', '${tag}:sent', '${tag} Sent Co', 'submitted', '${pass}', now(), '', 1, NULL, now(), 'worker', '[]');`);
  return pass;
}

/** The clock runs out, and the next pass-funded request closes it lazily. */
async function runOutTheClock(pass: string, tag: string) {
  await db.exec(`UPDATE public.agent_passes SET expires_at = now() - interval '1 minute' WHERE id = '${pass}'`);
  const r = await one<{ enqueue_reason: string }>(`SELECT * FROM public.agent_queue_enqueue('${USER}', '${tag}:after-close', '{}'::jsonb, true)`);
  expect(r.enqueue_reason).toBe("pass_not_live");
}

describe("a pass that closes gives back what will not go, and leaves every request that can still finish", () => {
  it("a request made before the clock ran out is still handed to the preparer after the close", async () => {
    const pass = await passWithEveryShape("a");
    await runOutTheClock(pass, "a");
    // The pass-only preparer's own read (apply-agent, agent_queue_unprepared).
    const rows = (await db.query<{ posting_id: string }>(
      `SELECT posting_id FROM public.agent_queue_unprepared('${USER}', '{approved}', true, 10)`)).rows.map((r) => r.posting_id);
    expect(rows).toContain("a:queued");
    expect(await stamped("agent_queue", "a:queued")).toBe(false);
  });

  it("gives back, once, the owner-dismissed row and the held, prep-blocked and exhausted packets", async () => {
    const pass = await passWithEveryShape("b");
    expect(await used(pass)).toBe(7);
    await runOutTheClock(pass, "b");

    // Given back: dismissed-by-owner, held, prep-blocked, exhausted.
    // Left to finish: queued, in-flight. Kept: sent.
    expect(await used(pass)).toBe(3);
    const packets = (await db.query<{ posting_id: string; refunded: boolean }>(
      `SELECT posting_id, pass_refunded_at IS NOT NULL AS refunded FROM public.agent_submissions WHERE pass_id = '${pass}' ORDER BY posting_id`)).rows;
    expect(packets).toEqual([
      { posting_id: "b:exhausted", refunded: true },
      { posting_id: "b:held", refunded: true },
      { posting_id: "b:in-flight", refunded: false },
      { posting_id: "b:prep-blocked", refunded: true },
      { posting_id: "b:sent", refunded: false },
    ]);
    expect(await stamped("agent_queue", "b:dismissed-by-owner")).toBe(true);

    // Closing it again (another reason, another closer) gives back nothing more.
    await db.exec(`UPDATE public.agent_passes SET closed_at = now(), close_reason = 'refunded' WHERE id = '${pass}'`);
    expect(await used(pass)).toBe(3);
  });

  it("a request that ends unsent after the close gives its application back then, once", async () => {
    const pass = await passWithEveryShape("c");
    await runOutTheClock(pass, "c");
    expect(await used(pass)).toBe(3);

    // The waiting request is prepared after the close and lands blocked at preparation.
    await db.exec(`INSERT INTO public.agent_submissions (user_id, posting_id, status, pass_id, release_refusal, blockers)
                   VALUES ('${USER}', 'c:queued', 'blocked', '${pass}', 'not-ready', '["needs-you"]')`);
    expect(await used(pass)).toBe(2);

    // The packet in flight at the close comes back from its third attempt unsent.
    await db.exec(`UPDATE public.agent_submissions SET status = 'ready', attempts = 3, claimed_at = NULL, claimed_by = ''
                    WHERE posting_id = 'c:in-flight'`);
    expect(await used(pass)).toBe(1);
    // A later write to it (a refusal sentence, a re-patch) gives nothing more.
    await db.exec(`UPDATE public.agent_submissions SET status = 'blocked', error = 'form changed', blockers = '[{"kind":"worker"}]'
                    WHERE posting_id = 'c:in-flight'`);
    expect(await used(pass)).toBe(1);
  });

  it("an owner's later cancel, dismissal, or the retention delete of an unprepared request gives it back", async () => {
    const pass = await passWithEveryShape("d");
    await db.exec(`
      INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES
        ('${USER}', 'd:to-dismiss', 'approved', '${pass}'),
        ('${USER}', 'd:to-delete', 'approved', '${pass}');
      UPDATE public.agent_passes SET applications_used = 9 WHERE id = '${pass}';`);
    await runOutTheClock(pass, "d");
    expect(await used(pass)).toBe(5);

    // The owner cancels the in-flight packet once its lease has lapsed (the real decide RPC).
    await db.exec(`UPDATE public.agent_submissions SET claimed_at = now() - interval '1 hour' WHERE posting_id = 'd:in-flight'`);
    const id = (await one<{ id: number }>(`SELECT id FROM public.agent_submissions WHERE posting_id = 'd:in-flight'`)).id;
    const c = await one<{ decide_reason: string }>(`SELECT * FROM public.agent_packet_decide('${USER}', ${id}, 'cancel')`);
    expect(c.decide_reason).toBe("cancelled");
    expect(await used(pass)).toBe(4);

    // The owner dismisses a request (their column grant: status, decided_at).
    await db.exec(`UPDATE public.agent_queue SET status = 'dismissed', decided_at = now() WHERE posting_id = 'd:to-dismiss'`);
    expect(await used(pass)).toBe(3);
    // Re-approving it does not make it the pass-only preparer's again.
    await db.exec(`UPDATE public.agent_queue SET status = 'approved' WHERE posting_id = 'd:to-dismiss'`);
    const rows = (await db.query<{ posting_id: string }>(
      `SELECT posting_id FROM public.agent_queue_unprepared('${USER}', '{approved}', true, 50)`)).rows.map((r) => r.posting_id);
    expect(rows).not.toContain("d:to-dismiss");

    // Retention deletes a request nobody prepared.
    await db.exec(`DELETE FROM public.agent_queue WHERE posting_id = 'd:to-delete'`);
    expect(await used(pass)).toBe(2);
  });

  it("a held packet given back at the close still goes by approval and the worker's claim, and is charged again", async () => {
    const pass = await passWithEveryShape("e");
    await runOutTheClock(pass, "e");
    expect(await used(pass)).toBe(3);
    // Nothing on the send path reads the packet's stamp.
    const id = (await one<{ id: number }>(`SELECT id FROM public.agent_submissions WHERE posting_id = 'e:held'`)).id;
    const d = await one<{ decide_reason: string }>(`SELECT * FROM public.agent_packet_decide('${USER}', ${id}, 'approve')`);
    expect(d.decide_reason).toBe("approved");
    // Out of the way: the other claimable packets from earlier cases.
    await db.exec(`UPDATE public.agent_submissions SET claimable_at = now() + interval '1 day' WHERE posting_id <> 'e:held' AND status = 'ready'`);
    const claimed = await one<{ id: number }>(`SELECT id FROM public.agent_claim_submission('test-worker', 10)`);
    expect(claimed?.id).toBe(id);
    await db.exec(`UPDATE public.agent_submissions SET status = 'submitted', submitted_at = now(), submitted_via = 'worker', claimed_at = NULL
                    WHERE id = ${id}`);
    expect(await used(pass)).toBe(4);

    // A given-back queue row prepared after all carries the give-back, so a
    // later error does not return it a second time.
    await db.exec(`INSERT INTO public.agent_submissions (user_id, posting_id, status, pass_id, blockers)
                   VALUES ('${USER}', 'e:dismissed-by-owner', 'blocked', '${pass}', '["needs-you"]')`);
    expect(await stamped("agent_submissions", "e:dismissed-by-owner")).toBe(true);
    await db.exec(`UPDATE public.agent_submissions SET status = 'blocked', error = 'form changed' WHERE posting_id = 'e:dismissed-by-owner'`);
    expect(await used(pass)).toBe(4);
  });

  it("a pass that had already closed when the file ran was settled by it, leaving its waiting request", async () => {
    expect(await one(`SELECT applications_used AS n, settled_at IS NOT NULL AS settled FROM public.agent_passes WHERE id = '${EARLY_PASS}'`))
      .toEqual({ n: 1, settled: true });
    expect(await stamped("agent_queue", "early:requested")).toBe(false);
    expect(await stamped("agent_queue", "early:dismissed")).toBe(true);
  });

  it("no client role can run the settlement", async () => {
    const acl = await one<{ x: boolean }>(`SELECT has_function_privilege('anon', 'public.agent_pass_settle(uuid)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.agent_pass_settle(uuid)', 'EXECUTE') AS x`);
    expect(acl.x).toBe(false);
  });
});
