import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Two "one-shot" VACUUM jobs ran for weeks because neither could stop itself.
 *
 * oneoff-vacuum-jbp was scheduled, correctly unscheduled, then RE-SCHEDULED on a
 * ten-minute cron and never removed — a full VACUUM (ANALYZE) over the board's largest
 * table every ten minutes since 2026-08-12, taking a lock and competing for I/O
 * with the refresh rotation and with every query serving the board.
 *
 * oneshot-vacuum-postings ends its own body with cron.unschedule, so it was
 * meant to run once. It cannot: pg_cron runs a job body inside a transaction and
 * VACUUM is not allowed in one, so the statement raises 25001, the body aborts,
 * and the unschedule never executes. Immortal, failing once a minute — about
 * 13,000 times — since 2026-08-18.
 */
const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const read = (f: string) => strip(readFileSync(resolve(DIR, f), "utf8"));

describe("a one-shot that never shot once", () => {
  it("leaves no vacuum job scheduled at the end of the folder", () => {
    // Replayed in filename order: a schedule adds, an unschedule removes.
    const live = new Set<string>();
    for (const f of FILES) {
      const sql = read(f);
      for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'/g)) live.add(m[1]);
      for (const m of sql.matchAll(/cron\.unschedule\(\s*'([^']+)'/g)) live.delete(m[1]);
      // The guarded loop form used by 20260827181000.
      if (/ARRAY\['oneoff-vacuum-jbp', 'oneshot-vacuum-postings'\]/.test(sql)) {
        live.delete("oneoff-vacuum-jbp");
        live.delete("oneshot-vacuum-postings");
      }
    }
    const vacuums = [...live].filter((j) => /vacuum/i.test(j));
    expect(vacuums, `still-scheduled VACUUM job(s): ${vacuums.join(", ")}`).toEqual([]);
  });

  it("never schedules VACUUM inside a pg_cron body again", () => {
    // VACUUM cannot run in a transaction block, and pg_cron wraps a job body in
    // one. A job whose body vacuums can only ever raise 25001 — and if it also
    // relies on a trailing cron.unschedule to stop, it becomes immortal.
    for (const f of FILES.filter((x) => x > "20260827181000")) {
      const sql = read(f);
      const bad = /cron\.schedule\([^)]*vacuum/i.test(sql);
      expect(bad, `${f} schedules a VACUUM in a pg_cron body — it can only raise 25001`).toBe(false);
    }
  });

  it("every migration-level unschedule is guarded, so a replay cannot abort", () => {
    // cron.unschedule RAISES when the job does not exist, and several of these
    // names are unscheduled by more than one migration — oneshot_company_simple_fts_idx
    // three times. Unguarded, a fresh replay of this folder (supabase db reset,
    // a staging rebuild, disaster recovery) aborts at the second one and no
    // later migration applies. Production ran each once, successfully, which is
    // exactly why it was never noticed.
    //
    // Only MIGRATION-LEVEL calls count. An unschedule inside a dollar-quoted job
    // BODY runs when the job runs, not when the migration applies, so it cannot
    // abort a replay — the spans below exclude those, and an earlier version of
    // this test reported fourteen offenders because it did not.
    const dollarSpans = (s: string) => {
      const spans: Array<[number, number]> = [];
      for (const m of s.matchAll(/\$([A-Za-z_]*)\$/g)) {
        const tag = m[0];
        const close = s.indexOf(tag, m.index! + tag.length);
        if (close !== -1) spans.push([m.index!, close + tag.length]);
      }
      return spans;
    };
    const offenders: string[] = [];
    for (const f of FILES) {
      const sql = read(f);
      const spans = dollarSpans(sql);
      for (const m of sql.matchAll(/cron\.unschedule\(\s*'([^']+)'/g)) {
        if (spans.some(([a, b]) => a <= m.index! && m.index! < b)) continue;
        const before = sql.slice(Math.max(0, m.index! - 400), m.index!);
        const guarded = /IF EXISTS \(SELECT 1 FROM cron\.job/i.test(before)
          || /jobname = j/i.test(before);
        if (!guarded) offenders.push(`${f}:${m[1]}`);
      }
    }
    expect(offenders, `unguarded cron.unschedule — a replay aborts here:\n  ${offenders.join("\n  ")}`)
      .toEqual([]);
  });
});
