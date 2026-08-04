/**
 * THE INSTANT-START FIRED BEFORE THERE WAS ANYTHING TO START.
 *
 * 20260804040000 kicked apply-agent from stripe-webhook the moment a
 * subscription activated, so nobody would wait for :23. But apply-agent begins
 * with `agent_mandates WHERE active = true`, and at checkout the buyer has no
 * mandate — nothing creates one there, and the only writers are two Account
 * panels driven by hand afterwards. The kick found nobody and bought zero
 * seconds; the wait simply moved to just after setup, which is the worst place
 * for it, because that is when somebody is actually watching.
 *
 * This is the same failure shape as a guard on an unselected PostgREST column:
 * the code runs, the call succeeds, and it operates on nothing. "It fired" and
 * "it did something" are different claims, and only the second one matters.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const sql = readFileSync(resolve(DIR, "20260805010000_the_first_run_starts_when_you_ask.sql"), "utf8");
/** Strip `--` comments: prose naming a guard must never stand in for the guard. */
const code = sql.replace(/--[^\n]*/g, "");

describe("the kick is bound to the mandate, not the payment", () => {
  it("fires on the mandate table", () => {
    expect(code).toMatch(/ON public\.agent_mandates/);
  });

  it("fires on creation AND on being switched back on", () => {
    expect(code).toMatch(/BEFORE INSERT OR UPDATE OF active ON public\.agent_mandates/);
  });

  it("does NOT fire on every mandate edit", () => {
    // `UPDATE OF active` is load-bearing. A bare `UPDATE` would re-kick on every
    // cap tweak and blocklist edit the panels write, turning a head start into a
    // steady drip of invocations against a paid pipeline.
    const trig = code.slice(code.indexOf("CREATE TRIGGER"));
    expect(trig).not.toMatch(/BEFORE INSERT OR UPDATE ON/);
  });

  it("actually calls the preparer", () => {
    expect(code).toMatch(/PERFORM public\.agent_prepare_now\(\)/);
  });
});

describe("it cannot become a free button on a paid pipeline", () => {
  it("is SECURITY DEFINER — without it the call is denied and nothing happens", () => {
    // agent_prepare_now is granted to service_role alone. A trigger function
    // runs as the INVOKING user unless it is definer, so an invoker-rights
    // version would hit the EXECUTE check every time and silently do nothing
    // while looking completely wired up.
    const fn = code.slice(code.indexOf("FUNCTION public.agent_kick_on_mandate"));
    expect(fn.slice(0, fn.indexOf("AS $$"))).toMatch(/SECURITY DEFINER/);
  });

  it("is throttled, so toggling active in a loop cannot be used as one", () => {
    expect(code).toMatch(/last_prepare_kick_at > now\(\) - interval '5 minutes'/);
    expect(code).toMatch(/NEW\.last_prepare_kick_at := now\(\)/);
  });

  it("the throttle reads a MISSING stamp as eligible", () => {
    // Permissive-when-absent, the rule every gate here follows. Every mandate
    // written before this column existed has NULL, and reading NULL as "recently
    // kicked" would mean none of them ever gets its first one.
    expect(code).toMatch(/NEW\.last_prepare_kick_at IS NOT NULL\s*\n?\s*AND/);
  });

  it("keeps the function off anon and authenticated", () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.agent_kick_on_mandate\(\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it("does not grant agent_prepare_now to the client as a shortcut", () => {
    // The tempting fix was to let the panel call it directly. That hands every
    // signed-in account the ability to invoke the pipeline on demand.
    expect(code).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.agent_prepare_now\(\) TO authenticated/);
  });
});

describe("a failed kick never costs somebody their mandate", () => {
  it("swallows any error from the preparer", () => {
    // The mandate is the thing that matters; the head start is a convenience.
    // A missing vault key or an unhappy pg_net must not surface as a save error
    // on the form somebody just filled in.
    const fn = code.slice(code.indexOf("FUNCTION public.agent_kick_on_mandate"));
    expect(fn).toMatch(/BEGIN\s*\n?\s*PERFORM public\.agent_prepare_now\(\);\s*\n?\s*EXCEPTION WHEN OTHERS THEN/);
  });

  it("an inactive mandate is a draft, not a request", () => {
    expect(code).toMatch(/IF NOT COALESCE\(NEW\.active, false\) THEN\s*\n?\s*RETURN NEW;/);
  });

  it("returns NEW on every path — a BEFORE trigger returning NULL drops the row", () => {
    const fn = code.slice(code.indexOf("FUNCTION public.agent_kick_on_mandate"), code.indexOf("REVOKE ALL"));
    expect(fn).not.toMatch(/RETURN NULL/);
    expect((fn.match(/RETURN NEW;/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("the trigger survives being re-emitted under a later stamp", () => {
  it("the winning definition of agent_kick_on_mandate still calls the preparer", () => {
    // Same rule as effective-definition-wins: the deploy re-emits migrations at
    // the current wall clock, so the file that runs last is not necessarily the
    // file that was written last.
    const hits = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("FUNCTION public.agent_kick_on_mandate"))
      .sort();
    expect(hits.length).toBeGreaterThan(0);
    const winner = readFileSync(resolve(DIR, hits[hits.length - 1]), "utf8").replace(/--[^\n]*/g, "");
    expect(winner, `agent_kick_on_mandate lost its call in ${hits[hits.length - 1]}`)
      .toMatch(/PERFORM public\.agent_prepare_now\(\)/);
  });
});
