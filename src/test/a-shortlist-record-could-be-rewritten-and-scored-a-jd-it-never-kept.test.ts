// @vitest-environment node
/**
 * A SHORTLIST RECORD COULD BE REWRITTEN, AND SCORED A JD IT NEVER KEPT
 * (sweep S8-041, S8-110; migrations 20261009111000 and 20261009112000).
 *
 * The "immutable" evaluation COMPLIANCE.md sells as LL144/FEHA evidence sat
 * under a table-wide INSERT and UPDATE grant to authenticated with owner-only
 * policies and no trigger: an employer could rewrite score or signals, insert
 * an evaluation no model produced, and change status with no decision row.
 * And jd_version, the only link from a score to its JD, never moved when the
 * JD was edited.
 *
 * In a real Postgres (pglite) with the production grants and policies
 * (20260704160023's Shortlist statements), as the signed-in owner through
 * SET ROLE authenticated: TEETH first (without the migration each of these
 * writes lands), then the same writes refused with it, shortlist_decide
 * writing the decision and the status together, and jd_version following
 * jd_text.
 *
 * THE DEPLOY WINDOW (register S11-056). The file used to revoke client INSERT
 * in the same migration that added what the new function needs, and the
 * ledger applies migrations first: the LIVE shortlist-evaluate inserts its
 * evaluation through the employer's JWT after a paid model call, and the live
 * page logs a decision and PATCHes the status in two calls, so both failed
 * with 42501 for the whole window. Now 20261009111000 is additive only (the
 * new function's column, shortlist_decide, the server's jd_version), and the
 * lockdown is 20261009112000, held until the new function and page serve.
 * With 111000 alone, the old function's and the old page's writes still land.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => readFileSync(resolve(MIG, readdirSync(MIG).find((f) => f.startsWith(prefix))!), "utf8");
const THIS = file("20261009111000_");
const LOCKDOWN = file("20261009112000_");
/** Production's Shortlist tables, grants and policies, as 20260704160023 left them. */
const BASE = sqlCodeOf(file("20260704160023_"))
  .split(/;\s*\n/)
  .filter((s) => /public\.shortlist_/.test(s))
  .map((s) => `${s};`)
  .join("\n");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) await db.close().catch(() => {}); });

/** "none": production before wave 3; "additive": 111000 alone (the deploy window); "both": after the held half. */
async function boot(withMigration: boolean | "additive") {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT SELECT ON auth.users TO authenticated;
    INSERT INTO auth.users VALUES ('${A}', 'a@employer.test'), ('${B}', 'b@other.test');
  `);
  await db.exec(BASE);
  if (withMigration) await db.exec(THIS);
  if (withMigration === true) await db.exec(LOCKDOWN);
  const role = await db.query<{ id: string }>(`INSERT INTO public.shortlist_roles (owner_id, title, jd_text) VALUES ($1, 'Data Engineer', 'Airflow, dbt and Snowflake for five years.') RETURNING id`, [A]);
  const cand = await db.query<{ id: string }>(
    `INSERT INTO public.shortlist_candidates (role_id, owner_id, score, signals, redacted_text) VALUES ($1, $2, 58, '[]', 'redacted') RETURNING id`,
    [role.rows[0].id, A],
  );
  return { db, roleId: role.rows[0].id, candId: cand.rows[0].id };
}

/** Runs `sql` as the signed-in user `uid` (PostgREST's SET ROLE + claims), in one transaction. */
async function as(db: PGlite, uid: string, sql: string, params: unknown[] = []) {
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [
        uid, JSON.stringify({ sub: uid, role: "authenticated", email: uid === A ? "a@employer.test" : "b@other.test" }),
      ]);
      return (await tx.query<Record<string, unknown>>(sql, params)).rows;
    });
    return { rows, error: null as string | null };
  } catch (e) {
    return { rows: [] as Record<string, unknown>[], error: String((e as Error).message) };
  }
}

const one = async (db: PGlite, sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows[0];

describe("without the migration (teeth)", () => {
  it("an owner rewrites the AI score, changes status with no decision, inserts an evaluation, and the JD version never moves", async () => {
    const { db, roleId, candId } = await boot(false);
    expect((await as(db, A, `UPDATE public.shortlist_candidates SET score = 99 WHERE id = $1`, [candId])).error).toBeNull();
    expect((await as(db, A, `UPDATE public.shortlist_candidates SET status = 'advanced' WHERE id = $1`, [candId])).error).toBeNull();
    expect((await as(db, A, `INSERT INTO public.shortlist_candidates (role_id, owner_id, score) VALUES ($1, $2, 100)`, [roleId, A])).error).toBeNull();
    await as(db, A, `UPDATE public.shortlist_roles SET jd_text = 'A different job entirely, rewritten.' WHERE id = $1`, [roleId]);
    expect((await one(db, `SELECT jd_version FROM public.shortlist_roles WHERE id = $1`, [roleId])).jd_version).toBe(1);
  });
});

describe("the decision log (teeth, then with both halves)", () => {
  const forge = `INSERT INTO public.shortlist_decisions (candidate_id, owner_id, actor_email, action, old_value, new_value, created_at)
                 VALUES ($1, $2, 'ceo@employer.test', 'reject', 'pending', 'rejected', '2020-01-02T00:00:00Z')`;

  it("without it, an owner backdates a reject that never changed a status, under another actor's name", async () => {
    const { db, candId } = await boot(false);
    expect((await as(db, A, forge, [candId, A])).error).toBeNull();
    const row = await one(db, `SELECT actor_email, created_at < '2021-01-01' AS backdated FROM public.shortlist_decisions WHERE candidate_id = $1`, [candId]);
    expect(row).toEqual({ actor_email: "ceo@employer.test", backdated: true });
    expect((await one(db, `SELECT status FROM public.shortlist_candidates WHERE id = $1`, [candId])).status).toBe("pending");
  });

  it("with it, a direct advance or reject is refused, and any other row carries the server's clock and the caller's own address", async () => {
    const { db, candId } = await boot(true);
    expect((await as(db, A, forge, [candId, A])).error).toMatch(/through shortlist_decide/);
    const note = await as(db, A, `INSERT INTO public.shortlist_decisions (candidate_id, owner_id, actor_email, action, new_value, created_at)
                                   VALUES ($1, $2, 'ceo@employer.test', 'override_score', '90', '2020-01-02T00:00:00Z')`, [candId, A]);
    expect(note.error).toBeNull();
    const row = await one(db, `SELECT actor_email, created_at > now() - interval '1 hour' AS fresh FROM public.shortlist_decisions WHERE candidate_id = $1`, [candId]);
    expect(row).toEqual({ actor_email: "a@employer.test", fresh: true });
    // shortlist_decide still logs its own advance, and the switch does not outlive it.
    expect((await as(db, A, `SELECT public.shortlist_decide($1, 'advance', 'ok')`, [candId])).error).toBeNull();
    const after = await as(db, A, `DO $$ BEGIN PERFORM public.shortlist_decide('${candId}', 'advance', 'ok'); ${forge.replace("$1", `'${candId}'`).replace("$2", `'${A}'`)}; END $$`);
    expect(after.error).toMatch(/through shortlist_decide/);
  });
});

describe("with 20261009111000 alone: the deploy window (S11-056)", () => {
  it("the LIVE shortlist-evaluate's insert through the employer's JWT still lands", async () => {
    const { db, roleId } = await boot("additive");
    const r = await as(db, A, `INSERT INTO public.shortlist_candidates (role_id, owner_id, score, signals, redacted_text) VALUES ($1, $2, 64, '[]', 'redacted') RETURNING id`, [roleId, A]);
    expect(r.error).toBeNull();
    expect(r.rows).toHaveLength(1);
  });

  it("the LIVE page's decision insert and its separate status PATCH still land", async () => {
    const { db, candId } = await boot("additive");
    expect((await as(db, A, `INSERT INTO public.shortlist_decisions (candidate_id, owner_id, action, old_value, new_value, reason) VALUES ($1, $2, 'reject', 'pending', 'rejected', 'Not a fit')`, [candId, A])).error).toBeNull();
    expect((await as(db, A, `UPDATE public.shortlist_candidates SET status = 'rejected' WHERE id = $1`, [candId])).error).toBeNull();
    expect((await one(db, `SELECT status FROM public.shortlist_candidates WHERE id = $1`, [candId])).status).toBe("rejected");
  });

  it("the NEW page's shortlist_decide and the NEW function's jd_text_scored already work", async () => {
    const { db, roleId, candId } = await boot("additive");
    const r = await as(db, A, `SELECT public.shortlist_decide($1, 'advance', 'Strong Airflow work') AS v`, [candId]);
    expect(r.error).toBeNull();
    expect((await one(db, `SELECT status FROM public.shortlist_candidates WHERE id = $1`, [candId])).status).toBe("advanced");
    await db.exec(`SET ROLE service_role`);
    await db.query(`INSERT INTO public.shortlist_candidates (role_id, owner_id, score, jd_version, jd_text_scored) VALUES ($1, $2, 71, 1, 'Airflow')`, [roleId, A]);
    await db.exec(`RESET ROLE`);
    expect((await one(db, `SELECT count(*)::int AS n FROM public.shortlist_candidates WHERE jd_text_scored IS NOT NULL`)).n).toBe(1);
  });

  it("the additive half re-runs, and the lockdown refuses to land without it", async () => {
    const { db } = await boot("additive");
    await expect(db.exec(THIS)).resolves.toBeDefined();
    const bare = new PGlite();
    OPEN.push(bare);
    await bare.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
    await bare.exec(BASE);
    await expect(bare.exec(LOCKDOWN)).rejects.toThrow(/apply 20261009111000 first/);
  });
});

// Wave 3 verified on 2026-10-11 and the hold was released: from then on the
// same condition is a migrationOrder rule, so a message can still never put
// the lockdown ahead of the function whose insert it would refuse.
describe("the lockdown waits for the new function and page, held or released (S11-056)", () => {
  type Ledger = {
    holdUntilVerified: Array<{ stamp: string; until: string }>;
    migrationOrder: Record<string, { after?: string; before?: string[]; why?: string }>;
  };
  const ledger = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8")) as Ledger;

  it("docs/deploy-ledger.json holds 20261009112000, or orders it after shortlist-evaluate .2026-10-10.62, naming shortlist_decide", async () => {
    const { buildAtLeast } = await import("../../scripts/deploy-ledger.mjs");
    const hold = ledger.holdUntilVerified.find((h) => h.stamp === "20261009112000");
    const rule = ledger.migrationOrder["20261009112000"];
    expect(hold || rule, "20261009112000 is neither held nor ordered").toBeTruthy();
    if (hold) {
      expect(hold.until).toMatch(/shortlist-evaluate\.2026-10-\d\d\.\d+/);
      expect(hold.until).toMatch(/shortlist_decide/);
      return;
    }
    const after = /^fn:shortlist-evaluate@(\d{4}-\d{2}-\d{2}\.\d+)$/.exec(rule!.after ?? "");
    expect(after, `after "${rule!.after}" does not name shortlist-evaluate`).toBeTruthy();
    expect(buildAtLeast(`shortlist-evaluate.${after![1]}`, "shortlist-evaluate.2026-10-10.62")).toBe(true);
    expect(rule!.why).toMatch(/shortlist_decide/);
  });

  it("the additive half is neither held nor made to wait for the function it must precede", () => {
    expect(ledger.holdUntilVerified.some((h) => h.stamp === "20261009111000"), "the additive half must not be held").toBe(false);
    expect(ledger.migrationOrder["20261009111000"]?.after).toBeUndefined();
    expect(ledger.migrationOrder["20261009111000"]?.before).toContain("fn:shortlist-evaluate");
  });
});

describe("with 20261009111000 and 20261009112000", () => {
  it("an owner cannot rewrite an AI column, insert an evaluation, or change status without its decision", async () => {
    const { db, roleId, candId } = await boot(true);
    expect((await as(db, A, `UPDATE public.shortlist_candidates SET score = 99 WHERE id = $1`, [candId])).error).toMatch(/permission denied/);
    expect((await as(db, A, `INSERT INTO public.shortlist_candidates (role_id, owner_id, score) VALUES ($1, $2, 100)`, [roleId, A])).error).toMatch(/permission denied/);
    expect((await as(db, A, `UPDATE public.shortlist_candidates SET status = 'advanced' WHERE id = $1`, [candId])).error).toMatch(/logged decision/);
    // A decision logged in one request and a status set in another are two transactions: still refused.
    await as(db, A, `INSERT INTO public.shortlist_decisions (candidate_id, owner_id, action, old_value, new_value) VALUES ($1, $2, 'advance', 'pending', 'advanced')`, [candId, A]);
    expect((await as(db, A, `UPDATE public.shortlist_candidates SET status = 'advanced' WHERE id = $1`, [candId])).error).toMatch(/logged decision/);
    const row = await one(db, `SELECT score, status FROM public.shortlist_candidates WHERE id = $1`, [candId]);
    expect(row).toEqual({ score: 58, status: "pending" });
  });

  it("shortlist_decide writes the decision and the status in one transaction, as the caller", async () => {
    const { db, candId } = await boot(true);
    const r = await as(db, A, `SELECT public.shortlist_decide($1, 'advance', 'Strong Airflow work') AS v`, [candId]);
    expect(r.error).toBeNull();
    expect((r.rows[0].v as { status: string }).status).toBe("advanced");
    expect((await one(db, `SELECT status FROM public.shortlist_candidates WHERE id = $1`, [candId])).status).toBe("advanced");
    const log = (await db.query(`SELECT action, old_value, new_value, reason, actor_email, owner_id::text FROM public.shortlist_decisions WHERE candidate_id = $1`, [candId])).rows;
    expect(log).toEqual([{ action: "advance", old_value: "pending", new_value: "advanced", reason: "Strong Airflow work", actor_email: "a@employer.test", owner_id: A }]);
  });

  it("a reject without a reason raises what the page shows, and writes nothing", async () => {
    const { db, candId } = await boot(true);
    const r = await as(db, A, `SELECT public.shortlist_decide($1, 'reject', ' ')`, [candId]);
    expect(r.error).toMatch(/reason is required/);
    expect((await one(db, `SELECT count(*)::int AS n FROM public.shortlist_decisions`)).n).toBe(0);
    expect((await one(db, `SELECT status FROM public.shortlist_candidates WHERE id = $1`, [candId])).status).toBe("pending");
  });

  it("another employer can neither decide nor log a decision against someone else's candidate", async () => {
    const { db, candId } = await boot(true);
    expect((await as(db, B, `SELECT public.shortlist_decide($1, 'advance', 'x')`, [candId])).error).toMatch(/not found/);
    const forged = await as(db, B, `INSERT INTO public.shortlist_decisions (candidate_id, owner_id, action) VALUES ($1, $2, 'note')`, [candId, B]);
    expect(forged.error).toMatch(/row-level security/);
  });

  it("jd_version is the server's: +1 when the JD text changes, unmoved otherwise, never what the client sends", async () => {
    const { db, roleId } = await boot(true);
    const v = async () => (await one(db, `SELECT jd_version FROM public.shortlist_roles WHERE id = $1`, [roleId])).jd_version;
    await as(db, A, `UPDATE public.shortlist_roles SET jd_text = 'Airflow, dbt, Snowflake and Kafka for five years.' WHERE id = $1`, [roleId]);
    expect(await v()).toBe(2);
    await as(db, A, `UPDATE public.shortlist_roles SET title = 'Senior Data Engineer' WHERE id = $1`, [roleId]);
    expect(await v()).toBe(2);
    await as(db, A, `UPDATE public.shortlist_roles SET jd_version = 99 WHERE id = $1`, [roleId]);
    expect(await v()).toBe(2);
    const made = await as(db, A, `INSERT INTO public.shortlist_roles (owner_id, title, jd_text, jd_version) VALUES ($1, 'Analyst', 'SQL and dashboards for three years.', 7) RETURNING jd_version`, [A]);
    expect(made.rows[0].jd_version).toBe(1);
  });

  it("the service role still writes an evaluation, with the JD text it scored; and the file re-runs", async () => {
    const { db, roleId } = await boot(true);
    await db.exec(`SET ROLE service_role`);
    await db.query(`INSERT INTO public.shortlist_candidates (role_id, owner_id, score, jd_version, jd_text_scored) VALUES ($1, $2, 71, 1, 'Airflow, dbt and Snowflake for five years.')`, [roleId, A]);
    await db.exec(`RESET ROLE`);
    expect((await one(db, `SELECT count(*)::int AS n FROM public.shortlist_candidates WHERE jd_text_scored IS NOT NULL`)).n).toBe(1);
    await expect(db.exec(THIS)).resolves.toBeDefined();
    await expect(db.exec(LOCKDOWN)).resolves.toBeDefined();
  });
});
