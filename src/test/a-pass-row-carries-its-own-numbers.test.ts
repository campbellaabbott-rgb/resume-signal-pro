/**
 * A PASS ROW CARRIES ITS OWN NUMBERS — the SQL never spells them.
 *
 * The Agent Pass's price, session length, application count, daily quota,
 * rate and shelf life are declared once, in supabase/functions/_shared/pass.ts,
 * and reach the database only as PARAMETERS of the grant: the row copies
 * them in and keeps them, so a later change never rewrites a pass already
 * sold. A column DEFAULT, a CHECK bound, a CASE arm or a literal in a
 * comparison would each be a second spelling that no guard reads — the
 * "no subscriptions" incident was exactly that kind of drift, one runtime
 * over (project_claim_drift).
 *
 * This guard reads the six numbers from pass.ts (it never spells them
 * itself), then walks every pass migration and the migration that currently
 * WINS for each pass function (last by stamp, so a re-emitted copy is
 * covered), strips comments and string literals, and asserts that none of the
 * six appears as a standalone integer literal. String literals are stripped
 * because an interval text or a status name is not an integer the planner
 * compares against; comments are stripped because prose is not SQL.
 *
 * TEETH: a mutated copy of the table migration carrying one of the numbers as
 * a DEFAULT is reported — for each of the six, by name — and the number in a
 * comment alone is not.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const PASS_TS = readFileSync(resolve(ROOT, "supabase/functions/_shared/pass.ts"), "utf8");

/** The six product numbers, read from the declaring file, never typed here. */
const PASS_NUMBER_NAMES = ["PASS_PRICE_CENTS", "PASS_SESSION_HOURS", "PASS_APPLICATIONS", "PASS_QUOTA_PER_DAY", "PASS_RATE_PER_MIN", "PASS_SHELF_LIFE_DAYS"] as const;
function numberOf(src: string, name: string): number {
  const m = new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return Number(m[1]);
}
const PASS_NUMBERS: Record<string, number> = Object.fromEntries(PASS_NUMBER_NAMES.map((n) => [n, numberOf(PASS_TS, n)]));
// The product identity is a string, and SQL may spell it (SPEC 0.1 allows
// the tier and type literals in SQL) — but every spelling must equal the
// constant, or a renamed PASS_PRODUCT_TYPE leaves the metrics reading zero
// with no red anywhere (review A-5).
function stringOf(src: string, name: string): string {
  const m = new RegExp(`export const ${name}\\s*=\\s*"([^"]*)"\\s*;`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return m[1];
}
const PASS_PRODUCT_TYPE = stringOf(PASS_TS, "PASS_PRODUCT_TYPE");
/** Every product_type comparison literal in a migration's comment-stripped SQL. */
function productTypeLiterals(sql: string): string[] {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  return [...code.matchAll(/\bproduct_type\s*=\s*'((?:[^']|'')*)'/g)].map((m) => m[1]);
}

/** SQL with comments and single-quoted string literals removed. */
function sqlCode(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}
/** Every standalone integer literal in a code view. */
function integerLiterals(code: string): number[] {
  return [...code.matchAll(/(?<![\w.$])(\d+)(?![\w.])/g)].map((m) => Number(m[1]));
}
/** Which of the pass numbers a migration's code spells. */
function spelledPassNumbers(sql: string): string[] {
  const found = new Set(integerLiterals(sqlCode(sql)));
  return PASS_NUMBER_NAMES.filter((n) => found.has(PASS_NUMBERS[n]));
}

const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(MIG_DIR, f), "utf8");
const PASS_FILES = FILES.filter((f) => /pass|api_key_check_honours/.test(f));
const PASS_FUNCTIONS = ["agent_pass_grant", "api_key_check", "agent_queue_enqueue", "agent_pass_refund_on_failure", "agent_pass_metrics"];
const winner = (fn: string) => FILES.filter((f) => new RegExp(`FUNCTION public\\.${fn}\\s*\\(`).test(read(f))).pop();

describe("the pass migrations hold none of the pass numbers", () => {
  it("the parser read six distinct, positive numbers from pass.ts (otherwise every check below is vacuous)", () => {
    const vals = Object.values(PASS_NUMBERS);
    expect(vals.every((v) => Number.isInteger(v) && v > 0)).toBe(true);
    expect(new Set(vals).size).toBe(vals.length);
  });
  it("finds the six pass migrations by name", () => {
    expect(PASS_FILES.length).toBeGreaterThanOrEqual(6);
  });
  for (const f of PASS_FILES) {
    it(`${f} spells no pass number as an integer literal`, () => {
      expect(spelledPassNumbers(read(f))).toEqual([]);
    });
  }
  for (const fn of PASS_FUNCTIONS) {
    it(`the migration that WINS for ${fn} spells no pass number`, () => {
      const f = winner(fn);
      expect(f, `no migration defines ${fn}`).toBeTruthy();
      expect(spelledPassNumbers(read(f!))).toEqual([]);
    });
  }
  it("the copied-in columns carry no DEFAULT — the row's numbers come only from the grant's parameters", () => {
    const table = FILES.find((f) => /CREATE TABLE IF NOT EXISTS public\.agent_passes/.test(read(f)));
    expect(table).toBeTruthy();
    const code = sqlCode(read(table!));
    const body = /CREATE TABLE IF NOT EXISTS public\.agent_passes\s*\(([\s\S]*?)\);/.exec(code)?.[1] ?? "";
    expect(body).not.toBe("");
    for (const col of ["amount_cents", "session_hours", "applications_total", "rate_per_min", "daily_quota", "shelf_expires_at"]) {
      const line = body.split("\n").find((l) => new RegExp(`^\\s*${col}\\s`).test(l));
      expect(line, `${col} is not declared`).toBeTruthy();
      expect(line, `${col} carries a DEFAULT`).not.toMatch(/DEFAULT/i);
    }
  });
  it("the grant's INSERT lists the parameter for every copied-in column", () => {
    const code = sqlCode(read(winner("agent_pass_grant")!));
    for (const p of ["p_amount_cents", "p_session_hours", "p_applications_total", "p_rate_per_min", "p_daily_quota", "p_shelf_days"]) {
      expect(code).toMatch(new RegExp(`\\b${p}\\b`));
    }
    expect(code).toMatch(/make_interval\(days => p_shelf_days\)/);
  });
  it("every product_type literal in a pass migration is PASS_PRODUCT_TYPE, read from pass.ts", () => {
    expect(PASS_PRODUCT_TYPE.length).toBeGreaterThan(0);
    const walked = new Set([...PASS_FILES, ...PASS_FUNCTIONS.map((fn) => winner(fn)!)]);
    let seen = 0;
    for (const f of walked) {
      for (const lit of productTypeLiterals(read(f))) {
        seen++;
        expect(lit, `${f} compares product_type to '${lit}'`).toBe(PASS_PRODUCT_TYPE);
      }
    }
    // The metrics reader's two cross-checks are the spellings this exists for.
    expect(seen).toBeGreaterThanOrEqual(2);
  });
  it("the clock is the row's own session_hours, not a literal", () => {
    const code = sqlCode(read(winner("api_key_check")!));
    expect(code).toMatch(/make_interval\(hours => \w+\.session_hours\)/);
  });
});

describe("teeth", () => {
  const table = read(FILES.find((f) => /CREATE TABLE IF NOT EXISTS public\.agent_passes/.test(read(f)))!);
  for (const name of PASS_NUMBER_NAMES) {
    it(`a DEFAULT carrying ${name} is reported as exactly that number`, () => {
      const mutated = table.replace("applications_used integer NOT NULL DEFAULT 0", `applications_used integer NOT NULL DEFAULT ${PASS_NUMBERS[name]}`);
      expect(mutated).not.toBe(table);
      expect(spelledPassNumbers(mutated)).toEqual([name]);
    });
  }
  it("a number in a comment or in a string literal is not an integer literal", () => {
    const n = PASS_NUMBERS.PASS_APPLICATIONS;
    const inComment = `${table}\n-- the pass allows ${n} applications\n`;
    const inString = `${table}\nSELECT interval '${n} minutes';\n`;
    expect(spelledPassNumbers(inComment)).toEqual([]);
    expect(spelledPassNumbers(inString)).toEqual([]);
    expect(spelledPassNumbers(`${table}\nSELECT ${n};\n`)).toEqual(["PASS_APPLICATIONS"]);
  });
  it("an empty pass.ts fails loudly rather than pinning nothing", () => {
    expect(() => numberOf("", "PASS_PRICE_CENTS")).toThrow(/not found/);
    expect(() => stringOf("", "PASS_PRODUCT_TYPE")).toThrow(/not found/);
  });
  it("a product_type literal that drifts from the constant is reported, and one in a comment is not", () => {
    const metrics = read(winner("agent_pass_metrics")!);
    const drifted = metrics.replace(`product_type = '${PASS_PRODUCT_TYPE}'`, "product_type = 'agent_pas'");
    expect(drifted).not.toBe(metrics);
    expect(productTypeLiterals(drifted)).toContain("agent_pas");
    expect(productTypeLiterals(`${metrics}\n-- product_type = 'commented_out'\n`)).not.toContain("commented_out");
    expect(productTypeLiterals(metrics).every((l) => l === PASS_PRODUCT_TYPE)).toBe(true);
  });
});
