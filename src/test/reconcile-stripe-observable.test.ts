/**
 * THE SAFETY NET FOR SOMEBODY PAYING AND GETTING NOTHING COULD NOT SAY IF IT RAN.
 *
 * Found in the 2026-08-06 audit. reconcile-stripe lists recent PAID Stripe
 * sessions, finds those with no delivery marker, and emails the owner to recover
 * them. It emails ONLY on finding orphans — so a healthy day is silent, and a
 * dead cron is silent, and the reassuring reading is the default one.
 *
 * The 20260714130000 migration proves the job was CREATED. It does not prove it
 * still fires: cron.job is not anon-readable and the function wrote no stamp.
 *
 * THE PART THAT IS EASY TO GET WRONG. apply-agent derives its trigger from
 * `{"source":"cron"}` in the body, which is sound there because apply-agent
 * requires a JWT. reconcile-stripe is verify_jwt=false with no secret gate, so
 * the same pattern would let anyone set the light green — and far more likely,
 * would let US fake it by curling the function with the cron's own body while
 * testing. So the timestamp is written by scheduled SQL that has no HTTP path.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
// The migration that CREATES the tick, not merely one that mentions it. A
// name-only filter picks the LATEST such file, which is now 20260808134902 —
// the migration that fixed the grant — and every assertion about the creating
// migration then fails for entirely the wrong reason.
const migFile = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(resolve(DIR, f), "utf8")
    .includes("CREATE OR REPLACE FUNCTION public.reconcile_stripe_tick"))
  .sort().pop()!;
const mig = readFileSync(resolve(DIR, migFile), "utf8");
const bare = mig.replace(/--[^\n]*/g, "");
const fn = readFileSync(
  resolve(__dirname, "../../supabase/functions/reconcile-stripe/index.ts"), "utf8");
const board = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("only the scheduler can claim the schedule ran", () => {
  it("revokes the tick from anon BY NAME — revoking PUBLIC alone did not work", () => {
    // THIS ASSERTION USED TO CHECK ONLY `FROM PUBLIC`, AND PASSED WHILE THE
    // FUNCTION WAS WORLD-CALLABLE. Measured as anon 2026-08-08:
    // POST /rpc/reconcile_stripe_tick returned 204 and stamped lastCronAt.
    // This database grants EXECUTE to anon on newly created functions, and a
    // grant held directly by anon survives a PUBLIC revoke — so the statement
    // ran, succeeded, and removed a privilege nothing was using.
    //
    // The trust basis is the by-name revoke, so that is what is pinned.
    const revokes = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(resolve(DIR, f), "utf8"))
      .filter((t) => t.includes("REVOKE ALL ON FUNCTION public.reconcile_stripe_tick"))
      .join("\n");
    expect(revokes).toMatch(/FROM PUBLIC, anon, authenticated/);
  });

  it("never grants it to anon or authenticated", () => {
    const grants = bare.match(/GRANT[^;]*reconcile_stripe_tick[^;]*;/g) ?? [];
    for (const g of grants) {
      expect(g, "the tick must not be reachable over HTTP").not.toMatch(/anon|authenticated/);
    }
  });

  it("the cron timestamp is written by the SQL, not by the edge function", () => {
    expect(bare).toMatch(/reconcile_stripe_cron/);
    expect(bare).toMatch(/lastCronAt/);
  });

  it("the OPEN function never writes lastCronAt or the cron row", () => {
    // If it did, the one field that proves the schedule is alive would be
    // settable by anyone on the internet, and it would be believed.
    //
    // Comments stripped first: this file's own prose explains why it does not
    // write lastCronAt, and a naive match reads that explanation as the thing
    // it warns against. Third time that trap has fired today.
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(code).not.toMatch(/lastCronAt/);
    expect(code).not.toMatch(/reconcile_stripe_cron/);
  });
});

describe("the reschedule actually takes effect", () => {
  it("unschedules before scheduling", () => {
    // The job already exists from 20260714130000. A `NOT EXISTS` guard like that
    // migration used would make this a silent no-op and the stamp would never
    // appear — a migration that looks applied and changes nothing.
    const un = bare.indexOf("cron.unschedule('reconcile-stripe')");
    const re = bare.indexOf("cron.schedule(");
    expect(un).toBeGreaterThan(-1);
    expect(re).toBeGreaterThan(un);
  });

  it("points the schedule at the tick rather than at the URL", () => {
    expect(bare).toMatch(/SELECT public\.reconcile_stripe_tick\(\);/);
  });

  it("keeps the same time and the same lookback", () => {
    // Moving either would quietly change which Stripe window gets swept.
    expect(bare).toMatch(/'17 15 \* \* \*'/);
    expect(bare).toMatch(/"lookbackHours": 48/);
  });

  it("degrades to nothing where pg_cron is absent", () => {
    expect(bare).toMatch(/IF EXISTS \(SELECT 1 FROM pg_namespace WHERE nspname = 'cron'\)/);
  });
});

describe("the sweep records what it saw, without recording who", () => {
  it("stamps counts and a build version", () => {
    const stamp = fn.slice(fn.indexOf('k: "reconcile_stripe_run"'), fn.indexOf("updated_at: stampedAt"));
    expect(stamp).toMatch(/checkedPaid: paid\.length/);
    expect(stamp).toMatch(/orphans: orphans\.length/);
    expect(stamp).toMatch(/buildVersion: BUILD_VERSION/);
  });

  it("puts no customer detail in a row an anon endpoint reads", () => {
    // The addresses, amounts and session ids stay in the owner email. This row
    // is surfaced by job-board status, and a sweep must never become a way to
    // enumerate purchases.
    const stamp = fn.slice(fn.indexOf('k: "reconcile_stripe_run"'), fn.indexOf("updated_at: stampedAt"));
    for (const leak of ["email", "session_id", "amountCents", "currency", "product", "o.id"]) {
      expect(stamp.toLowerCase(), `${leak} must not be stamped`).not.toContain(leak.toLowerCase());
    }
  });

  it("never fails the sweep over its own bookkeeping", () => {
    // The email is the product; the stamp is only how we learn it never happened.
    const i = fn.indexOf('k: "reconcile_stripe_run"');
    expect(fn.slice(i - 400, i)).toMatch(/try \{/);
  });

  it("has a build version at all, which it did not before", () => {
    expect(fn).toMatch(/const BUILD_VERSION = "\d{4}-\d{2}-\d{2}\.\d+"/);
  });
});

describe("alerted separates three states that were one", () => {
  it("starts as null — nothing to send is not the same as a failed send", () => {
    expect(fn).toMatch(/let alerted: boolean \| null = null/);
  });

  it("goes false when the key is missing, which was only a console.error", () => {
    // Orphans found and no RESEND_API_KEY meant the loudest event this function
    // can detect produced its quietest possible observable.
    const i = fn.indexOf("RESEND_API_KEY not set");
    expect(fn.slice(i - 200, i)).toMatch(/alerted = false/);
  });

  it("goes true only after the send resolves", () => {
    expect(fn).toMatch(/\.then\(\(\) => \{ alerted = true; \}\)/);
  });

  it("goes false when the send rejects", () => {
    expect(fn).toMatch(/catch\(\(e\) => \{ alerted = false;/);
  });
});

describe("status reports it, including the state worth shouting about", () => {
  it("reads both rows", () => {
    expect(board).toMatch(/eq\("k", "reconcile_stripe_run"\)/);
    expect(board).toMatch(/eq\("k", "reconcile_stripe_cron"\)/);
  });

  it("emits the block unconditionally", () => {
    // The alarming state is "has never run". A `? … : null` block would report
    // precisely that state by disappearing, which is how it went unnoticed for
    // three weeks in the first place.
    const i = board.indexOf("paymentReconcile:");
    expect(i).toBeGreaterThan(-1);
    expect(board.slice(i, i + 40)).toMatch(/paymentReconcile: \(\(\) =>/);
  });

  it("carries the orphan count and the alert outcome", () => {
    const blk = board.slice(board.indexOf("paymentReconcile:"), board.indexOf("scheduleProven: cronAt !== null && (ageMin(cronAt) ?? 1e9) < 1500,", board.indexOf("paymentReconcile:")));
    expect(blk).toMatch(/orphans: run\.orphans \?\? null/);
    expect(blk).toMatch(/alerted: run\.alerted \?\? null/);
  });

  it("judges a daily job on a 25h window", () => {
    // Sliced to the END OF THE BLOCK, not a fixed byte count. A 2000-char
    // window silently excluded the assertion target the moment the block gained
    // a comment — the test then failed for prose, not for code.
    const start = board.indexOf("paymentReconcile:");
    const blk = board.slice(start, board.indexOf("})(),", start));
    expect(blk).toMatch(/scheduleProven: cronAt !== null && \(ageMin\(cronAt\) \?\? 1e9\) < 1500/);
  });
});
