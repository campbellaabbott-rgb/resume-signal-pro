// @vitest-environment node
//
// Node, not jsdom: the second half executes migrations in pglite.
/**
 * A QUEUE WRAPPER IS CLOSED BY WHAT IT TOUCHES, NOT BY ITS NAME.
 *
 * WHAT WAS WRONG. Five SECURITY DEFINER functions in public wrap pgmq for the
 * edge functions: enqueue, delayed enqueue, read, delete, dead-letter. Each
 * was created with the PUBLIC-only revoke, which on Supabase removes nothing
 * (anon and authenticated hold EXECUTE directly). The 2026-07-30 lockdowns
 * then closed the family by an exact-name array -- and the array spelled four
 * of the five. The delayed enqueue, the one with a delay argument, was not in
 * it, and it is the most dangerous of them: it takes any queue name, any
 * payload, and on an unknown queue it CREATES the queue. Anyone holding the
 * publishable key could put arbitrary to/from/subject/html mail on the queue
 * that sends from the verified domain, or mint pgmq tables at will.
 *
 * An exact-name list is the defect, not just the miss: the next variant
 * (`_batch`, `_later`, `_priority`) is born open and stays open until someone
 * remembers to type it. So the fix closes the family by PROPERTY -- definer,
 * body touches pgmq -- and refuses to finish if any member is still callable
 * by anon or authenticated.
 *
 * THIS GUARD, two halves:
 *   STATIC   every definer in the migration tree whose body touches pgmq is
 *            closed to anon, by name or by a property loop, in a migration
 *            that sorts after its last definition. A future variant created
 *            after today's loop has run is NOT covered by it, and fails here.
 *   EXECUTED the real CREATE statements, the real lockdown blocks and the new
 *            migration run in pglite under Supabase's default privileges; the
 *            hole reproduces before, closes after, and the self-check raises
 *            on a variant it did not close.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DIR = resolve(__dirname, "../../supabase/migrations");
const NAMES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const RAW = new Map(NAMES.map((f) => [f, readFileSync(resolve(DIR, f), "utf8")]));
/** `--` comment lines stripped: an explanation must never satisfy the rule. */
const sqlCode = (t: string) => t.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

type Mig = { name: string; sql: string };
const TREE: Mig[] = NAMES.map((name) => ({ name, sql: sqlCode(RAW.get(name)!) }));

const TOUCHES_PGMQ = /\bpgmq(?:_public)?\./i;

/** Every SECURITY DEFINER function in public whose body touches pgmq: name -> [file, offset] of its LAST definition. */
function pgmqDefiners(tree: Mig[]): Map<string, { file: string; at: number }> {
  const out = new Map<string, { file: string; at: number }>();
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(([^)]*)\)([\s\S]*?)\bAS\s+(\$\w*\$)([\s\S]*?)\4([^;]*);/gi;
  for (const m of tree) {
    for (const d of m.sql.matchAll(re)) {
      const [, name, , head, , body, tail] = d;
      if (/SECURITY\s+DEFINER/i.test(head + tail) && TOUCHES_PGMQ.test(body)) out.set(name, { file: m.name, at: d.index! });
    }
  }
  return out;
}

/** Where each function is closed to anon: by name, by an exact-name loop, or by the pgmq property loop. */
function closures(tree: Mig[]) {
  const byName: Array<{ fn: string; file: string; at: number }> = [];
  const propertyLoops: Array<{ file: string; at: number }> = [];
  for (const m of tree) {
    for (const r of m.sql.matchAll(/REVOKE\s+(?:ALL|EXECUTE)\b[^;]*?\bON\s+FUNCTION\s+public\.(\w+)\s*\([^)]*\)\s+FROM\s+([^;]*);/gi)) {
      if (/\banon\b/i.test(r[2])) byName.push({ fn: r[1], file: m.name, at: r.index! });
    }
    for (const block of m.sql.matchAll(/DO\s+(\$\w*\$)([\s\S]*?)\1/g)) {
      const b = block[2];
      const revokesAnon = /REVOKE\s+ALL\s+ON\s+FUNCTION\s+%s\s+FROM\s+(?:PUBLIC,\s*)?anon\b/i.test(b);
      if (!revokesAnon) continue;
      for (const arr of b.matchAll(/proname\s*=\s*ANY\s*\(\s*ARRAY\s*\[([\s\S]*?)\]\s*\)/gi)) {
        for (const q of arr[1].matchAll(/'(\w+)'/g)) byName.push({ fn: q[1], file: m.name, at: block.index! });
      }
      if (/\bprosecdef\b/.test(b) && /\bprosrc\b[^;]*pgmq/i.test(b)) propertyLoops.push({ file: m.name, at: block.index! });
    }
  }
  return { byName, propertyLoops };
}

const after = (a: { file: string; at: number }, b: { file: string; at: number }) => a.file > b.file || (a.file === b.file && a.at > b.at);

/** Definers that touch pgmq and are never closed to anon after their last definition. */
function openQueueDefiners(tree: Mig[]): string[] {
  const defs = pgmqDefiners(tree);
  const { byName, propertyLoops } = closures(tree);
  const open: string[] = [];
  for (const [fn, def] of defs) {
    const named = byName.some((c) => c.fn === fn && after(c, def));
    const swept = propertyLoops.some((l) => after(l, def));
    if (!named && !swept) open.push(`${fn} (last defined in ${def.file})`);
  }
  return open.sort();
}

describe("static: every definer that touches pgmq is closed to anon", () => {
  it("finds the five wrappers the email infrastructure created (the matcher is reading the tree)", () => {
    expect([...pgmqDefiners(TREE).keys()].sort()).toEqual(
      expect.arrayContaining(["delete_email", "enqueue_email", "enqueue_email_delayed", "move_to_dlq", "read_email_batch"]),
    );
  });

  it("none is left open", () => {
    const open = openQueueDefiners(TREE);
    expect(open, `callable by anon with the publishable key:\n${open.join("\n")}`).toEqual([]);
  });

  it("teeth: a delayed-style variant created AFTER today's property loop, with the PUBLIC-only revoke, is reported", () => {
    const later: Mig = {
      name: "99999999999999_a_new_queue_variant.sql",
      sql: [
        "CREATE OR REPLACE FUNCTION public.enqueue_email_later(queue_name TEXT, payload JSONB)",
        "RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER",
        "AS $$ BEGIN RETURN pgmq.send(queue_name, payload, 3600); END; $$;",
        "REVOKE ALL ON FUNCTION public.enqueue_email_later(TEXT, JSONB) FROM PUBLIC;",
        "GRANT EXECUTE ON FUNCTION public.enqueue_email_later(TEXT, JSONB) TO service_role;",
      ].join("\n"),
    };
    expect(openQueueDefiners([...TREE, later])).toEqual(["enqueue_email_later (last defined in 99999999999999_a_new_queue_variant.sql)"]);
    const fixed: Mig = { ...later, sql: later.sql.replace("FROM PUBLIC;", "FROM PUBLIC, anon, authenticated;") };
    expect(openQueueDefiners([...TREE, fixed])).toEqual([]);
  });

  it("teeth: an exact-name array that omits a wrapper does not count as closing it", () => {
    const omitted = TREE.filter((m) => !/enqueue_email_delayed/.test(m.sql) || /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.enqueue_email_delayed/i.test(m.sql));
    expect(openQueueDefiners(omitted)).toEqual(["enqueue_email_delayed (last defined in 20260709124621_cb917d97-39d7-401d-bc3e-f7ed3eefaf74.sql)"]);
  });
});

// ---------------------------------------------------------------------------
// Executed.
// ---------------------------------------------------------------------------

const WRAPPERS = ["enqueue_email", "enqueue_email_delayed", "read_email_batch", "delete_email", "move_to_dlq"];

/** The fix, selected by DDL unique to it -- never by a phrase other migrations share. */
const FIX = NAMES.filter((f) => {
  const c = sqlCode(RAW.get(f)!);
  return /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.enqueue_email_delayed\s*\([^)]*\)\s+FROM\s+[^;]*\banon\b/i.test(c) && /\bprosrc\b/.test(c);
}).pop();

/** The last CREATE of `fn` in the tree, verbatim. */
function createOf(fn: string): string {
  for (let i = NAMES.length - 1; i >= 0; i--) {
    const raw = RAW.get(NAMES[i])!;
    const at = raw.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`));
    if (at < 0) continue;
    const open = raw.slice(at).search(/\bAS\s+\$\$/);
    const body = raw.indexOf("$$", at + open) + 2;
    const end = raw.indexOf("$$;", body);
    if (open < 0 || end < 0) throw new Error(`cannot cut the CREATE of ${fn} out of ${NAMES[i]}`);
    return raw.slice(at, end + 3);
  }
  throw new Error(`no migration creates ${fn}`);
}

/** Every REVOKE/GRANT statement on a wrapper, from the files that created them, in tree order. */
function originalGrants(): string {
  const out: string[] = [];
  for (const f of NAMES) {
    if (f >= "20260710") break;
    for (const line of sqlCode(RAW.get(f)!).split("\n")) {
      if (new RegExp(`^(REVOKE|GRANT)\\b.*ON FUNCTION public\\.(${WRAPPERS.join("|")})\\(`).test(line.trim())) out.push(line.trim());
    }
  }
  return out.join("\n");
}

/** The exact-name lockdown loops of 2026-07-30, verbatim. */
function lockdownLoops(): string {
  return ["20260730070000_definer_lockdown.sql", "20260730224753_60c37950-4380-4a9f-9299-5a53619a0c05.sql"]
    .map((f) => [...RAW.get(f)!.matchAll(/DO \$do\$[\s\S]*?\$do\$;/g)].map((m) => m[0]).filter((b) => /proname = ANY/.test(b)).join("\n"))
    .join("\n");
}

const STUB_PGMQ = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  -- Supabase's own default: new functions in public are executable by the API roles directly.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA pgmq;
  CREATE TABLE pgmq.sent (q text, msg jsonb, delay int);
  CREATE FUNCTION pgmq.send(q text, m jsonb, d int DEFAULT 0) RETURNS bigint LANGUAGE sql AS 'INSERT INTO pgmq.sent VALUES (q, m, d) RETURNING 1';
  CREATE FUNCTION pgmq.create(q text) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
  CREATE FUNCTION pgmq.read(q text, vt int, n int) RETURNS TABLE(msg_id bigint, read_ct int, message jsonb) LANGUAGE sql AS 'SELECT 1::bigint, 1, NULL::jsonb WHERE false';
  CREATE FUNCTION pgmq.delete(q text, id bigint) RETURNS boolean LANGUAGE sql AS 'SELECT true';
`;

const can = async (db: PGlite, role: string, fn: string) =>
  ((await db.query<{ ok: boolean }>(`SELECT bool_or(has_function_privilege('${role}', p.oid, 'EXECUTE')) AS ok FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [fn])).rows[0]?.ok) ?? false;

const exposure = async (db: PGlite) =>
  (await db.query<{ e: Record<string, number> }>("SELECT public.queue_wrapper_exposure() AS e")).rows[0]?.e;

describe("executed: the hole reproduces on the old tree and closes with the fix", () => {
  let db: PGlite;
  const before: Record<string, boolean> = {};
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(STUB_PGMQ);
    for (const fn of WRAPPERS) await db.exec(createOf(fn));
    await db.exec(originalGrants());
    await db.exec(lockdownLoops());
    for (const fn of WRAPPERS) before[fn] = await can(db, "anon", fn);
  }, 60_000);
  afterAll(async () => { await db?.close(); });

  it("before the fix: the exact-name lockdown closed four wrappers and left the delayed enqueue open to anon", () => {
    expect(before).toEqual({ enqueue_email: false, enqueue_email_delayed: true, read_email_batch: false, delete_email: false, move_to_dlq: false });
  });

  it("the fix exists and is selected by its own DDL", () => {
    expect(FIX, "no migration revokes the delayed enqueue from anon by name beside a pgmq property loop").toBeTruthy();
  });

  it("after the fix: no wrapper is executable by anon or authenticated, and service_role keeps every one", async () => {
    await db.exec(RAW.get(FIX!)!);
    for (const fn of WRAPPERS) {
      expect(await can(db, "anon", fn), `${fn} still executable by anon`).toBe(false);
      expect(await can(db, "authenticated", fn), `${fn} still executable by authenticated`).toBe(false);
      expect(await can(db, "service_role", fn), `${fn} lost its service_role grant -- send-scan-report and the queue worker would break`).toBe(true);
    }
  });

  it("the deploy probe reads the same state, and anon may call it", async () => {
    expect(await exposure(db)).toEqual({ definers: 5, open_to_clients: 0 });
    expect(await can(db, "anon", "queue_wrapper_exposure"), "verify-deploy reads it with the publishable key").toBe(true);
    const def = (await db.query<{ prosecdef: boolean }>("SELECT prosecdef FROM pg_proc WHERE proname = 'queue_wrapper_exposure'")).rows[0];
    expect(def?.prosecdef, "the probe must run with the caller's rights, not as a definer").toBe(false);
  });

  it("the property loop closes a variant nobody named, and the self-check raises on one left open", async () => {
    const variant = "CREATE FUNCTION public.enqueue_email_later(queue_name text, payload jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN pgmq.send(queue_name, payload, 3600); END; $$;";
    await db.exec(variant);
    expect(await can(db, "anon", "enqueue_email_later"), "default privileges make a new function anon-executable").toBe(true);
    // Re-running the whole migration closes it by property ...
    await db.exec(RAW.get(FIX!)!);
    expect(await can(db, "anon", "enqueue_email_later")).toBe(false);
    // ... and the self-check alone, against a variant re-opened by hand, refuses,
    // while the deploy probe counts it.
    await db.exec("GRANT EXECUTE ON FUNCTION public.enqueue_email_later(text, jsonb) TO authenticated;");
    expect(await exposure(db)).toEqual({ definers: 6, open_to_clients: 1 });
    const check = [...RAW.get(FIX!)!.matchAll(/DO (\$\w+\$)[\s\S]*?\1;/g)].map((m) => m[0]).filter((b) => /has_function_privilege/.test(b)).pop();
    expect(check, "the migration carries no self-check block").toBeTruthy();
    await expect(db.exec(check!)).rejects.toThrow(/enqueue_email_later/);
  });
});
