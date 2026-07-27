import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SUBSCRIPTIONS } from "@/config/products";

// The homepage FAQ answered "Is this a subscription?" with "There are no
// subscriptions, recurring charges, or upsells." — in all nine languages —
// while create-subscription-checkout ($45/mo) and create-agent-checkout
// ($99/mo) were both live with mode: "subscription". A false statement about
// billing is the worst class of inaccuracy this codebase can ship, and nothing
// would have caught it: the copy lived in JSON, the prices lived in Deno
// modules, and the two had no link.
//
// These tests are that link. They read the actual checkout constants — the only
// numbers that ever charge anyone — and fail if the frontend's idea of the
// price drifts, or if any locale goes back to denying the plans exist.

const root = resolve(__dirname, "../..");

function centsFrom(relPath: string, constName: string): number {
  const src = readFileSync(resolve(root, relPath), "utf8");
  const m = src.match(new RegExp(`${constName}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`${constName} not found in ${relPath}`);
  return Number(m[1]);
}

describe("subscription prices match the checkout functions", () => {
  it("Pro price mirrors PRO_PRICE_CENTS", () => {
    const cents = centsFrom("supabase/functions/_shared/pro.ts", "PRO_PRICE_CENTS");
    expect(SUBSCRIPTIONS.pro.priceUsd * 100).toBe(cents);
  });

  it("Morning Queue price mirrors AGENT_PRICE_CENTS", () => {
    const cents = centsFrom("supabase/functions/_shared/agent.ts", "AGENT_PRICE_CENTS");
    expect(SUBSCRIPTIONS.agent.priceUsd * 100).toBe(cents);
  });
});

describe("the subscription FAQ tells the truth in every language", () => {
  const localeDir = resolve(root, "src/i18n/locales");
  const locales = readdirSync(localeDir).filter((f) => f.endsWith(".json"));

  it("covers all nine shipped locales", () => {
    expect(locales.length).toBe(9);
  });

  for (const file of locales) {
    describe(file, () => {
      const answer: string = JSON.parse(readFileSync(resolve(localeDir, file), "utf8"))
        .faq.questions.subscription.answer;

      // Naming both plans is what makes the answer honest. Because the prices
      // are interpolated rather than typed into the copy, a translator cannot
      // drop a plan without dropping its placeholder, and cannot state a stale
      // price at all.
      it("names both recurring plans via interpolation", () => {
        expect(answer.split("{{proPrice}}").length - 1).toBe(1);
        expect(answer.split("{{agentPrice}}").length - 1).toBe(1);
      });

      it("does not hardcode a price that could go stale", () => {
        const hardcoded = answer.match(/\$\s?\d+/g) ?? [];
        expect(hardcoded).toEqual([]);
      });

      // Edit can silently embed NUL bytes, and grep skips any file containing
      // one — a corrupted locale would then be invisible to every text search.
      it("contains no NUL bytes", () => {
        expect(answer.includes("\u0000")).toBe(false);
      });
    });
  }

  it("no longer denies that subscriptions exist (English)", () => {
    for (const file of ["en.json", "en-GB.json"]) {
      const answer: string = JSON.parse(readFileSync(resolve(localeDir, file), "utf8"))
        .faq.questions.subscription.answer;
      expect(answer).not.toMatch(/no subscriptions|not a subscription|no recurring/i);
    }
  });
});
