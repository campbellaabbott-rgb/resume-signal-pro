/**
 * THE WORST FAILURE THIS PRODUCT HAS, AND NOTHING WAS WATCHING IT.
 *
 * Found in the 2026-08-06 audit. `email_send_log` records every send with a
 * status, and no surface read it: check-error-spikes SENDS alert email but does
 * not MONITOR email, neither process-email-queue nor send-scan-report has a
 * failure-alert path, and the heartbeat had no delivery check.
 *
 * So a paid report that never arrives had exactly one signal — a refund
 * request. The log held the answer the whole time.
 *
 * IT WAS ALSO UNREADABLE, WHICH IS WHY IT WENT UNNOTICED. The table is granted
 * to service_role only, so an anon probe returns `200 []` — the identical
 * answer for "nothing has failed" and "you cannot see this". A check that
 * cannot distinguish a healthy system from a blind one is not a check.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const sqlFile = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("FUNCTION public.email_delivery_health"))
  .sort().pop()!;
const bare = readFileSync(resolve(DIR, sqlFile), "utf8").replace(/--[^\n]*/g, "");
const hb = readFileSync(resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");

const bodyOf = (src: string, name: string): string => {
  const start = src.indexOf(`async function ${name}`);
  if (start < 0) return "";
  const ends = ["\nasync function ", "\n/**"].map((m) => src.indexOf(m, start + 1)).filter((i) => i > -1);
  return src.slice(start, ends.length ? Math.min(...ends) : src.length);
};

describe("it cannot leak who was emailed", () => {
  it("returns a status, a count and a timestamp — nothing else", () => {
    // recipient_email is a customer's address and error_message can quote a
    // provider response containing one. The projection is what makes this safe
    // to expose, not the caller.
    const sig = bare.slice(bare.indexOf("RETURNS TABLE"), bare.indexOf("LANGUAGE sql"));
    expect(sig).toMatch(/status text/);
    expect(sig).toMatch(/n bigint/);
    expect(sig).toMatch(/last_at timestamptz/);
    for (const forbidden of ["recipient", "email", "error", "message_id", "metadata"]) {
      expect(sig.toLowerCase(), `${forbidden} must not be returned`).not.toContain(forbidden);
    }
  });

  it("defines stuck by EXCLUDING terminal states, not by listing live ones", () => {
    // Listing the non-terminal statuses positively would mean this silently
    // stops covering any status added later — which is precisely how `pending`
    // escaped. An unrecognised status is far likelier to be stuck than fine.
    expect(bare).toMatch(/NOT IN \('sent', 'failed', 'bounced', 'complained', 'suppressed', 'dlq'\)/);
    expect(bare).toMatch(/interval '2 hours'/);
  });

  it("drops before recreating in the migration that changed the signature", () => {
    // Postgres will not CREATE OR REPLACE across a signature change; without the
    // drop that migration applies cleanly and changes nothing. Pinned to the
    // file that actually added the column — later migrations keep the same
    // signature and correctly have no DROP, so asserting this against whichever
    // file is newest would fail for the right code.
    const sigChange = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(resolve(DIR, f), "utf8"))
      .find((t) => t.includes("DROP FUNCTION IF EXISTS public.email_delivery_health"));
    expect(sigChange, "no migration drops the old signature").toBeDefined();
    const drop = sigChange!.indexOf("DROP FUNCTION IF EXISTS public.email_delivery_health");
    const create = sigChange!.indexOf("CREATE OR REPLACE FUNCTION public.email_delivery_health");
    expect(create).toBeGreaterThan(drop);
  });

  it("counts stuck WITHOUT a time window — it is a condition, not an event", () => {
    // MEASURED LIVE 2026-08-06, minutes after the windowed version deployed:
    //   p_hours=24   -> []                       <- what the heartbeat asks for
    //   p_hours=8760 -> [{"status":"pending","stuck":1}]
    // The row had been stuck 34 days and the heartbeat reported 'idle'. A
    // windowed stuck count can only fire between hour 2 and hour 24, then goes
    // quiet with nothing fixed — which reads as resolved, and is worse than
    // never having counted it.
    // Isolate the ONE filter: a fixed-width slice backwards swallows the
    // neighbouring windowed count and asserts the opposite of what is meant.
    const i = bare.indexOf("AS stuck");
    const stuckFilter = bare.slice(bare.lastIndexOf("count(*) FILTER", i), i);
    expect(stuckFilter).toMatch(/NOT IN/);
    expect(stuckFilter).not.toMatch(/make_interval/);
  });

  it("admits a currently-stuck status that has nothing in the window", () => {
    // Without this the GROUP BY drops the status and the count has nowhere to
    // live — which is exactly why p_hours=24 returned [] rather than stuck>0.
    const where = bare.slice(bare.indexOf("FROM public.email_send_log"));
    expect(where).toMatch(/OR \(s\.status NOT IN/);
  });

  it("never selects the address or the error text", () => {
    expect(bare).not.toMatch(/recipient_email/);
    expect(bare).not.toMatch(/error_message/);
  });

  it("is revoked from PUBLIC before anything is granted", () => {
    // A GRANT without a REVOKE leaves PUBLIC access — how 107 of 121 definer
    // functions here ended up anon-callable.
    const rev = bare.indexOf("REVOKE ALL ON FUNCTION public.email_delivery_health");
    const grant = bare.indexOf("GRANT EXECUTE ON FUNCTION public.email_delivery_health");
    expect(rev).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(rev);
  });
});

describe("what counts as a failure", () => {
  const fn = bodyOf(hb, "evaluateDelivery");

  it("counts the states where the person did not get it", () => {
    expect(fn).toMatch(/of\('failed'\) \+ of\('bounced'\) \+ of\('dlq'\)/);
  });

  it("does NOT count suppressed as a failure", () => {
    // Suppression is the system correctly refusing to mail someone who
    // unsubscribed or hard-bounced before. Counting it would manufacture a
    // failure rate out of the safety feature working.
    const failLine = fn.slice(fn.indexOf("const failed"), fn.indexOf("const total"));
    expect(failLine).not.toMatch(/suppressed/);
  });

  it("separates idle from clean — they are not the same state", () => {
    // No email in 24h is normal on a quiet day and catastrophic on a busy one,
    // and only a human knows which. It must not read as healthy or as broken.
    expect(fn).toMatch(/'idle'/);
    expect(fn).toMatch(/'clean'/);
    expect(fn).toMatch(/'failures'/);
  });

  it("counts what is neither sent nor failed", () => {
    // MEASURED IN PRODUCTION 2026-08-06, hours after this check shipped: one row
    // pending since 2026-07-03. `total = sent + failed` excluded it entirely, so
    // a log of nothing but stranded sends reported 'clean' with a null failRate.
    expect(fn).toMatch(/const stuck = rows\.reduce\(\(a, r\) => a \+ r\.stuck, 0\)/);
  });

  it("a stranded queue outranks clean", () => {
    // Zero failures plus a stuck queue is not a clean run. Order matters here:
    // if 'clean' were tested first, `stalled` could never be reached.
    expect(fn).toMatch(/stuck > 0 \? 'stalled'/);
    // Comments stripped: the prose explaining this ordering names both states,
    // and matching it instead of the code inverts the very thing being checked.
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    const ternary = code.slice(code.indexOf("reason: (total + stuck)"));
    expect(ternary.indexOf("'stalled'"), "stalled must be decided before clean")
      .toBeLessThan(ternary.indexOf("'clean'"));
  });

  it("does not call a stalled queue idle either", () => {
    // `idle` means nothing happened. A stuck row is something that happened and
    // then stopped, so it must keep the check out of the idle branch.
    expect(fn).toMatch(/\(total \+ stuck\) === 0 \? 'idle'/);
  });

  it("reports zero as a value rather than as silence", () => {
    // A field that only appears when something is wrong is indistinguishable
    // from a field that stopped being computed.
    expect(fn).toMatch(/sent,/);
    expect(fn).toMatch(/failed,/);
  });

  it("gives failRate as null when there is nothing to divide", () => {
    expect(fn).toMatch(/total > 0 \? Math\.round/);
  });
});

describe("the heartbeat carries it", () => {
  it("is reported on every run", () => {
    // Trailing comma optional: this was pinned as the last key in the response
    // object, so adding productDelivery after it broke an assertion about
    // punctuation rather than about behaviour.
    expect(hb).toMatch(/^\s*delivery,?\s*$/m);
    expect(hb).toMatch(/const delivery = await evaluateDelivery\(supabase\)/);
  });

  it("a missing RPC degrades to a reason, never a failed heartbeat", () => {
    const fn = bodyOf(hb, "evaluateDelivery");
    expect(fn).toMatch(/'rpc-missing'/);
    expect(fn).toMatch(/catch/);
    expect(fn).not.toMatch(/\bthrow\b/);
  });

  it("does not page on the fail rate yet, deliberately", () => {
    // A first version that alerted on this would fire on the first bounced
    // address from a typo, and a muted alert is worse than the silence it
    // replaced. Threshold comes from real numbers, later.
    const i = hb.indexOf("const delivery = await evaluateDelivery");
    expect(hb.slice(i, i + 400)).not.toMatch(/overallStatus\s*=/);
  });
});
