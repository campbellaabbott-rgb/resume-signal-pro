// @vitest-environment node
/**
 * THE DISK ALARM DIVIDED BY A DISK SIZE NOBODY HAD READ.
 *
 * On 2026-10-17 scan-heartbeat reported "database at 105% of the 20GB plan".
 * The database was still taking writes, so the disk could not be 20GB. The
 * divisor was the job_board_meta row plan_disk_gb, typed by hand on
 * 2026-08-30. Lovable's own page read "23.17 GB of 40 GB used": the disk had
 * grown on its own. 20261017100000 sets the row to that reading and records
 * when and where it was read.
 *
 * Run in pglite over a stand-in meta table.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261017100000_the_disk_is_forty_gb_as_lovable_reads_it.sql"),
  "utf8",
);

let db: PGlite;
const row = async () =>
  (await db.query<{ v: { gb: number; read_at?: string; source?: string } }>(
    "SELECT v FROM public.job_board_meta WHERE k = 'plan_disk_gb'",
  )).rows[0]?.v;
const seed = async (v: string | null) => {
  await db.exec("DELETE FROM public.job_board_meta");
  if (v !== null) await db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('plan_disk_gb', '${v}')`);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE public.job_board_meta (
    k text PRIMARY KEY, v jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
});
afterAll(async () => { await db.close(); });

describe("the disk row is Lovable's reading, dated", () => {
  it("replaces the hand-typed 20 with 40 and says where 40 came from", async () => {
    await seed('{"gb": 20}');
    await db.exec(SQL);
    const v = await row();
    expect(v?.gb).toBe(40);
    expect(v?.read_at).toBe("2026-10-17");
    expect(v?.source).toMatch(/23\.17 GB of 40 GB/);
  });

  it("is safe to run twice", async () => {
    await seed('{"gb": 20}');
    await db.exec(SQL);
    await expect(db.exec(SQL)).resolves.toBeDefined();
    expect((await row())?.gb).toBe(40);
  });

  it("leaves a value someone set on purpose alone", async () => {
    await seed('{"gb": 60}');
    await db.exec(SQL);
    expect((await row())?.gb, "a deliberate value was overwritten").toBe(60);
  });

  it("creates the row on a fresh database", async () => {
    await seed(null);
    await db.exec(SQL);
    expect((await row())?.gb).toBe(40);
  });

  it("the heartbeat reads only gb, so the extra keys cannot change the alarm", () => {
    const hb = readFileSync(resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");
    expect(hb).toMatch(/\(data\?\.v as \{ gb\?: number \} \| null\)\?\.gb/);
  });

  it("at today's reading the storage check is under its 75% line", () => {
    // 23.17 GB used of a 40 GB disk, in the heartbeat's own arithmetic
    // (bytes over planGb * 1024^3).
    const usedPct = Math.round((100 * 23.17e9) / (40 * 1024 ** 3));
    expect(usedPct).toBeLessThan(75);
  });
});
