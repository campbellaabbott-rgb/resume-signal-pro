import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every sending claim on the paid agent card must be gated on the sender
 * actually being online.
 *
 * FOUND 2026-08-01 by asking "if someone bought this today, would it go end to
 * end?". The answer was no — no worker exists — and the card had already been
 * built to handle that: the auto-apply bullet is wrapped in `{online && …}` and
 * the footnote switches to "Unattended sending is not running right now".
 *
 * But the TAGLINE was not gated. Directly above a hidden auto-apply bullet, in
 * the product's own voice, it said "It finds the roles, fills in the
 * application, and sends it." — a statement of fact that was false, on a page
 * that takes payment. A claim does not stop being a claim for being in smaller
 * type, and the gate that catches the bullet has to catch the sentence too.
 *
 * This test greps the component rather than rendering it on purpose: the risk
 * is someone ADDING a new sending claim later, and a render test only covers
 * the strings it was written to look for.
 */
const SRC = readFileSync(resolve(__dirname, "../components/AgentSubscriptionCard.tsx"), "utf8");
const EN = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/en.json"), "utf8")) as {
  agentPlan: Record<string, string>;
};

/** Copy keys that assert the product SENDS, as opposed to preparing. */
const SENDING_CLAIMS = ["badge", "tagline", "perkAutoApply", "footnoteOnline"];

describe("the agent card never promises sending while the sender is offline", () => {
  it("gates every sending claim on `online`", () => {
    for (const key of SENDING_CLAIMS) {
      const uses = SRC.includes(`agentPlan.${key}`);
      if (!uses) continue;
      // The claim must appear inside an `online ?` or `online && ` expression.
      const gated = new RegExp(`online\\s*(\\?|&&)[\\s\\S]{0,400}agentPlan\\.${key}`).test(SRC);
      expect(gated, `agentPlan.${key} is rendered without an \`online\` gate`).toBe(true);
    }
  });

  it("has an offline counterpart for each gated claim, and it does not promise sending", () => {
    for (const key of ["badge", "tagline"]) {
      const offline = EN.agentPlan[`${key}Offline`];
      expect(offline, `agentPlan.${key}Offline is missing`).toBeTruthy();
      // "you press send" is fine; "it sends" is not.
      expect(/\b(and sends it|sends it for you|applies for you automatically)\b/i.test(offline!),
        `agentPlan.${key}Offline still promises sending: "${offline}"`).toBe(false);
    }
  });

  it("keeps the one-click promise ungated, because it is true either way", () => {
    // perkOneClick describes preparation, which works with or without a
    // worker. Gating it would UNDERsell — the opposite error, but still an
    // inaccuracy, and the fence cuts both ways.
    const gated = /online\s*(\?|&&)[\s\S]{0,200}agentPlan\.perkOneClick/.test(SRC);
    expect(gated, "perkOneClick should render regardless of sender status").toBe(false);
  });
});

/**
 * THE SAME CLAIM, ON THE OTHER PAYWALL.
 *
 * The guard above was written against AgentSubscriptionCard.tsx. There is a
 * second surface that takes the same money — the Morning Queue paywall in
 * MorningQueuePanel.tsx — and it carried the opposite error: not an ungated
 * sending claim, but an ungated NOT-sending claim.
 *
 *     "The agent prepares and explains — it never submits for you, and it
 *      never invents answers."
 *
 * That was true when written and false by the time it was read. apply-agent
 * claims packets in `ready` — never approved by a human — when the mandate's
 * apply_mode is "auto", and releases them. The user picks that mode from a
 * radio group in ApplyProfilePanel.
 *
 * The same file already knew. Eight lines above the paywall, the subtitle was
 * split into two variants with a comment explaining that "You review, you
 * send" stopped being true for auto mode, and that copy describing something
 * which has since moved is "the exact way this product tells a lie without
 * anyone editing it". The fix was applied to the sentence above and not to the
 * sentence below — so the false half survived on the one surface where a
 * person is deciding whether to pay.
 *
 * So this guard is tied to the CODE that makes the claim false, not to the
 * wording. If unattended release is ever removed, the precondition fails loudly
 * and this rule can be retired on purpose rather than by drift.
 */
describe("the Morning Queue paywall describes what the agent actually does", () => {
  const APPLY_AGENT = readFileSync(
    resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");

  const LOCALES = ["en", "en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"];
  const payBoundary = (loc: string): string => {
    const j = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${loc}.json`), "utf8"));
    return j?.agentQueue?.payBoundary ?? "";
  };

  it("PRECONDITION: the agent really can submit without human approval", () => {
    // If this ever fails, unattended release was removed and the rule below is
    // no longer required — check, then delete it deliberately.
    expect(APPLY_AGENT, "apply-agent no longer treats `ready` as claimable in auto mode")
      .toMatch(/apply_mode === "auto"\s*\?\s*\["ready",\s*"approved"\]/);
  });

  it("does not claim the agent never submits", () => {
    for (const loc of ["en", "en-GB"]) {
      expect(payBoundary(loc), `${loc}: paywall claims the agent never submits, but auto mode does`)
        .not.toMatch(/never submits|never sends|it never submits for you/i);
    }
  });

  it("names auto mode in every locale, not only English", () => {
    // A claim corrected in one language and left standing in eight is still a
    // claim left standing.
    for (const loc of LOCALES) {
      const s = payBoundary(loc);
      expect(s.length, `${loc}: payBoundary missing`).toBeGreaterThan(0);
      expect(s, `${loc}: paywall never mentions auto mode`).toMatch(/auto|ऑटो/i);
    }
  });

  it("the component's inline fallback matches — it renders when a key is missing", () => {
    const panel = readFileSync(resolve(__dirname, "../components/account/MorningQueuePanel.tsx"), "utf8");
    const code = panel.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("{/*") && !l.trim().startsWith("//")).join("\n");
    const m = code.match(/t\(\s*"agentQueue\.payBoundary"\s*,\s*"([^"]+)"/);
    expect(m, "inline fallback for agentQueue.payBoundary not found").not.toBeNull();
    expect(m![1], "the hardcoded fallback still says the agent never submits").not.toMatch(/never submits|never sends/i);
  });
});
