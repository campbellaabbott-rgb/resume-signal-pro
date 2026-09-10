import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * get_actively_hiring_companies evaluates get_company_fill_curve ONCE.
 *
 * WHY THIS IS PINNED. On 2026-09-10 the leaderboard answered in 15.9s and the
 * diagnosis offered was that its body "references get_company_fill_curve five
 * times", so the curve's day-30 cost (20260909217000) was being paid fivefold.
 * A grep does say five. Four of the five are COMMENTS. Executed in pglite over
 * a 2,000-token board (scripts/measure-leaderboard-curve-calls.mjs), the body
 * the database runs evaluates the curve exactly once -- one Function Scan, one
 * loop, one entry in a wrapper's call log -- at p_limit 20 and at p_limit
 * 2000 alike, because the call sits in a single CTE whose token array is an
 * uncorrelated subquery. The cost is one curve over 200 tokens, and on that
 * fixture the curve is three quarters of the statement and 217000 made the
 * curve 2.3x slower on identical tokens. A "call it once" restructure had
 * nothing to restructure.
 *
 * This guard keeps that true through re-issues, and it counts CODE: a comment
 * mentioning the curve must neither fail it nor satisfy it, which is the trap
 * project_guard_literals records four times over.
 *
 * TWO READING RULES the guard follows, each with teeth below:
 *   - the LAST definition in the newest file is the live one. This repo has
 *     re-issued a function twice in one migration; the database keeps the
 *     last CREATE, so a guard that took the first would read a stale copy.
 *   - the call's argument is read to the paren that BALANCES it. A cut at the
 *     first '))' inspects a prefix, and a correlated outer reference after a
 *     nested close paren would pass unread.
 */
const ROOT = resolve(__dirname, "../..");
const stripSql = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

/**
 * The LAST definition of `name` in one migration's text, cut CREATE..$$ so a
 * sibling in the same file cannot answer for it. Null when the file has none.
 */
export function lastDefinition(sql: string, name: string): string | null {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  let cut: string | null = null;
  for (const m of sql.matchAll(re)) {
    if (m.index === undefined) continue;
    const open = sql.indexOf("$$", m.index);
    const close = open < 0 ? -1 : sql.indexOf("$$", open + 2);
    if (close < 0) continue;
    cut = sql.slice(m.index, close + 2);
  }
  return cut;
}

/** The newest file's last definition of one function. */
function liveBody(name: string): { file: string; raw: string } {
  const dir = "supabase/migrations";
  let found: { file: string; raw: string } | null = null;
  for (const file of readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".sql")).sort()) {
    const cut = lastDefinition(readFileSync(resolve(ROOT, join(dir, file)), "utf8"), name);
    if (cut) found = { file, raw: cut };
  }
  if (!found) throw new Error(`${name} has no definition under ${dir}`);
  return found;
}

/**
 * The call starting at `at`, read to the paren that balances its opening one
 * -- by depth, so a nested ARRAY(SELECT ...) closes on its own paren and the
 * outer call on its, never on the first '))' the text happens to contain.
 */
export function callAt(code: string, at: number): string {
  const open = code.indexOf("(", at);
  if (open < 0) throw new Error("no opening paren after the call");
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")" && --depth === 0) return code.slice(at, i + 1);
  }
  throw new Error("unbalanced parens in the call");
}

/** Relation aliases the argument defines for itself: FROM/JOIN <rel> [AS] <alias>. */
const innerAliases = (arg: string) =>
  new Set([...arg.matchAll(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?([a-z_]\w*)\b/gi)].map((m) => m[1].toLowerCase()));

/**
 * Every <alias>.<column> read inside the argument list (the callee's own
 * `public.` prefix sits before the opening paren and is not scanned).
 */
const aliasReads = (call: string) =>
  [...call.slice(call.indexOf("(")).matchAll(/\b([a-z_]\w*)\.([a-z_]\w*)\b/gi)].map((m) => m[1].toLowerCase());

/** Is every alias the argument reads one the argument itself defines? */
export function uncorrelated(call: string): { ok: boolean; outer: string[] } {
  const inner = innerAliases(call);
  const outer = [...new Set(aliasReads(call).filter((a) => !inner.has(a)))];
  return { ok: outer.length === 0, outer };
}

const CALL = /\bFROM\s+public\.get_company_fill_curve\s*\(/g;
const calls = (code: string) => (code.match(CALL) ?? []).length;

describe("the leaderboard reads the curve once", () => {
  it("the live body of get_actively_hiring_companies calls get_company_fill_curve in exactly one FROM position", () => {
    const live = liveBody("get_actively_hiring_companies");
    const n = calls(stripSql(live.raw));
    expect(n, `${live.file}: the curve must be entered once, for one token set`).toBe(1);
  });

  it("and that call is not fanned out by a correlated argument", () => {
    // The one call's argument is ARRAY(SELECT ... FROM admissible a ...): a
    // subquery over a CTE whose every alias read is its own, which the
    // executor evaluates once as an InitPlan. A call whose argument named an
    // outer column (f.company_token, o.tok) would become a per-row
    // re-evaluation with the same textual count.
    const code = stripSql(liveBody("get_actively_hiring_companies").raw);
    const call = callAt(code, code.search(CALL));
    expect(call).toMatch(/^FROM\s+public\.get_company_fill_curve\(\s*ARRAY\(\s*SELECT/);
    expect(call.trim().endsWith(")")).toBe(true);
    const check = uncorrelated(call);
    expect(check.ok, `outer alias read inside the curve's argument: ${check.outer.join(", ")}`).toBe(true);
  });

  it("TEETH: a comment spelling the call counts for nothing", () => {
    const commented = [
      "CREATE OR REPLACE FUNCTION public.x() RETURNS int LANGUAGE sql AS $$",
      "  -- reads get_company_fill_curve five times, or so a grep would say:",
      "  -- SELECT * FROM public.get_company_fill_curve(ARRAY['a'])",
      "  /* FROM public.get_company_fill_curve(ARRAY['b']) */",
      "  SELECT 1",
      "$$",
    ].join("\n");
    expect(calls(commented), "unstripped, the comment lines match the call shape -- the over-read").toBe(2);
    expect(calls(stripSql(commented)), "stripped, comments count for nothing").toBe(0);
    expect((commented.match(/get_company_fill_curve/g) ?? []).length, "a raw grep over-reads further still").toBe(3);
    const real = commented.replace("SELECT 1", "SELECT count(*) FROM public.get_company_fill_curve(ARRAY(SELECT 'a'))");
    expect(calls(stripSql(real)), "the code call is counted").toBe(1);
  });

  it("TEETH: a file that re-issues the function twice is read by its LAST copy, the one the database keeps", () => {
    const twice = [
      "CREATE OR REPLACE FUNCTION public.y() RETURNS int LANGUAGE sql AS $$",
      "  SELECT count(*) FROM public.get_company_fill_curve(ARRAY(SELECT 'a'))",
      "  UNION ALL SELECT count(*) FROM public.get_company_fill_curve(ARRAY(SELECT 'b'))",
      "$$;",
      "-- re-issued below, as this repo has done before",
      "CREATE OR REPLACE FUNCTION public.y() RETURNS int LANGUAGE sql AS $$",
      "  SELECT count(*) FROM public.get_company_fill_curve(ARRAY(SELECT 'a'))",
      "$$;",
    ].join("\n");
    const first = twice.match(/CREATE[\s\S]*?\$\$[\s\S]*?\$\$/)?.[0] ?? "";
    expect(calls(stripSql(first)), "the first copy would fail the guard").toBe(2);
    const live = lastDefinition(twice, "y");
    expect(live).not.toBeNull();
    expect(calls(stripSql(live!)), "the last copy is the live one").toBe(1);
    expect(lastDefinition(twice, "z")).toBeNull();
  });

  it("TEETH: the argument is read to its balancing paren, so a correlated read after a nested close is caught", () => {
    // The first '))' closes f(y) and the inner ARRAY; o.tok sits AFTER it.
    const call = "FROM public.get_company_fill_curve(ARRAY(SELECT t.tok FROM ts t WHERE f(t.y)) || ARRAY[o.tok])";
    const prefix = call.slice(0, call.indexOf("))") + 2);
    expect(prefix, "a first-'))' cut never reaches the outer read").not.toMatch(/o\.tok/);
    const whole = callAt(call, 0);
    expect(whole).toBe(call);
    expect(uncorrelated(whole)).toEqual({ ok: false, outer: ["o"] });
    // The live shape passes: every alias it reads (a.*) is one it defines.
    const clean = "FROM public.get_company_fill_curve(ARRAY(SELECT a.company_token FROM admissible a ORDER BY a.dated_n DESC LIMIT 200))";
    expect(callAt(clean, 0)).toBe(clean);
    expect(uncorrelated(clean)).toEqual({ ok: true, outer: [] });
    // And an outer read spelled like the live aliases would be named, not passed.
    expect(uncorrelated(clean.replace("LIMIT 200", "WHERE a.company_token = f.company_token LIMIT 200")).outer).toEqual(["f"]);
  });
});
