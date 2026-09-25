// @vitest-environment node
/**
 * THE QUARTER LOAD CAN RECORD THAT IT RAN.
 *
 * WHAT THIS GUARDS. public.layoff_read_log is the ledger the heartbeat reads
 * instead of the function logs, and its kind column is barred to a fixed list.
 * The layoff-filings function grew one more run to record -- the once-a-quarter
 * load of the certified H-1B wage cells the deploy carries into
 * public.oflc_lca_wages -- and a kind the bar does not admit is a row that
 * never lands.
 *
 * WHY IT MATTERS MORE HERE THAN FOR A POLLER. The load is a single manual POST
 * after a deploy, it replaces a whole quarter, and this row is the only durable
 * record that it ran, how many cells it wrote and which quarter they came from.
 * The function swallows a failed log insert on purpose -- a broken ledger must
 * never fail a load that already succeeded -- so a refused row would leave the
 * load looking fine and leaving no trace at all.
 *
 * WHY IT IS BEHAVIOURAL. The lane-A table is created in a real Postgres
 * (pglite) from its own migration, the bar is shown refusing the new kind
 * BEFORE the widening is applied, the widening is applied, and the row is then
 * inserted for real. A regex over the SQL would pass on a migration whose
 * statement never ran.
 *
 * TEETH. Three mutations, each breaking exactly one property: the widening cut
 * out (the migration's own self-check must raise and name the missing kind), a
 * widening that admits the new kind but drops one the poller already writes
 * (the second self-check must raise), and a widening applied twice (one
 * constraint, not two). The sealed original must pass all three afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const read = (name: string) => readFileSync(resolve(MIGRATIONS, name), "utf8");

/** Lane A created the ledger; this lane widens its bar. Both are pinned by stamp so the test names what it applied. */
const LANE_A = files.find((n) => n.startsWith("20260918100000"))!;
const WIDENING = files.find((n) => n.startsWith("20260925141127"))!;
const WIDENING_SQL = read(WIDENING);

/** The kind the wage load writes, and the ones that must survive the rewrite. */
const NEW_KIND = "lca_wages";
const EXISTING_KINDS = ["edgar_atom", "edgar_fts_audit", "edgar_backfill", "warn", "matcher", "partition", "mirror"];

/** The lane-A CREATE TABLE, lifted from its own migration so the bar being widened is the real one. */
function readLogDdl(): string {
  const sql = sqlCodeOf(read(LANE_A));
  const m = /CREATE TABLE IF NOT EXISTS public\.layoff_read_log \([\s\S]*?\);/.exec(sql);
  if (!m) throw new Error("lane A's read-log DDL not found");
  return m[0];
}

/** A database holding just the ledger, before any widening. */
async function freshLedger(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readLogDdl());
  return db;
}

/**
 * Booting a WASM Postgres is seconds, not milliseconds, and each check below
 * that has teeth boots its own. Under vitest's default five-second budget these
 * fail as TIMEOUTS whenever several suites are being run at once and the
 * workers are competing for the machine -- a red gate that says nothing about
 * the property. The budget is stated here instead, generously: a check that
 * takes half a minute has hung, and one that takes six seconds on a busy
 * machine has not.
 */
const BOOT_MS = 30_000;

describe("the migration is this lane's, and it is new", () => {
  it("exists under its own stamp and edits no applied migration", () => {
    expect(WIDENING).toBeDefined();
    expect(WIDENING).toMatch(/^20260925141127_/);
    // A stamp that collides with another migration is applied in an order
    // nobody chose; the runner has staged edited migrations under other names
    // here before.
    expect(files.filter((n) => n.slice(0, 14) === WIDENING.slice(0, 14))).toHaveLength(1);
  });
});

describe("the read log admits the wage load (pglite)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshLedger();
    // The bar refuses the kind before the widening: without this the test
    // below would pass on a database that never needed the migration.
    await expect(db.query(`INSERT INTO public.layoff_read_log (kind, ok) VALUES ('${NEW_KIND}', true)`)).rejects.toThrow(/check/i);
    await db.exec(WIDENING_SQL);
  }, BOOT_MS);
  afterAll(async () => { await db?.close(); });

  it("takes the wage-load row the function writes, with the counts and the quarter in its note", async () => {
    await db.query(
      "INSERT INTO public.layoff_read_log (kind, fetched, kept, new_rows, ok, ms, note) VALUES ($1, 5536, 5536, 5536, true, 4200, $2)",
      [NEW_KIND, "quarter=FY2026 Q3; published=2026-08-07; pruned=0; chunks=6/6; tokens=1442"],
    );
    const { rows } = await db.query<{ n: number; kept: number }>(
      `SELECT count(*)::int AS n, max(kept)::int AS kept FROM public.layoff_read_log WHERE kind = '${NEW_KIND}'`,
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].kept).toBe(5536);
  });

  it("still refuses a kind nobody writes, and still takes every kind written before", async () => {
    await expect(db.query("INSERT INTO public.layoff_read_log (kind, ok) VALUES ('bogus', true)")).rejects.toThrow(/check/i);
    for (const k of EXISTING_KINDS) {
      await db.query("INSERT INTO public.layoff_read_log (kind, ok) VALUES ($1, true)", [k]);
    }
    const { rows } = await db.query<{ n: number }>("SELECT count(DISTINCT kind)::int AS n FROM public.layoff_read_log");
    expect(rows[0].n).toBe(EXISTING_KINDS.length + 1);
  });

  it("leaves an unrelated rule about the same column alone, however often it is applied", async () => {
    // WHY THE DROP IS NARROW. The widening used to drop every check on this
    // table whose definition merely CONTAINED the column name, which was safe
    // only by the accident that there was exactly one. This file is
    // deliberately re-appliable, so a later rule -- a note required on one
    // kind, a bound on another column that names this one -- would have been
    // deleted silently on every deploy that re-ran it.
    await db.exec(`ALTER TABLE public.layoff_read_log
      ADD CONSTRAINT layoff_read_log_wage_count_check
      CHECK (kind <> 'lca_wages' OR fetched IS NULL OR fetched >= 0)`);
    await db.exec(WIDENING_SQL);
    await db.exec(WIDENING_SQL);
    const { rows } = await db.query<{ n: string }>(
      "SELECT conname AS n FROM pg_constraint WHERE conrelid = 'public.layoff_read_log'::regclass AND contype = 'c' ORDER BY 1",
    );
    expect(rows.map((r) => r.n)).toEqual(["layoff_read_log_kind_check", "layoff_read_log_wage_count_check"]);
    // ...and it is still a rule: the widening did not merely leave a name behind.
    await expect(
      db.query("INSERT INTO public.layoff_read_log (kind, fetched, ok) VALUES ('lca_wages', -1, true)"),
    ).rejects.toThrow(/check/i);
    await db.exec("ALTER TABLE public.layoff_read_log DROP CONSTRAINT layoff_read_log_wage_count_check");
  }, BOOT_MS);

  it("applies twice leaving one constraint, not two", async () => {
    await db.exec(WIDENING_SQL);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.layoff_read_log'::regclass AND contype = 'c'",
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("the checks have teeth", () => {
  it("TEETH: with the widening cut out, the migration's own self-check raises and names the missing kind", async () => {
    const cut = WIDENING_SQL.replace(/ALTER TABLE public\.layoff_read_log\s+ADD CONSTRAINT layoff_read_log_kind_check\s+CHECK \([^;]*\);/, "");
    expect(cut).not.toBe(WIDENING_SQL);
    const db = await freshLedger();
    await expect(db.exec(cut)).rejects.toThrow(/does not admit the wage-load kind|has no kind check/);
    await db.close();
  }, BOOT_MS);

  it("TEETH: a widening that admits the new kind but drops one the poller already writes raises by name", async () => {
    const dropped = WIDENING_SQL.replace(/'mirror', /, "");
    expect(dropped).not.toBe(WIDENING_SQL);
    const db = await freshLedger();
    await expect(db.exec(dropped)).rejects.toThrow(/dropped a kind the poller already writes/);
    await db.close();
  }, BOOT_MS);

  it("TEETH: a ledger that never saw the earlier widening ends up with the same bar as one that did", async () => {
    // The column's bar is whichever widening ran last, so applying this one to
    // a database that skipped the mirror migration must produce the same list.
    const mirrorMig = files.find((n) => n.startsWith("20260921120000"))!;
    // Applied whole: it carries its own "pg_cron is not installed here" notice,
    // so nothing has to be cut out of it to run in pglite.
    const both = await freshLedger();
    await both.exec(read(mirrorMig));
    await both.exec(WIDENING_SQL);
    const only = await freshLedger();
    await only.exec(WIDENING_SQL);
    const defOf = async (db: PGlite) => (await db.query<{ d: string }>(
      "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.layoff_read_log'::regclass AND contype = 'c'",
    )).rows.map((r) => r.d).join("|");
    expect(await defOf(only)).toBe(await defOf(both));
    expect(await defOf(only)).toContain(NEW_KIND);
    await both.close();
    await only.close();
  }, BOOT_MS);
});
