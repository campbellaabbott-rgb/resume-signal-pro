import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * MAIL TO STRANGERS WENT OUT FROM RESEND'S SHARED TEST SENDER.
 *
 * `onboarding@resend.dev` (and its siblings on resend.dev) is the sender every
 * Resend account starts with, and it is deliverable only to the address the
 * Resend account itself belongs to. That is exactly right for the alert mail
 * this codebase sends ITSELF — the heartbeat, error spikes, new leads — and it
 * is why those alerts have always arrived.
 *
 * It is wrong for anyone else. Found 2026-09-02 while checking whether
 * RESEND_API_KEY was set (it is — the heartbeat proves it): FIVE functions
 * emailed people who are not the account owner from that test sender —
 * send-product-email and admin-regenerate-delivery (a PAYING CUSTOMER'S
 * delivery), send-analysis-email (a user's results), api-key-request (a
 * developer's only copy of a key that is stored as a hash and can never be
 * shown again), and send-affiliate-commission-email (an affiliate's payment
 * notice). The observed symptom was quiet: the API key request answered 200
 * with `emailed: false`, because the send is best-effort and deliberately
 * never blocks the response.
 *
 * The domain resumebooster.work is verified and already carries customer mail
 * — send-scan-report has been reaching users from reports@ all along — so the
 * fix was the sender, not the infrastructure.
 *
 * THE RULE. A send whose recipient is not the operator's own address must come
 * from the verified domain. Sending to yourself from the test sender stays
 * fine, and this test deliberately allows it rather than forcing a needless
 * migration of a dozen alert paths.
 */
const FN_DIR = resolve(__dirname, "../../supabase/functions");

/** Recipients that are the operator, not a stranger. */
const SELF = /^(ADMIN_EMAIL|adminEmail|ownerEmail|OWNER_EMAIL)$/;

type Send = { fn: string; from: string; to: string; line: number };

function sends(): Send[] {
  const out: Send[] = [];
  for (const dir of readdirSync(FN_DIR)) {
    const p = resolve(FN_DIR, dir, "index.ts");
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    // TWO SPELLINGS, AND THE FIRST DRAFT OF THIS TEST ONLY KNEW ONE. Gating on
    // the literal "api.resend.com" saw the raw-fetch senders and silently
    // skipped every function using the SDK (`new Resend(key).emails.send`) —
    // which was four of the five this file exists to watch. A guard that
    // inspects a subset it cannot name is a guard that passes while the thing
    // it guards is broken, so the gate matches both call styles.
    if (!/api\.resend\.com|resend\.com\/emails|emails\.send|new Resend\(/.test(src)) continue;
    const lines = src.split("\n");
    // A resend payload writes `from:` and `to:` within a few lines of each
    // other; pair each `from:` with the next `to:` below it.
    lines.forEach((l, i) => {
      const from = /from:\s*"([^"]+)"/.exec(l);
      if (!from) return;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const to = /to:\s*\[?\s*([A-Za-z_][A-Za-z0-9_.]*)/.exec(lines[j]);
        if (to) { out.push({ fn: dir, from: from[1], to: to[1], line: i + 1 }); return; }
      }
    });
  }
  return out;
}

describe("a test sender cannot reach a stranger", () => {
  const all = sends();

  it("finds the mail-sending functions at all", () => {
    // If this collapses to nothing the checks below are vacuously green.
    expect(all.length, "no resend payloads located — the matcher has drifted").toBeGreaterThan(18);
  });

  it("never sends to a NON-operator address from a resend.dev sender", () => {
    const offenders = all
      .filter((s) => /@resend\.dev>/.test(s.from) && !SELF.test(s.to))
      .map((s) => `${s.fn}:${s.line} (to: ${s.to}, from: ${s.from})`);
    expect(
      offenders,
      "resend.dev is deliverable only to the Resend account's own address, so these " +
        "silently fail to reach the person they are addressed to — send them from the " +
        "verified resumebooster.work domain instead",
    ).toEqual([]);
  });

  it("the five that were fixed still use the verified domain", () => {
    for (const fn of ["send-product-email", "send-analysis-email", "admin-regenerate-delivery",
                      "api-key-request", "send-affiliate-commission-email"]) {
      const s = all.find((x) => x.fn === fn);
      expect(s, `${fn} no longer sends mail — has it moved?`).toBeTruthy();
      expect(s!.from, `${fn} went back to a test sender`).toMatch(/@resumebooster\.work>/);
    }
  });
});
