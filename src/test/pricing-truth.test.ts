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

// The FAQ was not the only place. Six more strings — including the homepage
// hero and the meta description Google prints for /pricing — asserted flatly
// that no subscriptions existed. They now say the honest thing instead: the
// one-time purchase never auto-renews, which is true and keeps the promise
// customers actually care about.
describe("commerce copy never denies subscriptions, in any language", () => {
  const localeDir = resolve(root, "src/i18n/locales");

  // Written per language because a denial in Hindi is invisible to an English
  // regex, and these files are edited by translators who do not see this test.
  const DENIALS: Record<string, RegExp> = {
    "en.json": /no subscription/i,
    "en-GB.json": /no subscription/i,
    "es.json": /sin suscripci|no hay suscripci/i,
    "fr.json": /sans abonnement|pas d['’]abonnement/i,
    "de.json": /kein abo|keine abos|kein abonnement/i,
    "pt.json": /sem assinatura|nenhuma assinatura/i,
    "nl.json": /geen abonnement/i,
    "hi.json": /कोई सब्सक्रिप्शन नहीं|कोई सदस्यता नहीं/,
    "tl.json": /walang subscription|walang subskripsiyon/i,
  };

  const KEYS = [
    ["hero", "nofees"],
    ["hero", "benefits", "oneTime"],
    ["finalCta", "guarantee"],
    ["pricingPage", "noSubscriptions"],
    ["productSelectionModal", "secureCheckout"],
    ["pricingPage", "metaDescription"],
  ];

  const read = (file: string, path: string[]): string =>
    path.reduce<any>((o, k) => o?.[k], JSON.parse(readFileSync(resolve(localeDir, file), "utf8")));

  for (const [file, denial] of Object.entries(DENIALS)) {
    describe(file, () => {
      for (const path of KEYS) {
        it(`${path.join(".")} makes no categorical denial`, () => {
          const v = read(file, path);
          expect(typeof v).toBe("string");
          expect(v).not.toMatch(denial);
        });
      }

      // "$1 Keyword Fix" sat in this description while the product cost $3.
      it("pricingPage.metaDescription interpolates prices instead of stating them", () => {
        const v = read(file, ["pricingPage", "metaDescription"]);
        expect(v.split("{{keywordFixPrice}}").length - 1).toBe(1);
        expect(v.split("{{snapshotPrice}}").length - 1).toBe(1);
        expect(v).not.toMatch(/[$£€₹]\s?\d/);
      });
    });
  }
});
