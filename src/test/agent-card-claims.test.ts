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
