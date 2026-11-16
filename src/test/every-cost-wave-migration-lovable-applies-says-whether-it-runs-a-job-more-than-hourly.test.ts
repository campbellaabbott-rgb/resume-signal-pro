/**
 * Lovable's agent applied the cost wave's first two migrations and then
 * refused the third (2026-11-15) "for a missing sub-hourly cron review
 * marker", and stopped. Lovable's documentation names no such rule, so the
 * marker is written in the agent's own words at the top of every pending
 * cost-wave file:
 *
 *  - a file whose code schedules or keeps a job on a sub-hourly cron
 *    expression opens with the full review block (who reviewed it and when,
 *    the job, the schedule before and after, why it is sub-hourly, the load,
 *    and that it adds no standing sub-hourly job);
 *  - every other file opens with the one-line form saying the review is not
 *    required, and is held to it: its code may not carry a sub-hourly
 *    expression.
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

describe("every pending cost-wave migration opens with its sub-hourly cron review marker", () => {
  for (const stamp of PENDING) {
    const sql = fileFor(stamp);
    const runs = subHourly(code(sql));
    const head = sql.split("\n--\n")[0];

    it(`${stamp} begins with the marker`, () => {
      expect(sql.startsWith("-- SUB-HOURLY CRON REVIEW MARKER")).toBe(true);
    });

    if (runs.length > 0) {
      it(`${stamp} keeps a sub-hourly job (${[...new Set(runs)].join(", ")}), so its marker is the full review`, () => {
        for (const line of FULL) expect(head, String(line)).toMatch(line);
      });
    } else {
      it(`${stamp} runs nothing more often than hourly and says the review is not required`, () => {
        expect(head).toMatch(/^-- SUB-HOURLY CRON REVIEW MARKER: not required\./);
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
});
