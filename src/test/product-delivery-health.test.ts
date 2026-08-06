/**
 * THE HALF OF THE MONEY FAILURE SPACE NOTHING WAS WATCHING.
 *
 * Found in the 2026-08-06 audit, tracing all six checkout paths end to end. The
 * delivery chain is sound: every product_type the catalogue emits has a handler,
 * failures land in product_deliveries, and retry-failed-deliveries is genuinely
 * scheduled. It is the END of the chain that breaks — the retry marks a row
 * 'generation_failed' and tells nobody.
 *
 * AND reconcile-stripe CANNOT COVER IT. That sweep finds paid sessions with no
 * used_stripe_sessions marker, and the webhook writes that marker BEFORE it
 * generates anything. So a failure after the marker looks fulfilled to the
 * sweep, permanently. The two checks are disjoint by construction:
 *
 *   reconcile-stripe  →  "the webhook never ran"
 *   this              →  "the webhook ran and the product never came"
 *
 * Plus a state nobody writes deliberately: 'payment_received' and 'generating'
 * are transient by design and terminal by accident, when the webhook dies
 * mid-flight. Also paid, also nothing delivered, also invisible.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const sqlFile = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("FUNCTION public.product_delivery_health"))
  .sort().pop()!;
const bare = readFileSync(resolve(DIR, sqlFile), "utf8").replace(/--[^\n]*/g, "");
const hb = readFileSync(resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");

const bodyOf = (src: string, name: string): string => {
  const start = src.indexOf(`async function ${name}`);
  if (start < 0) return "";
  const ends = ["\nasync function ", "\n/**"].map((m) => src.indexOf(m, start + 1)).filter((i) => i > -1);
  return src.slice(start, ends.length ? Math.min(...ends) : src.length);
};

describe("it cannot leak who bought what", () => {
  it("returns a status and numbers — nothing else", () => {
    const sig = bare.slice(bare.indexOf("RETURNS TABLE"), bare.indexOf("LANGUAGE sql"));
    expect(sig).toMatch(/status text/);
    expect(sig).toMatch(/n bigint/);
    expect(sig).toMatch(/exhausted bigint/);
    expect(sig).toMatch(/stuck bigint/);
    for (const forbidden of ["email", "error", "product_type", "stripe_session", "metadata"]) {
      expect(sig.toLowerCase(), `${forbidden} must not be returned`).not.toContain(forbidden);
    }
  });

  it("never selects the address or the error text", () => {
    // generation_error can quote a provider response containing an address.
    expect(bare).not.toMatch(/customer_email/);
    expect(bare).not.toMatch(/generation_error/);
    expect(bare).not.toMatch(/last_retry_error/);
  });

  it("is revoked from PUBLIC before anything is granted", () => {
    const rev = bare.indexOf("REVOKE ALL ON FUNCTION public.product_delivery_health");
    const grant = bare.indexOf("GRANT EXECUTE ON FUNCTION public.product_delivery_health");
    expect(rev).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(rev);
  });
});

describe("what the SQL actually counts", () => {
  it("counts exhausted retries — the permanently-failed state", () => {
    expect(bare).toMatch(/retry_count >= d\.max_retries/);
  });

  it("counts rows stranded in a state that should be transient", () => {
    expect(bare).toMatch(/'payment_received', 'generating', 'generation_failed'/);
    expect(bare).toMatch(/interval '2 hours'/);
  });
});

describe("what counts as undelivered", () => {
  const fn = bodyOf(hb, "evaluateProductDelivery");

  it("treats generated and delivered as the two good states", () => {
    expect(fn).toMatch(/of\('delivered'\) \+ of\('content_generated'\)/);
  });

  it("does NOT let a successful generation hide a failed email", () => {
    // The two checks are deliberately separate. Folding email success into this
    // one would mean a product that generated but never sent reads as healthy
    // here and never gets looked at again.
    const good = fn.slice(fn.indexOf("const delivered"), fn.indexOf("const failed"));
    expect(good).not.toMatch(/email/i);
  });

  it("separates idle from clean — they are not the same state", () => {
    expect(fn).toMatch(/'idle'/);
    expect(fn).toMatch(/'clean'/);
    expect(fn).toMatch(/'undelivered'/);
  });

  it("counts stuck rows as undelivered, not as quiet", () => {
    // A row stuck in `generating` is the failure that no code path writes
    // deliberately, so it is the one most likely to be read as nothing-happened.
    expect(fn).toMatch(/\(failed \+ stuck\) === 0 \? 'clean'/);
  });

  it("reports zero as a value rather than as silence", () => {
    expect(fn).toMatch(/delivered, failed, exhausted, stuck,/);
  });
});

describe("the heartbeat carries it", () => {
  it("is reported on every run", () => {
    expect(hb).toMatch(/const productDelivery = await evaluateProductDelivery\(supabase\)/);
    expect(hb).toMatch(/^\s*productDelivery\s*$/m);
  });

  it("a missing RPC degrades to a reason, never a failed heartbeat", () => {
    // The migration and the function deploy separately; during that window the
    // RPC does not exist and the heartbeat must not start failing over it.
    const fn = bodyOf(hb, "evaluateProductDelivery");
    expect(fn).toMatch(/'rpc-missing'/);
    expect(fn).toMatch(/catch/);
    expect(fn).not.toMatch(/\bthrow\b/);
  });

  it("does not page on it yet, deliberately", () => {
    // Same reasoning as the email check: a first version that alerted would
    // fire on the first genuinely-unrecoverable purchase, and a muted alert is
    // worse than the silence it replaced. Threshold comes from real numbers.
    const i = hb.indexOf("const productDelivery = await evaluateProductDelivery");
    expect(hb.slice(i, i + 400)).not.toMatch(/overallStatus\s*=/);
  });
});
