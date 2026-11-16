// @vitest-environment node
/**
 * A STUB THAT NAMES NO FILE APPLIES THE ONE WHOSE TEXT IT HOLDS (the closeout
 * review of 2026-11-16; scripts/deploy-ledger.mjs sameTextFile and
 * migrations, section 49).
 *
 * Lovable applied the cost wave's first two files on 2026-11-15 as drizzle
 * 0226_stop_unused_recency_ladder.sql and 0227_slim_explore_cache.sql: no
 * stamp, a title of its own, no staged name, and byte for byte the repo files
 * 20261109100000 and 20261109110000. migrations() matched a stub by its
 * staged name, its stamped name or its title, so both stayed pending: every
 * generated message put them first in "Apply these migrations", ahead of
 * every later file, and section 49 printed "migration not applied" for both
 * after every deploy. Now:
 *   - a stub that names no file applies the one file whose SQL it holds,
 *     comments and whitespace aside;
 *   - a stub whose text two files share, an empty stub, and a stub that ran
 *     another text apply nothing (the file stays pending for a person to read);
 *   - a stub that names its file is still read by its name first;
 *   - on this tree both cost-wave files are applied, not pending.
 * Reads a fixture directory and this tree's files; no network, no git.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const POLICY = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));

const SAME = "20261201100000_a_file_lovable_applied_under_its_own_title.sql";
const SPACED = "20261201110000_a_file_lovable_retyped_only_in_its_spacing.sql";
const OTHER = "20261201120000_a_file_whose_stub_ran_another_text.sql";
const TWIN_A = "20261201130000_one_of_two_files_with_one_text.sql";
const TWIN_B = "20261201140000_the_other_of_two_files_with_one_text.sql";
const NAMED = "20261201150000_a_file_its_stub_names.sql";
const NONE = "20261201160000_a_file_no_stub_holds.sql";

const dir = mkdtempSync(join(tmpdir(), "ledger-same-text-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const migDir = join(dir, "migrations"), drizzleDir = join(dir, "drizzle");
mkdirSync(migDir); mkdirSync(drizzleDir);
const sql: Record<string, string> = {
  [SAME]: "-- the ladder stops\nSELECT cron.unschedule('ladder');\n",
  [SPACED]: "-- the cache slims\nCREATE OR REPLACE VIEW v AS SELECT 1 AS one;\n",
  [OTHER]: "UPDATE t SET a = 1 WHERE b = 2;\n",
  [TWIN_A]: "SELECT 'twin';\n",
  [TWIN_B]: "-- a different head\nSELECT 'twin';\n",
  [NAMED]: "SELECT 'named';\n",
  [NONE]: "SELECT 'none';\n",
};
for (const [f, t] of Object.entries(sql)) writeFileSync(join(migDir, f), t);
writeFileSync(join(drizzleDir, "0001_stop_ladder.sql"), sql[SAME]);
writeFileSync(join(drizzleDir, "0002_slim_cache.sql"), "CREATE OR REPLACE VIEW v AS\n  SELECT 1 AS one;   -- retyped\n");
writeFileSync(join(drizzleDir, "0003_another_text.sql"), "UPDATE t SET a = 1 WHERE b = 3;\n");
writeFileSync(join(drizzleDir, "0004_twin.sql"), "SELECT 'twin';\n");
writeFileSync(join(drizzleDir, "0005_only_comments.sql"), "-- nothing ran\n/* still nothing */\n");
writeFileSync(join(drizzleDir, `0006_${NAMED}`), "SELECT 'named', 'retyped';\n");
const policy = { drizzleBaseline: "20260923000000", neverApply: [], appliedOutsideDrizzle: [], holdUntilVerified: [] };

describe("sameTextFile names the one file a stub's text matches", () => {
  const texts = new Map([[SAME, L.sqlText(sql[SAME])], [TWIN_A, L.sqlText(sql[TWIN_A])], [TWIN_B, L.sqlText(sql[TWIN_B])]]);
  it("by its SQL, comments and whitespace aside", () => {
    expect(L.sameTextFile(sql[SAME], texts)).toBe(SAME);
    expect(L.sameTextFile("SELECT   cron.unschedule('ladder');  -- applied\n", texts)).toBe(SAME);
  });
  it("never when two files share the text, the stub is empty, or no file holds it", () => {
    expect(L.sameTextFile("SELECT 'twin';", texts)).toBeNull();
    expect(L.sameTextFile("-- only a comment\n", texts)).toBeNull();
    expect(L.sameTextFile("", texts)).toBeNull();
    expect(L.sameTextFile("SELECT cron.unschedule('another');", texts)).toBeNull();
  });
});

describe("migrations() over stubs that name no file", () => {
  const m = L.migrations(policy, { migrations: migDir, drizzle: drizzleDir });
  it("applies the file whose text a stub holds, exactly or retyped only in spacing and comments", () => {
    expect(m.applied).toContain(SAME);
    expect(m.applied).toContain(SPACED);
  });
  it("leaves pending the file a stub ran another text of, both twins, and the file no stub holds", () => {
    expect(m.pending).toEqual([OTHER, TWIN_A, TWIN_B, NONE]);
  });
  it("still reads a named stub by its name and compares it with its file", () => {
    expect(m.applied).toContain(NAMED);
    expect(m.retyped.map((r: { file: string }) => r.file)).toEqual([NAMED]);
  });
});

describe("on this tree", () => {
  const PAIRS = [
    ["20261109100000_the_recency_ladder_nothing_reads_stops_running.sql", "0226_stop_unused_recency_ladder.sql"],
    ["20261109110000_the_explore_cache_stops_computing_what_no_page_reads.sql", "0227_slim_explore_cache.sql"],
  ];
  it("Lovable's stubs 0226 and 0227 hold the two cost-wave files byte for byte", () => {
    for (const [file, stub] of PAIRS) {
      expect(readFileSync(resolve(ROOT, "drizzle/migrations", stub), "utf8"), stub)
        .toBe(readFileSync(resolve(ROOT, "supabase/migrations", file), "utf8"));
    }
  });
  it("both files are applied, not pending, so no message asks for them again and section 49 names neither", () => {
    const m = L.migrations(POLICY);
    for (const [file] of PAIRS) {
      expect(m.pending, file).not.toContain(file);
      expect(m.applied, file).toContain(file);
    }
  });
});
