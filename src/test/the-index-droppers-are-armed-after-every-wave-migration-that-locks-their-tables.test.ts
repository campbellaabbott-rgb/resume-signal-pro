// @vitest-environment node
/**
 * THE INDEX DROPPERS ARE ARMED AFTER EVERY WAVE MIGRATION THAT LOCKS THEIR
 * TABLES (cost wave review, 2026-11-15).
 *
 * A one-shot DROP INDEX CONCURRENTLY that waits for older transactions holds
 * SHARE UPDATE EXCLUSIVE on its table for as long as it waits, and a CREATE
 * TRIGGER (SHARE ROW EXCLUSIVE), an ALTER TABLE or a plain CREATE INDEX on the
 * same table queues behind it. The droppers are armed by a migration of this
 * wave and run within the hour, each at its own minute, so a later migration
 * of the same paste that takes one of those locks on a dropper's table can
 * time out behind it. The embed re-queue's CREATE TRIGGER on
 * job_board_postings sorted after the droppers' file and had a two-second
 * lock budget.
 *
 * Read here: the wave's migration files, their comments removed. The tables a
 * dropper drops from come from the dropper file's own pairs, so a new pair is
 * judged without editing this test.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const WAVE = readdirSync(DIR).filter((f) => /^20261109\d{6}_.*\.sql$/.test(f)).sort();
const code = (f: string) => readFileSync(resolve(DIR, f), "utf8").replace(/--[^\n]*/g, "");

/** The file that schedules a cron job whose command is a DROP INDEX CONCURRENTLY. */
const DROPPERS = WAVE.filter((f) => /cron\.schedule\([^;]*DROP INDEX CONCURRENTLY/i.test(code(f)));

/** The tables of the indexes that file drops, read from the definitions the migrations gave them. */
function droppedTables(f: string): string[] {
  const names = [...code(f).matchAll(/\('oneshot-drop-[a-z0-9-]+',\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
  const all = readdirSync(DIR).filter((x) => x.endsWith(".sql")).map((x) => code(x)).join("\n");
  const tables = new Set<string>();
  for (const n of names) {
    const m = all.match(new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?"?${n}"?\\s+ON\\s+(?:ONLY\\s+)?(?:public\\.)?"?([a-z0-9_]+)`, "i"));
    if (m) tables.add(m[1].toLowerCase());
  }
  return [...tables].sort();
}

/** Statements that queue behind a waiting DROP INDEX CONCURRENTLY on `table`. */
function locks(src: string, table: string): boolean {
  const t = `(?:public\\.)?"?${table}"?\\b`;
  return [
    new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\b[^;]*?\\bON\\s+${t}`, "i"),
    new RegExp(`DROP\\s+TRIGGER\\b[^;]*\\bON\\s+${t}`, "i"),
    new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${t}`, "i"),
    new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?!CONCURRENTLY)[^;]*?\\bON\\s+(?:ONLY\\s+)?${t}`, "i"),
    new RegExp(`LOCK\\s+TABLE\\s+(?:ONLY\\s+)?${t}`, "i"),
  ].some((re) => re.test(src));
}

describe("the duplicate-index droppers and the wave's table locks", () => {
  it("one file of the wave arms the droppers, and it names the tables they drop from", () => {
    expect(DROPPERS).toHaveLength(1);
    expect(droppedTables(DROPPERS[0])).toEqual(["ai_response_cache", "job_board_postings", "temp_resume_storage"]);
  });

  it("every wave migration that takes a lock on a dropper's table sorts before the file that arms the droppers", () => {
    const dropper = DROPPERS[0];
    const tables = droppedTables(dropper);
    const lockers = WAVE.filter((f) => f !== dropper && tables.some((t) => locks(code(f), t)));
    expect(lockers.length, "the embed re-queue's trigger on job_board_postings is one").toBeGreaterThan(0);
    expect(lockers.filter((f) => f > dropper), `armed at ${dropper}`).toEqual([]);
  });

  it("the lock reader sees the trigger the embed re-queue creates, and not the CONCURRENTLY build the closure split arms", () => {
    expect(locks("CREATE TRIGGER x AFTER UPDATE OF description ON public.job_board_postings FOR EACH ROW", "job_board_postings")).toBe(true);
    expect(locks("ALTER TABLE public.temp_resume_storage ADD COLUMN y int", "temp_resume_storage")).toBe(true);
    expect(locks("CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON public.job_board_postings (x)", "job_board_postings")).toBe(false);
    expect(locks("CREATE TRIGGER x AFTER UPDATE ON public.job_board_embed_requeue", "job_board_postings")).toBe(false);
  });
});
