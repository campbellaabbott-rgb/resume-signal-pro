/**
 * Lovable's agent applied the cost wave's first two migrations and then
 * refused the third (2026-11-15) "for a missing sub-hourly cron review
 * marker", and stopped. Lovable's documentation names no such rule, so the
 * marker was first written in the agent's own words. On 2026-11-17 the agent
 * refused the same file again and named the exact first line its tool
 * requires: the words lovable-cron-fallback-reviewed, a colon, and a reason.
 * Every pending cost-wave file now opens with that line:
 *
 *  - a file whose code schedules or keeps a job on a sub-hourly cron
 *    expression gives a reason that names the job, and the lines under it
 *    keep the owner's full review (who reviewed it and when, the job, the
 *    schedule before and after, why it is sub-hourly, the load, and that it
 *    adds no standing sub-hourly job);
 *  - every other file's reason says it has no cron or no sub-hourly cron, and
 *    is held to it: its code may not carry a sub-hourly expression.
 *
 * Lovable also documents that it rejects a migration containing BEGIN,
 * COMMIT or ROLLBACK as transaction statements; the files carry none, and the
 * words are kept out of their comments too, so a keyword scan cannot misread
 * them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIG = resolve(__dirname, "../../supabase/migrations");
const PENDING = [
  "20261109120000", "20261109121000", "20261109122000", "20261109131000",
  "20261109140000", "20261109141000", "20261109150000", "20261109160000",
  "20261109161000", "20261109170000", "20261109175000", "20261109190000",
];
const fileFor = (stamp: string): string => {
  const hit = readdirSync(MIG).filter((f) => f.startsWith(`${stamp}_`) && f.endsWith(".sql"));
  expect(hit, `one migration file for ${stamp}`).toHaveLength(1);
  return readFileSync(resolve(MIG, hit[0]), "utf8");
};

/** The file without its comment lines: what the database runs. */
const code = (sql: string): string =>
  sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

/**
 * Every quoted five-field expression whose minute field fires more than once
 * an hour. A quote may be doubled, as inside a NOTICE that prints a
 * cron.schedule call, so the minute field is read without its quotes.
 */
const subHourly = (src: string): string[] =>
  [...src.matchAll(/'+([^'\s]+) \* \* \* \*'/g)]
    .map((m) => m[1])
    .filter((minute) => !/^\d{1,2}$/.test(minute));

const FULL = [
  /^-- reviewed: \d{4}-\d{2}-\d{2} by the project owner/m,
  /^-- job: \S+/m,
  /^-- schedule: /m,
  /^-- why sub-hourly: /m,
  /^-- load: lower than today/m,
  /^-- new standing sub-hourly jobs: none\.$/m,
];

/** The first line Lovable's tool requires, with a reason that is one line. */
const MARKER = /^-- lovable-cron-fallback-reviewed: \S[^\n]*\n/;

describe("every pending cost-wave migration opens with Lovable's cron review line", () => {
  for (const stamp of PENDING) {
    const sql = fileFor(stamp);
    const runs = subHourly(code(sql));
    const head = sql.split("\n--\n")[0];

    it(`${stamp} begins with the line Lovable's tool requires`, () => {
      expect(sql).toMatch(MARKER);
    });

    if (runs.length > 0) {
      it(`${stamp} keeps a sub-hourly job (${[...new Set(runs)].join(", ")}), so its marker is the full review`, () => {
        for (const line of FULL) expect(head, String(line)).toMatch(line);
        const job = /^-- job: (\S+)/m.exec(head)?.[1] ?? "";
        expect(sql.split("\n")[0], `the reason names ${job}`).toContain(job);
      });
    } else {
      it(`${stamp} runs nothing more often than hourly and says the review is not required`, () => {
        expect(head).toMatch(/^-- lovable-cron-fallback-reviewed: no (sub-hourly )?cron; /);
      });
    }

    it(`${stamp} names no transaction statement, even in a comment`, () => {
      expect(sql).not.toMatch(/\b(COMMIT|ROLLBACK)\b/i);
      expect(sql).not.toMatch(/^\s*BEGIN\s*(TRANSACTION|WORK)?\s*;/im);
    });
  }

  it("only the facets refresh, the stats rollup and the perk sweep keep a sub-hourly schedule", () => {
    const keep = PENDING.filter((s) => subHourly(code(fileFor(s))).length > 0);
    expect(keep).toEqual(["20261109120000", "20261109121000", "20261109161000"]);
  });

  // The deploy message reads a migration's note only from migrationOrder. The
  // index droppers' retry note sat under reservations from 2026-11-15, so no
  // message carried it (review 2026-11-16).
  it("every migration's ledger entry sits where the deploy message reads it", () => {
    const ledger = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8"));
    expect(Object.keys(ledger.reservations).filter((k) => /^\d{14}$/.test(k))).toEqual([]);
    for (const stamp of PENDING) expect(Object.keys(ledger.migrationOrder), stamp).toContain(stamp);
  });
});
