/**
 * A MIGRATION FILE IS NOT THE SCHEMA. THE LAST ONE IS.
 *
 * I diagnosed the daily-cap bug by reading 20260730050000 and reporting what it
 * said as current behaviour. It had been superseded a day earlier. The habit
 * that produced that mistake — open the file that defines the thing, read it,
 * believe it — is the same habit that would miss a guard being silently reverted,
 * so this file never trusts a named migration. It finds EVERY migration that
 * defines a safety-critical function, sorts by stamp, and tests only the winner.
 *
 * WHY THIS IS NOT THEORETICAL. The deploy pipeline re-emits each applied
 * migration into the repo under a FRESH timestamp. On 4 August the sequence was:
 *
 *   20260804050000  mine       claim gate WITHOUT the cap
 *   20260804060000  mine       claim gate WITH the cap
 *   20260804183636  re-emitted copy of 050000   <- reverts the cap
 *   20260804192051  re-emitted copy of 060000   <- restores it
 *
 * Production is correct because the copies were emitted in the same order as the
 * originals. Nothing enforces that. A deploy that re-emitted 050000 and not
 * 060000 — because the two were pushed either side of it, which is exactly what
 * happened — would leave the LAST definition capless, and every replay onto a
 * fresh database would quietly drop the gate that stops a backlog draining past
 * what a candidate asked for. No test would fail, because my own tests read the
 * file I wrote rather than the file that wins.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");

/** The definition a fresh replay ends up with: last by stamp order, not by authorship. */
function effectiveDefinition(fnName: string): { file: string; sql: string } {
  const hits = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes(`FUNCTION public.${fnName}(`))
    .sort();
  if (hits.length === 0) throw new Error(`no migration defines ${fnName}`);
  const file = hits[hits.length - 1];
  return { file, sql: readFileSync(resolve(DIR, file), "utf8") };
}

/** Strip `--` comments so prose about a guard can never stand in for the guard. */
const bare = (s: string) => s.replace(/--[^\n]*/g, "");

describe("agent_claim_submission — the last gate before an employer", () => {
  const { file, sql } = effectiveDefinition("agent_claim_submission");
  const code = bare(sql);

  it(`the winning definition is a real file (${file})`, () => {
    expect(file).toMatch(/^\d{14}_/);
  });

  // Each of these has cost something to learn. Named individually so a revert is
  // reported as the specific protection that vanished, not as a count mismatch.
  for (const [what, re] of [
    ["the daily cap", /auto_apply_daily_cap/],
    ["the cancel window", /c\.claimable_at IS NULL OR c\.claimable_at <= now\(\)/],
    ["released-only", /c\.released_at IS NOT NULL/],
    ["never resend", /c\.submitted_at IS NULL/],
    ["ready-only", /c\.status = 'ready'/],
    ["attempt ceiling", /c\.attempts < 3/],
    ["lease expiry", /c\.claimed_at IS NULL OR c\.claimed_at </],
  ] as const) {
    it(`still enforces ${what}`, () => {
      expect(code, `${what} is absent from ${file}, the definition that wins`).toMatch(re);
    });
  }

  it("the cap counts submissions, not in-flight releases", () => {
    // Counting in-flight here would make the packet being claimed count against
    // itself: nothing would ever be claimable, and a total outage would present
    // as an empty queue.
    const i = code.indexOf("auto_apply_daily_cap");
    const clause = code.slice(Math.max(0, i - 600), i);
    expect(clause).toMatch(/d\.submitted_at >= date_trunc\('day', now\(\)\)/);
    expect(clause).not.toMatch(/d\.released_at/);
  });

  it("a missing mandate row does not strand packets forever", () => {
    expect(code).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM public\.agent_mandates/);
  });

  it("no top-level OR — one unbracketed operator makes every guard optional", () => {
    // `A AND B OR C` parses as `(A AND B) OR C`. In this function that yields a
    // gate handing out unreleased and already-submitted packets. Checked by
    // walking paren depth rather than by matching text, because the shape is the
    // bug and any regex for it is a regex for one spelling of it.
    const where = code.slice(code.indexOf("WHERE c.status"), code.indexOf("ORDER BY"));
    let depth = 0;
    let topLevelOr = false;
    for (let i = 0; i < where.length; i++) {
      const ch = where[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (
        depth === 0 &&
        where.startsWith("OR", i) &&
        /\s/.test(where[i - 1] ?? " ") &&
        !/[A-Za-z]/.test(where[i + 2] ?? " ")   // do not match ORDER
      ) {
        topLevelOr = true;
        break;
      }
    }
    expect(topLevelOr, `top-level OR in ${file} makes every other claim guard optional`).toBe(false);
    expect(depth, `unbalanced parentheses in ${file}`).toBe(0);
  });
});

describe("agent_cancel_pending — the button that must not lie", () => {
  const { file, sql } = effectiveDefinition("agent_cancel_pending");
  const code = bare(sql);

  for (const [what, re] of [
    ["scoping to your own rows in SQL", /user_id = auth\.uid\(\)/],
    ["refusing once already sent", /submitted_at IS NULL/],
    ["refusing once a worker holds it", /claimed_at IS NULL/],
    ["reporting whether it actually cancelled", /ROW_COUNT|v_rows > 0/],
  ] as const) {
    it(`still enforces ${what}`, () => {
      expect(code, `${what} is absent from ${file}, the definition that wins`).toMatch(re);
    });
  }
});

/**
 * The generic version of the same hazard: any function whose definition is
 * re-emitted must not LOSE its REVOKE. A definer function that reaches anon is
 * how 107 of 121 became anon-callable, one of them granting paid credits.
 */
describe("re-emitted definer functions keep their REVOKE", () => {
  for (const fn of ["agent_claim_submission", "agent_note_auto_release", "agent_prepare_now"]) {
    it(`${fn} is revoked from anon in its winning definition`, () => {
      const { file, sql } = effectiveDefinition(fn);
      expect(bare(sql), `${fn} lost its REVOKE in ${file}`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`),
      );
    });
  }
});
