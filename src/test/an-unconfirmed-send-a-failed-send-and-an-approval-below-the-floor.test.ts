// @vitest-environment node
//
// Node, not jsdom: the SQL runs in pglite with the live agent triggers.
/**
 * Three gates on one packet, run on the real claim, the live guard and the
 * live refund trigger (helpers/agent-db) with the files that fix them.
 *
 * S11-044. An unconfirmed submit (agent_mark_uncertain) counted toward
 * neither the employer cooldown nor the daily cap, and the pass gave its
 * application back: claim Acme #1, mark it uncertain, and the next claim
 * handed out Acme #2 two minutes later (20261009124000).
 *
 * S11-042. In auto mode a packet refused as fit-below-floor or fit-unknown
 * could never be approved; a person's approval is not an unattended send
 * (owner decision 2026-10-11), so it now goes (20261009124100).
 *
 * S11-043. "Try again" on a packet the worker parked after its third
 * transient refusal reset only attempts and the lease, so the 'blocked'
 * packet was never claimed while the toast said "Queued again". Retry now
 * goes through agent_packet_decide and puts it back on the line.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, migration } from "./helpers/agent-db";
import { APPROVABLE_REFUSALS, decideRelease, refusalToStore, type ReleaseInput } from "../../supabase/functions/_shared/apply-release";
import { packetState } from "../lib/packetState";

const M_PASS_GRANT = "20261008131500_a_signed_in_account_reads_its_pass_and_never_writes_it.sql";
const M_SETTLE = "20261008132000_a_closed_pass_gives_back_every_application_it_never_sent.sql";
const M_REFUNDED = "20261009121000_a_refunded_pass_application_is_sent_only_if_it_is_paid_for_again.sql";
export const M_UNCERTAIN = "20261009124000_an_unconfirmed_send_counts_as_a_send_and_keeps_its_application.sql";
export const M_DECIDE = "20261009124100_a_person_may_send_what_the_agent_would_not_and_try_a_failed_send_again.sql";

const U = "44444444-4444-4444-8444-444444444444";
let db: PGlite;
let pass = "";
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  ((await db.query(sql, params)).rows[0] ?? {}) as T;
const claim = async () => (await db.query<{ id: number }>(`SELECT id FROM agent_claim_submission('w1', 10)`)).rows[0]?.id ?? null;
/** Every packet the claim hands out now (each stays leased, so it is taken once). */
const drain = async (): Promise<number[]> => {
  const ids: number[] = [];
  for (let id = await claim(); id !== null && ids.length < 50; id = await claim()) ids.push(id);
  return ids;
};
const used = async () => (await one<{ n: number }>(`SELECT applications_used AS n FROM agent_passes WHERE id = $1`, [pass])).n;
const decide = async (id: number, d: string) =>
  one<{ decided_ok: boolean; decide_reason: string }>(`SELECT * FROM agent_packet_decide($1, $2, $3)`, [U, id, d]);
const packet = async (posting: string, company: string, extra = "") =>
  (await one<{ id: number }>(
    `INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, pass_id${extra ? ", " + extra.split("=")[0] : ""})
     VALUES ($1, $2, $3, 'ready', now() - interval '5 minutes', $4${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id`,
    [U, posting, company, pass])).id;

beforeAll(async () => {
  db = await agentDb({ seed: `INSERT INTO auth.users (id, email) VALUES ('${U}', 'sam@example.com');` });
  await db.exec(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", M_PASS_GRANT), "utf8"));
  await db.exec(migration(M_SETTLE));
  await db.exec(migration(M_REFUNDED));
  await db.exec(migration(M_UNCERTAIN));
  await db.exec(migration(M_DECIDE));
  await db.query(`INSERT INTO agent_mandates (user_id, email, active, apply_mode, undo_window_seconds, employer_cooldown_days, auto_apply_daily_cap)
                  VALUES ($1, 'sam@example.com', true, 'auto', 0, 14, 20)`, [U]);
  pass = (await one<{ id: string }>(
    `INSERT INTO agent_passes (user_id, activated_at, expires_at, applications_total, applications_used)
     VALUES ($1, now(), now() + interval '6 hours', 10, 2) RETURNING id`, [U])).id;
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("S11-044: an unconfirmed send is a send", () => {
  let acme1 = 0;
  let acme2 = 0;

  it("the employer's second packet is not handed out after the first ends unconfirmed", async () => {
    acme1 = await packet("breezy:acme:1", "Acme");
    acme2 = await packet("breezy:acme:2", "Acme");
    expect(await claim()).toBe(acme1);
    await db.query(`SELECT agent_mark_uncertain($1, 'submit sent 1 request(s) (status 200) and the form is still showing — outcome unknown, not retrying')`, [acme1]);
    expect(await claim()).toBeNull();
    const second = await one<{ status: string; error: string }>(`SELECT status, error FROM agent_submissions WHERE id = $1`, [acme2]);
    expect(second.status).toBe("blocked");
    expect(second.error).toMatch(/^employer-cooldown:/);
  });

  it("keeps its pass application, while the parked second one is given back", async () => {
    // 2 used: the unconfirmed one stays spent; Acme #2 never went and is returned.
    expect(await used()).toBe(1);
    expect((await one<{ r: boolean }>(`SELECT pass_refunded_at IS NULL AS r FROM agent_submissions WHERE id = $1`, [acme1])).r).toBe(true);
  });

  it("is counted by the cooldown reader and today's count", async () => {
    expect((await one<{ c: boolean }>(`SELECT agent_employer_in_cooldown($1, 'acme', 14) AS c`, [U])).c).toBe(true);
    expect((await one<{ n: number }>(`SELECT agent_sent_today($1) AS n`, [U])).n).toBeGreaterThanOrEqual(1);
  });

  it("fills the daily cap: at a cap of one, nothing more goes today", async () => {
    await db.query(`UPDATE agent_mandates SET auto_apply_daily_cap = 1 WHERE user_id = $1`, [U]);
    const beta = await packet("breezy:beta:1", "Beta");
    expect(await claim()).toBeNull();
    await db.query(`UPDATE agent_mandates SET auto_apply_daily_cap = 20 WHERE user_id = $1`, [U]);
    expect(await claim()).toBe(beta);
    await db.query(`UPDATE agent_submissions SET status = 'submitted', submitted_at = now(), submitted_via = 'worker', claimed_at = NULL WHERE id = $1`, [beta]);
  });

  it("is never given back when the pass closes", async () => {
    const row = await one<{ g: boolean }>(`SELECT agent_pass_packet_gives_back(s) AS g FROM agent_submissions s WHERE id = $1`, [acme1]);
    expect(row.g).toBe(false);
  });

  it("a person saying it did not arrive gives it back, once, and it is never retried", async () => {
    const before = await used();
    expect(await decide(acme1, "retry")).toMatchObject({ decided_ok: false, decide_reason: "not_retryable" });
    expect(await decide(acme1, "not_sent")).toMatchObject({ decided_ok: true, decide_reason: "recorded_not_sent" });
    expect(await used()).toBe(before - 1);
    const row = await one<{ u: string | null; k: string }>(`SELECT uncertain_at AS u, blockers->0->>'kind' AS k FROM agent_submissions WHERE id = $1`, [acme1]);
    expect(row).toEqual({ u: null, k: "not-sent" });
    expect(await decide(acme1, "not_sent")).toMatchObject({ decided_ok: false, decide_reason: "not_unconfirmed" });
    expect(await used()).toBe(before - 1);
    expect(await decide(acme1, "retry")).toMatchObject({ decided_ok: false, decide_reason: "not_retryable" });
    // ...and the account page says what the person told us, with no retry.
    const row2 = await one<{ status: string; attempts: number; blockers: Array<{ kind: string }> }>(
      `SELECT status, attempts, blockers FROM agent_submissions WHERE id = $1`, [acme1]);
    expect(packetState(row2)).toMatchObject({ phase: "not-arrived", canRetry: false });
  });
});

describe("S11-042: a person may approve below the fit floor", () => {
  it.each(["fit-below-floor", "fit-unknown"])("an auto-mode packet refused %s is approved and released", async (code) => {
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status, release_refusal, pass_id)
       VALUES ($1, $2, 'Gamma', 'ready', $3, $4) RETURNING id`, [U, `breezy:gamma:${code}`, code, pass])).id;
    expect(await decide(id, "approve")).toMatchObject({ decided_ok: true, decide_reason: "approved" });
    const row = await one<{ r: boolean; c: string }>(`SELECT released_at IS NOT NULL AS r, release_refusal AS c FROM agent_submissions WHERE id = $1`, [id]);
    expect(row).toEqual({ r: true, c: "" });
  });

  it("a refusal no person can override still refuses", async () => {
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status, release_refusal)
       VALUES ($1, 'breezy:delta:1', 'Delta', 'ready', 'vendor-needs-human') RETURNING id`, [U])).id;
    expect(await decide(id, "approve")).toMatchObject({ decided_ok: false, decide_reason: "not_approvable" });
  });

  it("a packet waiting for a person keeps its Approve code when only an unattended rule now refuses it", () => {
    expect(refusalToStore("review-mode", "vendor-not-allowed")).toBe("review-mode");
    expect(refusalToStore("held-for-review", "vendor-not-allowed")).toBe("held-for-review");
  });

  // Review of S11-042: the shipped rule kept any approvable code, so a stale
  // "sender-offline" or "daily-cap" told the person it was queued for later
  // while it waited on gaps, or on a vendor taken off the auto list.
  const auto = (over: Partial<ReleaseInput>): ReleaseInput => ({
    applyMode: "auto", packetReady: true, blockerCount: 0, source: "breezy", allowedSources: ["breezy"],
    sentToday: 0, dailyCap: 10, alreadySubmitted: false, fitPct: 80, minFitPct: 50, duplicate: false,
    senderOnline: true, holdFirstN: 0, autoReleasedCount: 0, ...over,
  });
  const redecided = (previous: string, over: Partial<ReleaseInput>) => {
    const d = decideRelease(auto(over));
    if (d.release === true) throw new Error("expected a refusal");
    return refusalToStore(previous, d.code);
  };
  it.each([
    ["sender-offline", { packetReady: false, blockerCount: 2 }, "not-ready"],
    ["sender-offline", { source: "personio" }, "vendor-not-allowed"],
    ["daily-cap", { source: "personio" }, "vendor-not-allowed"],
    ["review-mode", { packetReady: false, blockerCount: 2 }, "not-ready"],
  ] as const)("a waiting %s packet re-decided with %j stores today's reason, %s", (previous, over, want) => {
    expect(redecided(previous, over)).toBe(want);
  });

  it("apply-agent stores what refusalToStore says, and the panel reads the same approvable list", () => {
    const agent = readFileSync(resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
    expect(agent).toMatch(/const stored = refusalToStore\(w\.release_refusal, decision\.code\);\s*if \(stored !== w\.release_refusal\) \{\s*await client\.from\("agent_submissions"\)\.update\(\{ release_refusal: stored \}\)/);
    const panel = readFileSync(resolve(__dirname, "../components/account/ApplyQueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/const APPROVABLE: ReadonlySet<string> = APPROVABLE_REFUSALS;/);
  });

  it("the database's approvable list is the panel's and the agent's", () => {
    const sql = migration(M_DECIDE);
    const list = /coalesce\(r\.srefusal, ''\) NOT IN \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    const codes = [...list.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    expect(codes).toEqual([...APPROVABLE_REFUSALS].sort());
  });
});

describe("S11-043: Try again puts a transiently stopped packet back on the line", () => {
  const transient = (detail: string) => JSON.stringify([{ kind: "worker", stage: "driver-error", detail, source: "breezy" }]);

  it("a packet parked blocked after its third transient refusal is claimed again", async () => {
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, attempts, blockers, error, pass_id)
       VALUES ($1, 'breezy:eps:1', 'Epsilon', 'blocked', now() - interval '1 hour', 3, $2::jsonb, 'driver error: Timeout 45000ms exceeded', $3)
       RETURNING id`, [U, transient("driver error: Timeout 45000ms exceeded"), pass])).id;
    expect(await drain()).not.toContain(id); // the bug: blocked is never claimed
    expect(await decide(id, "retry")).toMatchObject({ decided_ok: true, decide_reason: "queued_again" });
    const row = await one<{ status: string; attempts: number; b: number; error: string }>(
      `SELECT status, attempts, jsonb_array_length(blockers) AS b, error FROM agent_submissions WHERE id = $1`, [id]);
    expect(row).toEqual({ status: "ready", attempts: 0, b: 0, error: "" });
    expect(await drain()).toContain(id);
  });

  it("a packet spent at three attempts while still ready is claimed again", async () => {
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, attempts, pass_id)
       VALUES ($1, 'breezy:zeta:1', 'Zeta', 'ready', now() - interval '1 hour', 3, $2) RETURNING id`, [U, pass])).id;
    expect(await decide(id, "retry")).toMatchObject({ decided_ok: true });
    expect((await one<{ a: number }>(`SELECT attempts AS a FROM agent_submissions WHERE id = $1`, [id])).a).toBe(0);
  });

  it.each([
    ["a closed posting", "posting is closed"],
    ["a question the agent will not answer", "2 required question(s) the agent cannot answer — salary-current: not collected"],
    ["a CAPTCHA", "captcha appeared on a vendor measured clean — needs a human"],
  ])("%s is not a retry's to fix", async (_n, detail) => {
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, attempts, blockers, error)
       VALUES ($1, $2, 'Eta', 'blocked', now(), 3, $3::jsonb, $4) RETURNING id`,
      [U, `breezy:eta:${detail.length}`, JSON.stringify([{ kind: "worker", detail }]), detail])).id;
    expect(await decide(id, "retry")).toMatchObject({ decided_ok: false, decide_reason: "not_retryable" });
  });

  it("a pass that cannot pay for the send again refuses the retry rather than queueing nothing", async () => {
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, attempts, blockers, error, pass_id)
       VALUES ($1, 'breezy:theta:1', 'Theta', 'blocked', now(), 3, $2::jsonb, 'net::ERR_CONNECTION_RESET', $3) RETURNING id`,
      [U, transient("driver error: net::ERR_CONNECTION_RESET"), pass])).id;
    // The refund trigger gave it back; the pass is then spent elsewhere.
    expect((await one<{ r: boolean }>(`SELECT pass_refunded_at IS NOT NULL AS r FROM agent_submissions WHERE id = $1`, [id])).r).toBe(true);
    await db.query(`UPDATE agent_passes SET applications_used = applications_total WHERE id = $1`, [pass]);
    expect(await decide(id, "retry")).toMatchObject({ decided_ok: false, decide_reason: "not_funded" });
    await db.query(`UPDATE agent_passes SET applications_used = 3 WHERE id = $1`, [pass]);
    expect(await decide(id, "retry")).toMatchObject({ decided_ok: true });
  });

  it("the transient rule is the worker's, character for character", () => {
    const ts = readFileSync(resolve(__dirname, "../../worker/src/refusal.ts"), "utf8");
    const fn = ts.slice(ts.indexOf("export function isTransientRefusal"));
    const [yes, no] = [...fn.matchAll(/return \/(.+?)\/i\.test\(r\)|&& !\/(.+?)\/i\.test\(r\)/g)].map((m) => m[1] ?? m[2]);
    const sql = migration(M_DECIDE);
    expect(sql).toContain(`~* '${yes!.replace(/'/g, "''")}'`);
    expect(sql).toContain(`!~* '${no!.replace(/'/g, "''")}'`);
  });
});
