/**
 * A pglite database holding what migration 20261112160000 (the mailing lists
 * forget what they no longer need; the pulse goes once a calendar month) meets
 * in production: the mail door (20261004100000, with a stand-in pg_cron), the
 * pulse's language column (20261103191000) and the send log, all under
 * Supabase's default privileges (every new table and function in public is
 * granted to anon and authenticated unless a migration revokes it) -- then
 * the file itself, self-check included.
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { bootMailDoorDb } from "./mail-door-db";

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");

/** A migration's text, by its stamp prefix ("20261112160000_"). */
export const migrationText = (prefix: string): string =>
  readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(prefix))!), "utf8");

export const MAIL_LISTS_PREFIX = "20261112160000_";

/** Supabase's default privileges for objects the migrations create in public. */
export const SUPABASE_DEFAULT_GRANTS = `
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`;

export async function bootMailListsDb(): Promise<PGlite> {
  const db = await bootMailDoorDb({ cron: true });
  await db.exec(SUPABASE_DEFAULT_GRANTS);
  // RLS as 20260702130000 left the pulse table; the send log as
  // 20260702190811 made it (the columns the prune reads).
  await db.exec(`
    ALTER TABLE public.market_pulse_subscribers ENABLE ROW LEVEL SECURITY;
    CREATE TABLE IF NOT EXISTS public.email_send_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id text, template_name text NOT NULL,
      recipient_email text NOT NULL, status text NOT NULL, error_message text, metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.exec(migrationText("20261103191000_"));
  await db.exec(migrationText(MAIL_LISTS_PREFIX));
  return db;
}
