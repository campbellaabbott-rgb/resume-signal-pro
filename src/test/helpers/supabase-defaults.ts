/**
 * THE CLIENT ROLES AS SUPABASE MAKES THEM, FOR A PGLITE HARNESS.
 *
 * A harness that only says CREATE ROLE anon gets a role that holds nothing:
 * every table it then creates refuses anon and authenticated, whatever the
 * migration under test does. Production is the other way round. Supabase's
 * default privileges grant ALL on every table, function and sequence created
 * in public to anon, authenticated and service_role, so a table is closed to
 * the publishable key only because a migration said REVOKE, and a function is
 * closed only by a REVOKE that names the client roles (PUBLIC alone leaves
 * their own grant in place).
 *
 * On bare roles a test that expects "permission denied" passes with the
 * REVOKE deleted: checkout_resume_refs read as closed in pglite with its
 * REVOKE gone (S14X-140). Started from these defaults, the same test fails
 * the moment the REVOKE is missing, which is the only way it can prove one.
 *
 * Use it where the roles were created:
 *   await db.exec(SUPABASE_DEFAULTS);
 * or inside the SQL that sets the stand-ins up:
 *   `${SUPABASE_DEFAULTS} CREATE TABLE public.x (...);`
 *
 * service_role bypasses row level security, as it does on Supabase. The roles
 * cannot log in and do not inherit, as on Supabase; a harness reaches them
 * with SET ROLE.
 */
export const SUPABASE_DEFAULTS = `
  CREATE ROLE anon NOLOGIN NOINHERIT;
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`;
