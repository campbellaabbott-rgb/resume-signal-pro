import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ATS_VENDORS, AUTO_VENDORS, CLICK_VENDORS } from "../config/ats-vendors";
import { SUBSCRIPTIONS } from "../config/products";

const root = resolve(__dirname, "../..");
const automation = readFileSync(
  resolve(root, "supabase/functions/_shared/apply-automation.ts"), "utf8",
);

// The front page and the pricing page both claim, by name, which platforms the
// agent will apply on. apply-automation.ts is what the agent actually obeys.
// If those two ever disagree, the site promises unattended applying on a vendor
// the code refuses to touch — a claim a customer pays for and does not get.
describe("the marketing vendor list cannot drift from what the agent obeys", () => {
  const tierOf = (key: string): string | null => {
    const m = automation.match(new RegExp(`\\b${key}:\\s*\\{\\s*tier:\\s*"(auto|click)"`));
    return m ? m[1] : null;
  };

  it("finds the tier table it is checking against", () => {
    // Guards the guard: if the regex stops matching, every case below would
    // pass vacuously and the drift it exists to catch would ship.
    expect(tierOf("workday"), "tier table not parseable — the matcher broke").toBe("auto");
    expect(tierOf("greenhouse")).toBe("click");
  });

  it("every listed vendor exists in the tier table, with the same tier", () => {
    for (const v of ATS_VENDORS) {
      const actual = tierOf(v.key);
      expect(actual, `${v.key} is advertised but absent from apply-automation.ts`).not.toBeNull();
      expect(actual, `${v.label} advertised as "${v.tier}" but the agent treats it as "${actual}"`).toBe(v.tier);
    }
  });

  it("does not advertise auto-apply on a CAPTCHA vendor", () => {
    // The whole product boundary in one assertion. These vendors were measured
    // with CAPTCHAs up to 60/60; we do not solve or evade them, so claiming
    // unattended applying on one would be both false and a promise to do
    // something we have refused to build.
    for (const v of AUTO_VENDORS) {
      expect(tierOf(v.key), `${v.label} must be auto in the tier table`).toBe("auto");
    }
    for (const bad of ["greenhouse", "ashby", "lever", "bamboohr", "workable", "rippling", "recruitee", "icims"]) {
      expect(AUTO_VENDORS.map((v) => v.key), `${bad} carries a CAPTCHA and must never be in the auto list`)
        .not.toContain(bad);
    }
  });

  it("splits cleanly and covers every vendor", () => {
    expect(AUTO_VENDORS.length + CLICK_VENDORS.length).toBe(ATS_VENDORS.length);
    expect(new Set(ATS_VENDORS.map((v) => v.key)).size, "duplicate vendor key").toBe(ATS_VENDORS.length);
    expect(ATS_VENDORS.length).toBeGreaterThanOrEqual(15);
  });

  it("states no coverage percentage anywhere in the config", () => {
    // I could not measure the share of the board these vendors hold — sampling
    // at different offsets answered 79%, 100% and 0.6% to the same question,
    // because postings cluster by vendor and there is no per-source facet. A
    // percentage here would be a number nobody can check and I cannot defend.
    const src = readFileSync(resolve(root, "src/config/ats-vendors.ts"), "utf8");
    const claims = src.split("\n").filter((l) =>
      !l.trim().startsWith("*") && !l.trim().startsWith("//") && /\d+\s*%/.test(l));
    expect(claims, `coverage percentage found: ${claims.join(" | ")}`).toEqual([]);
  });
});

describe("the agent tier is priced and described as a superset of Pro", () => {
  it("costs more than Pro", () => {
    // "Includes everything in Pro" only makes sense in one direction. If the
    // agent were ever priced at or below Pro, the card's headline claim would
    // stop being a reason to upgrade and start being a reason not to.
    expect(SUBSCRIPTIONS.agent.priceUsd).toBeGreaterThan(SUBSCRIPTIONS.pro.priceUsd);
  });

  it("actually grants Pro to agent subscribers", () => {
    // THE CLAIM THIS BACKS. Before this, nothing wrote pro_subscribers on an
    // agent purchase and isProCached read only that table — so a $99 subscriber
    // was refused the Pro features they had paid for, while checkProByEmail
    // (which does not filter by price) said they were entitled. Two checks,
    // opposite answers, and the copy would have been the wrong one.
    const pro = readFileSync(resolve(root, "supabase/functions/_shared/pro.ts"), "utf8");
    expect(pro, "isProCached must consult agent_subscribers, or the includes-Pro claim is false")
      .toMatch(/agent_subscribers/);
  });

  it("the card reads its price from config, never a literal", () => {
    const card = readFileSync(resolve(root, "src/components/AgentSubscriptionCard.tsx"), "utf8");
    expect(card).toMatch(/SUBSCRIPTIONS\.agent\.priceUsd/);
    expect(card, "a hard-coded price can drift from what Stripe charges").not.toMatch(/\$99/);
  });
});
