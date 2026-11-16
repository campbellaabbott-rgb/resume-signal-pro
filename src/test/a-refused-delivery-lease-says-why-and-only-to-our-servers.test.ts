// @vitest-environment node
/**
 * A REFUSED DELIVERY LEASE SAYS WHY, AND ONLY TO OUR SERVERS (S14X-111).
 *
 * take_delivery_lease answered NULL for a closed order and for one another
 * maker holds alike, so the verifier told a buyer whose order was closed with
 * no copy that it was still being made. take_delivery_lease_status
 * (20261112151000) takes the same lock and lease and says which refusal it
 * was. It is service-role only: an order's state is nobody else's to read.
 *
 * Run against Postgres (pglite) from Supabase's default grants, with the
 * migration (self-check included) applied twice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => {
  const name = readdirSync(DIR).find((f) => f.startsWith(prefix));
  if (!name) throw new Error(`no migration starts with ${prefix}`);
  return readFileSync(resolve(DIR, name), "utf8");
};

let db: PGlite;
const SID = "cs_live_lease_status";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE TABLE public.product_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
      stripe_session_id text NOT NULL, customer_email text, product_type text NOT NULL, status text NOT NULL DEFAULT 'payment_received',
      content_generation_started_at timestamptz, email_sent_at timestamptz, lease_token uuid, lease_until timestamptz);
  `);
  await db.exec(file("20261112151000_"));
  await db.exec(file("20261112151000_"));
}, 120_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => { await db.exec("TRUNCATE public.product_deliveries"); });

const take = async (seen: string, sid = SID) =>
  (await db.query<{ token: string | null; refusal: string | null }>("SELECT * FROM public.take_delivery_lease_status($1, $2)", [sid, seen])).rows[0];
const order = (status: string, extra = "") =>
  db.query(`INSERT INTO public.product_deliveries (stripe_session_id, product_type, status${extra ? ", " + extra.split("=")[0] : ""}) VALUES ($1, 'career_snapshot', $2${extra ? ", " + extra.split("=")[1] : ""})`, [SID, status]);

describe("take_delivery_lease_status", () => {
  it("leases an open order and says nothing is wrong", async () => {
    await order("payment_received");
    const r = await take("payment_received");
    expect(r.refusal).toBeNull();
    expect(r.token).toMatch(/^[0-9a-f-]{36}$/);
    const row = (await db.query<{ status: string; lease_token: string }>("SELECT status, lease_token::text FROM public.product_deliveries")).rows[0];
    expect(row).toEqual({ status: "generating", lease_token: r.token });
  });

  it("creates and leases an order nobody wrote yet", async () => {
    const r = await take("payment_received", "cs_live_no_row_yet");
    expect(r.refusal).toBeNull();
    expect(r.token).toBeTruthy();
  });

  it.each([
    ["refunded", "", "closed_refunded"],
    ["delivered", "", "closed_delivered"],
    ["content_generated", "email_sent_at=now()", "closed_mailed"],
  ])("a %s order is refused as %s, with no token, and is left as it was", async (status, extra, want) => {
    await order(status, extra);
    const r = await take(status);
    expect(r).toEqual({ token: null, refusal: want });
    expect((await db.query<{ status: string }>("SELECT status FROM public.product_deliveries")).rows[0].status).toBe(status);
  });

  it("an order that moved since it was read is refused as moved", async () => {
    await order("generation_failed");
    expect(await take("payment_received")).toEqual({ token: null, refusal: "moved" });
  });

  it("an order another maker holds is refused as leased", async () => {
    await order("payment_received");
    await take("payment_received");
    expect(await take("generating")).toEqual({ token: null, refusal: "leased" });
  });

  it("is refused to anon and authenticated (42501), and runs for the service role", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.query("SELECT * FROM public.take_delivery_lease_status($1, 'payment_received')", [SID])).rejects.toMatchObject({ code: "42501" });
      await db.exec("RESET ROLE");
    }
    await db.exec("SET ROLE service_role");
    try {
      expect((await take("payment_received")).refusal).toBeNull();
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});
