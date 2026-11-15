// @vitest-environment node
/**
 * THE LEDGER READS A STAGED STUB BY ITS NAME, WITH OR WITHOUT THE SUFFIX
 * (the 5ef5e1a7 closeout, 2026-11-15; scripts/deploy-ledger.mjs stagedFile
 * and migrations, section 49).
 *
 * Lovable's stubs 0221-0225 run public._mig_exec on the row staged under a
 * name, and that name is the stamp and title with no .sql. migrations() added
 * the captured name to its applied set and tested repo file names, which end
 * in .sql, so section 49 printed five "migration not applied" FAILs for five
 * migrations whose behaviour had already been read live. Now:
 *   - a stage named with or without the suffix applies its file;
 *   - only the whole name matches: a stage named by the file's stamp and
 *     another title (the runner's edited copy of a failing file) leaves the
 *     file pending, as does a file no stub names;
 *   - a stub holding its own SQL, named by its stamped file, still applies it
 *     and is still compared with it;
 *   - on this tree none of the five is pending.
 * Reads a fixture directory and this tree's files; no network, no git.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const POLICY = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));

const WITH = "20261201100000_a_file_staged_with_its_suffix.sql";
const WITHOUT = "20261201110000_a_file_staged_without_its_suffix.sql";
const OTHER_TITLE = "20261201120000_a_file_staged_under_another_title.sql";
const NO_STUB = "20261201130000_a_file_no_stub_names.sql";
const OWN_TEXT = "20261201140000_a_file_stubbed_with_its_own_text.sql";
const exec = (name: string) => `SELECT public._mig_exec((SELECT sql FROM public._mig_stage WHERE name = '${name}'));`;

const dir = mkdtempSync(join(tmpdir(), "ledger-staged-name-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const migDir = join(dir, "migrations"), drizzleDir = join(dir, "drizzle");
mkdirSync(migDir); mkdirSync(drizzleDir);
for (const f of [WITH, WITHOUT, OTHER_TITLE, NO_STUB, OWN_TEXT]) writeFileSync(join(migDir, f), `SELECT '${f}';\n`);
writeFileSync(join(drizzleDir, `0001_${WITH}`), exec(WITH));
writeFileSync(join(drizzleDir, `0002_${WITHOUT}`), exec(WITHOUT.replace(/\.sql$/, "")));
writeFileSync(join(drizzleDir, "0003_apply_20261201120000_fixed.sql"), exec("20261201120000_fixed"));
writeFileSync(join(drizzleDir, `0004_${OWN_TEXT}`), `SELECT '${OWN_TEXT}' AND 1;\n`);
const policy = { drizzleBaseline: "20260923000000", neverApply: [], appliedOutsideDrizzle: [], holdUntilVerified: [] };

describe("stagedFile names the repo file a stage holds", () => {
  const repo = [WITH, WITHOUT, OTHER_TITLE];
  it("with or without its .sql", () => {
    expect(L.stagedFile(WITH, repo)).toBe(WITH);
    expect(L.stagedFile(WITHOUT.replace(/\.sql$/, ""), repo)).toBe(WITHOUT);
  });
  it("only by the whole name, never by the stamp alone", () => {
    expect(L.stagedFile("20261201120000_fixed", repo)).toBeNull();
    expect(L.stagedFile("20261201120000", repo)).toBeNull();
    expect(L.stagedFile("20261201120000_a_file_staged_under_another", repo)).toBeNull();
    expect(L.stagedFile("", repo)).toBeNull();
  });
});

describe("migrations() over a drizzle directory holding both stub spellings", () => {
  const m = L.migrations(policy, { migrations: migDir, drizzle: drizzleDir });
  it("applies the files staged with and without the suffix", () => {
    expect(m.applied).toContain(WITH);
    expect(m.applied).toContain(WITHOUT);
    expect(m.pending).not.toContain(WITHOUT);
  });
  it("leaves pending the file staged under another title and the file no stub names", () => {
    expect(m.pending).toEqual([OTHER_TITLE, NO_STUB]);
  });
  it("still applies a stub with its own text by its stamped name, and compares the two", () => {
    expect(m.applied).toContain(OWN_TEXT);
    expect(m.retyped.map((r: { file: string }) => r.file)).toEqual([OWN_TEXT]);
  });
});

describe("on this tree", () => {
  const FIVE = [
    "20261011103000_a_chat_users_searches_are_kept_a_month_not_half_a_year.sql",
    "20261108100000_boards_named_by_their_tenant_code_print_the_name_their_employer_uses.sql",
    "20261110120000_a_full_analysis_is_made_by_one_run_at_a_time.sql",
    "20261110140000_an_unnamed_purchase_claim_takes_its_product_from_the_records_that_hold_it.sql",
    "20261110160000_a_pruned_filing_is_counted_once_in_the_column_its_status_names.sql",
  ];
  it("the five Lovable staged without the suffix are applied, not pending", () => {
    const m = L.migrations(POLICY);
    for (const f of FIVE) {
      expect(m.pending, f).not.toContain(f);
      expect(m.applied, f).toContain(f);
    }
  });
});
