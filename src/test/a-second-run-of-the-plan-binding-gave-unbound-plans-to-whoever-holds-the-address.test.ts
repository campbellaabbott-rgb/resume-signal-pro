// @vitest-environment node
//
// Node, not jsdom: the migration runs in pglite.
/**
 * A SECOND RUN OF THE PLAN BINDING GAVE UNBOUND PLANS TO WHOEVER HOLDS THE
 * ADDRESS.
 *
 * WHAT WAS WRONG (review of 20261008130000). The file binds every
 * pro_subscribers row with no user_id to the account that holds its address.
 * That is right once, in the run that adds the column: it is what every gate
 * already served. After it, an unbound row is deliberate -- a plan made in the
 * Stripe dashboard without metadata.user_id, or one on an address whose
 * password account has not proven the mailbox -- and the binding had no
 * one-time guard, so a re-run (the staged runner re-stages files) handed each
 * such plan to whoever had registered its address, the hole the file closes,
 * and its own self-check then passed. The deploy note said it was safe to
 * re-run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, migration } from "./helpers/agent-db";

const M = "20261008130000_a_plan_is_read_by_the_account_that_bought_it_by_one_rule.sql";
const PAYER = "00000000-0000-4000-8000-00000000f101";
const SQUATTER = "00000000-0000-4000-8000-00000000f102";

let db: PGlite;
const boundTo = async (email: string) =>
  (await db.query<{ user_id: string | null }>(`SELECT user_id::text FROM public.pro_subscribers WHERE email = '${email}'`)).rows[0]?.user_id ?? null;

beforeAll(async () => {
  db = await agentDb({
    seed: `
      CREATE TABLE public.pro_subscribers (
        email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
        current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.pro_grants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
        product_type text, credits integer, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO auth.users (id, email) VALUES ('${PAYER}', 'payer@example.com'), ('${SQUATTER}', 'dashboard-plan@example.com');
      INSERT INTO public.pro_subscribers (email, status, current_period_end) VALUES ('payer@example.com', 'active', now() + interval '20 days');`,
  });
  await db.exec(migration(M));
}, 240_000);

afterAll(async () => { await db?.close(); });

describe("the plan binding runs once, in the run that adds the column", () => {
  it("binds a plan that existed before the file to the account holding its address", async () => {
    expect(await boundTo("payer@example.com")).toBe(PAYER);
  });

  it("a re-run leaves a plan made since without an account unbound, and does not refuse to run", async () => {
    // Made in the Stripe dashboard with no metadata.user_id; someone has
    // registered its address with a password and proven nothing.
    await db.exec(`INSERT INTO public.pro_subscribers (email, status, current_period_end) VALUES ('dashboard-plan@example.com', 'active', now() + interval '20 days')`);
    await db.exec(migration(M));
    expect(await boundTo("dashboard-plan@example.com")).toBeNull();
    expect(await boundTo("payer@example.com")).toBe(PAYER);
  });
});
