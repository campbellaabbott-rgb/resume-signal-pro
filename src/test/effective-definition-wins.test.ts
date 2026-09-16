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

/**
 * THE PASS (2026-09-17): api_key_check now starts a paid clock and serves a
 * pass's limits, and four new definer functions grant, spend, refund and
 * measure it. Each is pinned on its WINNING definition, for the same reason
 * as the claim gate above: the deploy pipeline re-emits migrations under
 * fresh stamps, and a re-emitted copy of the pre-pass api_key_check would
 * silently serve every pass holder the free key's limits. Properties, not
 * spellings — each is the clause whose loss changes what a customer gets.
 */
describe("api_key_check — the pass overlay and its clock, on the winning definition", () => {
  const { file, sql } = effectiveDefinition("api_key_check");
  const code = bare(sql);

  it(`the winning definition is a real file (${file})`, () => {
    expect(file).toMatch(/^\d{14}_/);
  });

  for (const [what, re] of [
    ["the overlay applies to /mcp/ endpoints only", /p_endpoint LIKE '\/mcp\/%'/],
    ["the rate ceiling is COMPARED against the overlay, not merely returned", /IF v_rate > v_rate_limit THEN/],
    ["the quota ceiling is COMPARED against the overlay", /IF v_day_used > v_quota_limit THEN/],
    ["the tier answers the pass while an open pass exists", /v_tier\s*:= CASE WHEN v_pass_id IS NOT NULL THEN 'pass'/],
    ["key_status never starts the clock", /p_endpoint <> '\/mcp\/key_status'/],
    ["the clock is the ROW's own session_hours", /make_interval\(hours => ap\.session_hours\)/],
    ["activation happens once — only a pass not yet activated", /WHERE ap\.id = v_pass_id AND ap\.activated_at IS NULL/],
    ["the shared lazy close runs before the overlay read", /coalesce\(ap\.expires_at, ap\.shelf_expires_at\) <= now\(\)/],
    ["the two pass columns are appended to the return shape", /pass_ends_at timestamptz,\s*pass_apps_left integer/],
  ] as const) {
    it(`still enforces ${what}`, () => {
      expect(code, `${what} is absent from ${file}, the definition that wins`).toMatch(re);
    });
  }

  it("activation sits on the allowed path — after every refusal has returned", () => {
    const activate = code.indexOf("p_endpoint <> '/mcp/key_status'");
    for (const refusal of ["'rate_limited'", "'revoked'", "'quota_exceeded'"]) {
      expect(code.indexOf(refusal), `${refusal} must return before activation`).toBeLessThan(activate);
    }
    expect(code.indexOf("RETURN QUERY SELECT true, 'ok'")).toBeGreaterThan(activate);
  });
});

describe("agent_queue_enqueue — accept and pay in one statement, on the winning definition", () => {
  const { file, sql } = effectiveDefinition("agent_queue_enqueue");
  const code = bare(sql);

  for (const [what, re] of [
    ["the pass row is LOCKED before it is judged", /FOR UPDATE/],
    ["a duplicate writes nothing", /ON CONFLICT \(user_id, posting_id\) DO NOTHING/],
    ["a duplicate spends nothing", /'already_queued'/],
    ["an exhausted pass is refused with nothing written", /'pass_exhausted'/],
    ["a pass that is not live is refused", /'pass_not_live'/],
    ["the account comes from the parameter, never the row", /VALUES \(\s*p_user_id,/],
    ["the increment is on the locked row", /SET applications_used = ap\.applications_used \+ 1/],
  ] as const) {
    it(`still enforces ${what}`, () => {
      expect(code, `${what} is absent from ${file}, the definition that wins`).toMatch(re);
    });
  }

  it("the increment follows the insert, never precedes it", () => {
    expect(code.indexOf("INSERT INTO public.agent_queue")).toBeLessThan(code.indexOf("applications_used + 1"));
  });
});

describe("agent_pass_refund_on_failure — gives back only what the code actually writes", () => {
  const { file, sql } = effectiveDefinition("agent_pass_refund_on_failure");
  const code = bare(sql);

  for (const [what, re] of [
    ["refunds a stale packet", /NEW\.status = 'stale'/],
    ["refunds a blocked packet only when the send gave up or errored", /NEW\.status = 'blocked' AND \(NEW\.attempts >= 99 OR coalesce\(NEW\.error, ''\) <> ''\)/],
    ["floors at zero", /greatest\(ap\.applications_used - 1, 0\)/],
    ["fires once — the stamp is the idempotency", /NEW\.pass_refunded_at IS NULL/],
    ["fires on INSERT as well (stale is insert-only)", /AFTER INSERT OR UPDATE OF status ON public\.agent_submissions/],
  ] as const) {
    it(`still enforces ${what}`, () => {
      expect(code, `${what} is absent from ${file}, the definition that wins`).toMatch(re);
    });
  }

  it("never refunds on 'failed' (no code path writes it) or on a plain preparation-time 'blocked'", () => {
    expect(code).not.toMatch(/NEW\.status = 'failed'/);
    expect(code).not.toMatch(/NEW\.status = 'blocked' THEN/);
  });
});

describe("agent_pass_grant — one row per paid session, on the winning definition", () => {
  const { file, sql } = effectiveDefinition("agent_pass_grant");
  const code = bare(sql);

  for (const [what, re] of [
    ["idempotent on the session id", /ON CONFLICT \(stripe_session_id\) DO NOTHING/],
    ["a second open pass is refused, never stacked", /'pass_already_open'/],
    ["the refusal is keyed on the partial UNIQUE's own name", /agent_passes_one_open_pass_per_user/],
    ["every number is copied in from a parameter", /p_session_hours, p_applications_total, p_rate_per_min, p_daily_quota,/],
    ["the shelf is the parameter's days", /make_interval\(days => p_shelf_days\)/],
    ["an unknown unique violation is re-raised, never swallowed", /RAISE;/],
  ] as const) {
    it(`still enforces ${what}`, () => {
      expect(code, `${what} is absent from ${file}, the definition that wins`).toMatch(re);
    });
  }
});

describe("the pass functions keep their REVOKE on their winning definitions", () => {
  for (const [fn, args] of [
    ["api_key_check", "text, text"],
    ["agent_pass_grant", "uuid, text, text, integer, integer, integer, integer, integer, integer"],
    ["agent_queue_enqueue", "uuid, text, jsonb, boolean"],
    ["agent_pass_refund_on_failure", ""],
    ["agent_pass_metrics", "integer"],
  ] as const) {
    it(`${fn} is revoked from PUBLIC, anon AND authenticated by name, and granted only to service_role`, () => {
      const { file, sql } = effectiveDefinition(fn);
      const code = bare(sql);
      const sig = args.replace(/[()]/g, "\\$&").replace(/, /g, ",\\s*");
      expect(code, `${fn} lost its REVOKE in ${file}`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(${sig}\\) FROM PUBLIC, anon, authenticated`),
      );
      expect(code).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(${sig}\\) TO service_role`));
      expect(code).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO (?:anon|authenticated|PUBLIC)`));
      expect(code).toMatch(/SECURITY DEFINER/);
      expect(code).toMatch(/SET search_path = public/);
    });
  }
});

describe("teeth: a re-emitted copy of the PRE-PASS api_key_check would fail the overlay pins", () => {
  it("the last definition before the overlay first appeared, which a re-stamped copy would restore, lacks it", () => {
    // Not "the second-newest file": the overlay has been carried forward
    // into later definitions (20260917230000 exempts two read families from
    // activation and keeps everything else), and the pipeline re-emits
    // applied files under fresh stamps, so the file before the winner can be
    // an overlay definition too. The copy that would silently revert a pass
    // holder to free limits is the last one WITHOUT the overlay — found by
    // the pin, then checked against every other pin.
    const hits = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("FUNCTION public.api_key_check("))
      .sort();
    expect(hits.length).toBeGreaterThan(1);
    const overlay = /p_endpoint LIKE '\/mcp\/%'/;
    const firstWithOverlay = hits.findIndex((f) => overlay.test(bare(readFileSync(resolve(DIR, f), "utf8"))));
    expect(firstWithOverlay, "no definition carries the overlay").toBeGreaterThan(0);
    const previous = bare(readFileSync(resolve(DIR, hits[firstWithOverlay - 1]), "utf8"));
    const winner = bare(readFileSync(resolve(DIR, hits[hits.length - 1]), "utf8"));
    for (const re of [overlay, /IF v_rate > v_rate_limit THEN/, /p_endpoint <> '\/mcp\/key_status'/, /make_interval\(hours => ap\.session_hours\)/]) {
      expect(previous, `the pin ${re} must discriminate the pre-pass definition`).not.toMatch(re);
      expect(winner).toMatch(re);
    }
  });
});
