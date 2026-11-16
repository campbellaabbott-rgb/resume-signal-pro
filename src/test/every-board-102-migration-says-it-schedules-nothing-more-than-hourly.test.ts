/**
 * Lovable's agent refuses a migration that does not open with the sub-hourly
 * cron review marker (2026-11-15), one that carries a transaction statement,
 * and one whose text names the key store or its words. The cost wave's files
 * are held to that by
 * every-cost-wave-migration-lovable-applies-says-whether-it-runs-a-job-more-than-hourly.test.ts;
 * this file holds board .102's four migrations to the same rules, in a file of
 * its own so the two waves never edit one list.
 *
 * None of the four schedules a job, so each opens with the one-line form and
 * its code may carry no cron expression at all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIG = resolve(__dirname, "../../supabase/migrations");
const BOARD_102 = ["20261111100000", "20261111110000", "20261111120000", "20261111130000"];

const fileFor = (stamp: string): string => {
  const hit = readdirSync(MIG).filter((f) => f.startsWith(`${stamp}_`) && f.endsWith(".sql"));
  expect(hit, `one migration file for ${stamp}`).toHaveLength(1);
  return readFileSync(resolve(MIG, hit[0]), "utf8");
};

/** The file without its comment lines: what the database runs. */
const code = (sql: string): string =>
  sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

describe("every board .102 migration opens with its sub-hourly cron review marker", () => {
  it("the four files are every 20261111 migration the tree carries", () => {
    const all = readdirSync(MIG).filter((f) => /^20261111\d{6}_.*\.sql$/.test(f)).map((f) => f.slice(0, 14)).sort();
    expect(all).toEqual(BOARD_102);
  });

  for (const stamp of BOARD_102) {
    const sql = fileFor(stamp);

    it(`${stamp} says the review is not required, first line`, () => {
      expect(sql).toMatch(/^-- SUB-HOURLY CRON REVIEW MARKER: not required\. This file schedules nothing\n/);
    });

    it(`${stamp} schedules nothing: no cron call and no five-field expression in its code`, () => {
      const run = code(sql);
      expect(run).not.toMatch(/\bcron\.(schedule|alter_job|schedule_in_database)\b/i);
      const field = String.raw`[\d*,/-]+`;
      expect(run).not.toMatch(new RegExp(`'+${field} ${field} ${field} ${field} ${field}'+`));
    });

    it(`${stamp} names no transaction statement, even in a comment`, () => {
      expect(sql).not.toMatch(/\b(COMMIT|ROLLBACK)\b/i);
      expect(sql).not.toMatch(/^\s*BEGIN\s*(TRANSACTION|WORK)?\s*;/im);
      expect(sql).not.toMatch(/^\s*(START|END)\s+TRANSACTION\b/im);
    });

    it(`${stamp} carries none of the words the agent refuses, in any case`, () => {
      expect(sql).not.toMatch(/vault|secret|decrypt/i);
    });
  }

  it("every board .102 migration is a migrationOrder key, where the deploy message reads its note", () => {
    const ledger = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8"));
    for (const stamp of BOARD_102) expect(Object.keys(ledger.migrationOrder), stamp).toContain(stamp);
  });
});
