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
 * given back. Run here against the live triggers (helpers/agent-db) and the
 * file 20261008132000, through a real closer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb } from "./helpers/agent-db";

const M = "20261008132000_a_closed_pass_gives_back_every_application_it_never_sent.sql";
const USER = "00000000-0000-4000-8000-00000000a901";
const EARLIER = "00000000-0000-4000-8000-00000000a902";

let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string): Promise<T> => (await db.query<T>(sql)).rows[0];
const used = async (pass: string) => (await one<{ n: number }>(`SELECT applications_used AS n FROM public.agent_passes WHERE id = '${pass}'`)).n;

beforeAll(async () => {
  db = await agentDb({
    seed: `INSERT INTO auth.users (id, email) VALUES ('${USER}', 'buyer@example.com'), ('${EARLIER}', 'earlier@example.com');`,
  });
  await db.exec(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  // A pass that closed before the file ran, with one never-sent queue row.
  await db.exec(`
    INSERT INTO public.agent_passes (id, user_id, applications_used, activated_at, expires_at, closed_at, close_reason)
    VALUES ('00000000-0000-4000-8000-0000000000c1', '${EARLIER}', 1, now() - interval '9 hours', now() - interval '3 hours', now() - interval '3 hours', 'session_ended');
    INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES ('${EARLIER}', 'early:1', 'approved', '00000000-0000-4000-8000-0000000000c1');`);
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", M), "utf8"));
}, 240_000);

afterAll(async () => { await db?.close(); });

/** A live pass with one application in each shape; answers its id. */
async function passWithEveryShape(tag: string): Promise<string> {
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
    INSERT INTO public.agent_submissions (user_id, posting_id, status, pass_id, released_at, attempts, submitted_at, submitted_via, blockers) VALUES
      ('${USER}', '${tag}:held', 'ready', '${pass}', NULL, 0, NULL, NULL, '[]'),
      ('${USER}', '${tag}:prep-blocked', 'blocked', '${pass}', NULL, 0, NULL, NULL, '["unanswerable"]'),
      ('${USER}', '${tag}:exhausted', 'ready', '${pass}', now(), 3, NULL, NULL, '[]'),
      ('${USER}', '${tag}:in-flight', 'ready', '${pass}', now(), 1, NULL, NULL, '[]'),
      ('${USER}', '${tag}:sent', 'submitted', '${pass}', now(), 1, now(), 'worker', '[]');`);
  return pass;
}

describe("a pass that closes gives back every application it paid for and never sent", () => {
  it("through a real closer (the enqueue's lazy close of a run-out clock), once", async () => {
    const pass = await passWithEveryShape("a");
    expect(await used(pass)).toBe(7);
    // The clock runs out; the next pass-funded request closes it lazily.
    await db.exec(`UPDATE public.agent_passes SET expires_at = now() - interval '1 minute' WHERE id = '${pass}'`);
    const r = await one<{ enqueue_reason: string }>(`SELECT * FROM public.agent_queue_enqueue('${USER}', 'a:after-close', '{}'::jsonb, true)`);
    expect(r.enqueue_reason).toBe("pass_not_live");

    // Given back: queued, dismissed-by-owner, held, prep-blocked, exhausted. Kept: in-flight, sent.
    expect(await used(pass)).toBe(2);
    const packets = (await db.query<{ posting_id: string; refunded: boolean }>(
      `SELECT posting_id, pass_refunded_at IS NOT NULL AS refunded FROM public.agent_submissions WHERE pass_id = '${pass}' ORDER BY posting_id`)).rows;
    expect(packets).toEqual([
      { posting_id: "a:exhausted", refunded: true },
      { posting_id: "a:held", refunded: true },
      { posting_id: "a:in-flight", refunded: false },
      { posting_id: "a:prep-blocked", refunded: true },
      { posting_id: "a:sent", refunded: false },
    ]);

    // Closing it again (another reason, another closer) gives back nothing more.
    await db.exec(`UPDATE public.agent_passes SET closed_at = now(), close_reason = 'refunded' WHERE id = '${pass}'`);
    expect(await used(pass)).toBe(2);
  });

  it("a given-back application that is sent after all is charged again, and refunded never twice", async () => {
    const pass = await passWithEveryShape("b");
    await db.exec(`UPDATE public.agent_passes SET closed_at = now(), close_reason = 'session_ended' WHERE id = '${pass}'`);
    expect(await used(pass)).toBe(2);

    // The owner approves the held packet after the clock; it is sent.
    await db.exec(`UPDATE public.agent_submissions SET status = 'submitted', submitted_at = now(), submitted_via = 'worker', released_at = now()
                    WHERE user_id = '${USER}' AND posting_id = 'b:held'`);
    expect(await used(pass)).toBe(3);

    // The queued row is prepared after the close: its packet carries the give-back...
    await db.exec(`INSERT INTO public.agent_submissions (user_id, posting_id, status, pass_id, blockers)
                   VALUES ('${USER}', 'b:queued', 'blocked', '${pass}', '["needs-you"]')`);
    expect((await one<{ r: boolean }>(`SELECT pass_refunded_at IS NOT NULL AS r FROM public.agent_submissions WHERE posting_id = 'b:queued'`)).r).toBe(true);
    // ...so a later error does not give it back a second time.
    await db.exec(`UPDATE public.agent_submissions SET status = 'blocked', error = 'form changed' WHERE posting_id = 'b:queued'`);
    expect(await used(pass)).toBe(3);
  });

  it("a pass that had already closed when the file ran was settled by it", async () => {
    expect(await one(`SELECT applications_used AS n, settled_at IS NOT NULL AS settled FROM public.agent_passes WHERE id = '00000000-0000-4000-8000-0000000000c1'`))
      .toEqual({ n: 0, settled: true });
  });

  it("no client role can run the settlement", async () => {
    const acl = await one<{ x: boolean }>(`SELECT has_function_privilege('anon', 'public.agent_pass_settle(uuid)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.agent_pass_settle(uuid)', 'EXECUTE') AS x`);
    expect(acl.x).toBe(false);
  });
});
