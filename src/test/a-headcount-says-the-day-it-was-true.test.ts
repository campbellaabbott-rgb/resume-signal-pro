// @vitest-environment node
/**
 * A HEADCOUNT SAYS THE DAY IT WAS TRUE (owner decision D11, 2026-10-11).
 *
 * company_profiles holds 978 employee counts and no column saying when any
 * of them was true, and four surfaces printed them: the employer page's intel
 * strip, its similar-employers list, the posting panel's "About this
 * employer" block and the compare drawer. Migration 20261012102000 adds
 * company_profiles.as_of and leaves it NULL; every surface prints a count
 * only through datedHeadcount, which needs a plain calendar date beside it.
 *
 * On pglite: the migration against a stand-in table, run twice, and its
 * self-check shown refusing a column that would date rows nobody measured.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { datedHeadcount } from "@/lib/headcount";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const STAMP = "20261012102000_";
const MIG = readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(STAMP))!), "utf8");

const STAND_IN = `
  CREATE TABLE public.company_profiles (company_token text PRIMARY KEY, employee_count int NOT NULL, employee_basis text NOT NULL, yc_batch text);
  INSERT INTO public.company_profiles VALUES ('stripe', 7000, 'yc_self_reported', 'S09'), ('humana', 67000, 'public_records', NULL);
`;
const column = async (db: PGlite) => (await db.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
  "SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'company_profiles' AND column_name = 'as_of'",
)).rows[0];

describe("migration 20261012102000", () => {
  it("adds a nullable, undefaulted date column and dates no row", async () => {
    const db = new PGlite();
    await db.exec(STAND_IN);
    await db.exec(MIG);
    expect(await column(db)).toEqual({ data_type: "date", is_nullable: "YES", column_default: null });
    const dated = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.company_profiles WHERE as_of IS NOT NULL")).rows[0].n;
    expect(dated, "the migration dated a row nobody measured").toBe(0);
    await db.close();
  });

  it("is safe to re-run", async () => {
    const db = new PGlite();
    await db.exec(STAND_IN);
    await db.exec(MIG);
    await db.exec(MIG);
    expect((await column(db)).data_type).toBe("date");
    await db.close();
  });

  it("its self-check refuses a column with a default, and a column of the wrong type", async () => {
    const withDefault = new PGlite();
    await withDefault.exec(STAND_IN);
    await withDefault.exec("ALTER TABLE public.company_profiles ADD COLUMN as_of date DEFAULT current_date");
    await expect(withDefault.exec(MIG)).rejects.toThrow(/carries a default/);
    await withDefault.close();

    const wrongType = new PGlite();
    await wrongType.exec(STAND_IN);
    await wrongType.exec("ALTER TABLE public.company_profiles ADD COLUMN as_of text");
    await expect(wrongType.exec(MIG)).rejects.toThrow(/not date/);
    await wrongType.close();
  });

  it("changes no grant and no policy", () => {
    const code = MIG.replace(/--[^\n]*/g, " ");
    expect(code).not.toMatch(/\b(GRANT|REVOKE|CREATE POLICY|DROP POLICY)\b/i);
  });
});

describe("datedHeadcount", () => {
  it("prints nothing for an undated count, which is every count today", () => {
    expect(datedHeadcount({ employees: 779000 })).toBeNull();
    expect(datedHeadcount({ employees: 779000, employees_as_of: null })).toBeNull();
    expect(datedHeadcount({ employees: 779000, employees_as_of: "July 2026" }), "a date that is not a plain calendar date").toBeNull();
    expect(datedHeadcount({ employees: 779000, employees_as_of: "2026-07-23T00:00:00Z" })).toBeNull();
    expect(datedHeadcount(null)).toBeNull();
  });

  it("prints nothing for a count that is not a count", () => {
    for (const n of [0, -5, NaN, Infinity, null, undefined]) {
      expect(datedHeadcount({ employees: n as number, employees_as_of: "2026-07-23" }), String(n)).toBeNull();
    }
  });

  it("positive control: a dated count comes back with its date, under either spelling", () => {
    expect(datedHeadcount({ employees: 779000, employees_as_of: "2026-07-23" })).toEqual({ n: 779000, asOf: "2026-07-23" });
    expect(datedHeadcount({ employees: 12, employeesAsOf: "2026-07-23" })).toEqual({ n: 12, asOf: "2026-07-23" });
  });
});

describe("every surface that prints a company_profiles headcount asks datedHeadcount first", () => {
  const SURFACES = [
    "src/components/jobs/CompanyIntelPanel.tsx",
    "src/components/jobs/SimilarCompanies.tsx",
    "src/components/jobs/EmployerContext.tsx",
    "src/pages/Jobs.tsx",
  ];
  for (const f of SURFACES) {
    it(f, () => {
      const code = codeOf(readFileSync(resolve(ROOT, f), "utf8"));
      expect(code, `${f} no longer reads datedHeadcount`).toMatch(/\bdatedHeadcount\(/);
      // The two shapes the undated print took: a null check on the raw count,
      // and the raw count formatted for the page.
      expect(code, `${f} prints a raw headcount`).not.toMatch(/\.employees\.toLocaleString\(/);
      expect(code, `${f} gates a headcount on its presence alone`).not.toMatch(/\.employees\s*!=\s*null/);
    });
  }
});
