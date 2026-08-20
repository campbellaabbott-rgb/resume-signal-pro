import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ORACLE WAS SERVABLE FOR THREE WEEKS AND THE REPO SAID IT WAS NOT.
 *
 * vendors/index.ts recorded "creates a candidate PROFILE per employer tenant...
 * No guest path offered... Same class of obstacle as workday" — which would
 * make it unbuildable without a credential vault. RECON.md said the opposite
 * about the same vendor. A live read of the apply screen (2026-08-19, nothing
 * typed, nothing submitted) settled it in Oracle's own words: "You don't need
 * to have an account. Get started right away by simply using your email."
 * Measured: zero password inputs, no sign-in wall, no CAPTCHA.
 *
 * That unlocks ~14,000 postings for the agent. What this file pins is the
 * safety of HOW, because every property here was a decision:
 *
 *   1. The terms checkbox is surfaced as a QUESTION, never ticked inside the
 *      adapter — so the existing consentToProcessing gate governs it. A private
 *      tick would route around the one mechanism built to stop the agent
 *      agreeing to things in a person's name, and would be invisible to every
 *      test written against the matcher.
 *   2. The honeypot is never mapped. Oracle ships name="honey-pot" ON THE FIRST
 *      SCREEN and it reports as visible; a fill-everything driver announces
 *      itself to the employer on application one.
 *   3. Unmeasured steps fail safe. Everything past the email screen is unknown
 *      (reaching it means creating a record at a real employer), so proceed()
 *      returns "stuck" rather than guessing, and an email-code wall is refused.
 */
const ROOT = resolve(__dirname, "../..");
const ADAPTER = readFileSync(resolve(ROOT, "worker/src/vendors/oracle.ts"), "utf8");
const REGISTRY = readFileSync(resolve(ROOT, "worker/src/vendors/index.ts"), "utf8");

describe("the Oracle adapter cannot agree to terms on its own", () => {
  it("is registered as a servable vendor", () => {
    expect(REGISTRY).toMatch(/import \{ oracle \} from "\.\/oracle\.js";/);
    expect(REGISTRY).toMatch(/export const ADAPTERS[\s\S]{0,200}?\boracle,/);
  });

  it("no longer claims Oracle needs an account", () => {
    // The stale note said "No guest path offered" and "Same class of obstacle
    // as workday". Both are disproved; neither may sit in NEEDS_RECON claiming
    // this vendor is blocked.
    const needsRecon = REGISTRY.slice(REGISTRY.indexOf("NEEDS_RECON"));
    expect(needsRecon).not.toMatch(/^\s*oracle:/m);
  });

  it("NEVER ticks the terms checkbox itself — it surfaces it as a question", () => {
    // The adapter may reference the checkbox (to enumerate it) but must never
    // check/click it. Those calls are what a private consent path looks like.
    expect(ADAPTER).not.toMatch(/legal-disclaimer-checkbox[\s\S]{0,200}?\.check\(/);
    expect(ADAPTER).not.toMatch(/TERMS_INPUT[\s\S]{0,120}?\.(check|click)\(/);
    // It must instead appear in the enumerated questions, where the
    // consentToProcessing gate in questions/match.ts governs it.
    const enumFn = /async enumerateQuestions\([\s\S]*?\n  \},/.exec(ADAPTER)?.[0] ?? "";
    expect(enumFn, "enumerateQuestions not found").not.toBe("");
    expect(enumFn).toMatch(/legal-disclaimer-checkbox/);
    expect(enumFn).toMatch(/required: true/);
  });

  it("keeps a failed enumeration NULL instead of inventing a one-item form", () => {
    // null means "I could not look". Appending the terms question to it would
    // turn a broken probe into a confident claim about the form's contents.
    const enumFn = /async enumerateQuestions\([\s\S]*?\n  \},/.exec(ADAPTER)?.[0] ?? "";
    expect(enumFn).toMatch(/if \(base === null\) return null;/);
  });

  it("never maps the honeypot, and never counts it as unanswered", () => {
    // Scoped to the FIELDS map — the doc comment deliberately NAMES the
    // honeypot to record why it is absent, and an assertion that forbids the
    // word forbids the explanation too.
    const fields = /const FIELDS: Partial<Record<PacketFieldKey, string>> = \{[\s\S]*?\};/.exec(ADAPTER)?.[0] ?? "";
    expect(fields, "FIELDS map not found").not.toBe("");
    expect(fields).not.toMatch(/honey/i);
    // The required-field scan must skip it, or a trap field blocks every send.
    const unanswered = /async unansweredRequired\([\s\S]*?\n  \},/.exec(ADAPTER)?.[0] ?? "";
    expect(unanswered).toMatch(/honey\.\?pot/);
  });

  it("refuses an email-verification wall rather than guessing past it", () => {
    expect(ADAPTER).toMatch(/VERIFICATION_RE/);
    const canProceed = /async canProceed\([\s\S]*?\n  \},/.exec(ADAPTER)?.[0] ?? "";
    // The wall check must come FIRST, before any control is considered.
    const wallAt = canProceed.indexOf("looksLikeVerificationWall");
    const nextAt = canProceed.indexOf("would-advance");
    expect(wallAt).toBeGreaterThan(-1);
    expect(wallAt).toBeLessThan(nextAt);
  });

  it("never claims a submit it has not measured", () => {
    // No submit control on this vendor has been observed, so canProceed must
    // never answer "would-submit" — and proceed() must delegate to it rather
    // than deciding separately.
    const canProceed = /async canProceed\([\s\S]*?\n  \},/.exec(ADAPTER)?.[0] ?? "";
    expect(canProceed).not.toMatch(/return "would-submit"/);
    const proceed = /async proceed\([\s\S]*?\n  \},/.exec(ADAPTER)?.[0] ?? "";
    expect(proceed).toMatch(/await this\.canProceed\(page\)/);
  });

  it("resolves the form by clicking, because the site id changes", () => {
    // .../sites/CX_1/job/N -> .../sites/CX_1001/job/N/apply/email, measured.
    // A string-derived URL would 404 on every tenant.
    const resolve_ = /async resolveFormUrl\([\s\S]*?\n  \},/.exec(ADAPTER)?.[0] ?? "";
    expect(resolve_).toMatch(/\.click\(/);
    expect(resolve_).toMatch(/\/apply/);
    // And it must verify it actually landed in the apply flow.
    expect(resolve_).toMatch(/test\(url\)/);
  });
});
