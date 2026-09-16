import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PASS, SUBSCRIPTIONS } from "@/config/products";
import * as passModule from "../../supabase/functions/_shared/pass.ts";

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

// Split so the pass guard below can feed the SAME parser a mutated copy of the
// source and prove which expectation fires — teeth, not coverage.
function numberConstOfSource(src: string, constName: string, where: string): number {
  const m = src.match(new RegExp(`${constName}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`${constName} not found in ${where}`);
  return Number(m[1]);
}

function centsFrom(relPath: string, constName: string): number {
  return numberConstOfSource(readFileSync(resolve(root, relPath), "utf8"), constName, relPath);
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

// The pass is the third way to hold the one agent entitlement, and it carries
// SIX numbers, not one — price, hours, applications, quota, rate, shelf life —
// every one of which reaches a page as {{passX}} and a Stripe line as cents.
// Six numbers in two runtimes is six ways for the copy to go false while the
// charge stays true, so the mirror is pinned property by property, never by
// re-reading. The numbers are READ from the Deno file; this test spells none.
describe("the Agent Pass mirrors _shared/pass.ts, number for number", () => {
  const PASS_SOURCE = "supabase/functions/_shared/pass.ts";
  const passSrc = readFileSync(resolve(root, PASS_SOURCE), "utf8");

  // Frontend field → Deno constant, and the factor between them (cents).
  const NUMBER_MIRROR: ReadonlyArray<readonly [keyof typeof PASS, string, number]> = [
    ["priceUsd", "PASS_PRICE_CENTS", 100],
    ["sessionHours", "PASS_SESSION_HOURS", 1],
    ["applications", "PASS_APPLICATIONS", 1],
    ["quotaPerDay", "PASS_QUOTA_PER_DAY", 1],
    ["ratePerMin", "PASS_RATE_PER_MIN", 1],
    ["shelfLifeDays", "PASS_SHELF_LIFE_DAYS", 1],
  ];

  // The names of every constant whose frontend mirror disagrees with `src`.
  function mirrorMismatches(src: string): string[] {
    return NUMBER_MIRROR
      .filter(([field, constName, factor]) =>
        (PASS[field] as number) * factor !== numberConstOfSource(src, constName, PASS_SOURCE))
      .map(([, constName]) => constName);
  }

  it("price: PASS.priceUsd * 100 === PASS_PRICE_CENTS", () => {
    expect(PASS.priceUsd * 100).toBe(centsFrom(PASS_SOURCE, "PASS_PRICE_CENTS"));
  });

  it.each(NUMBER_MIRROR.filter(([, , f]) => f === 1))(
    "PASS.%s mirrors %s",
    (field, constName) => {
      expect(PASS[field]).toBe(centsFrom(PASS_SOURCE, constName));
    },
  );

  it("every number agrees at once", () => {
    expect(mirrorMismatches(passSrc)).toEqual([]);
  });

  // The regex reads the live declaration and not a comment: the module's own
  // runtime value must equal what the parser found for every constant.
  it.each(NUMBER_MIRROR)("the parser reads the declaration of %s (%s)", (_field, constName) => {
    expect((passModule as Record<string, unknown>)[constName])
      .toBe(numberConstOfSource(passSrc, constName, PASS_SOURCE));
  });

  // The strings are identity, not price — but a drifted product_type is a
  // purchase the webhook never delivers, and a drifted tier is a key the gates
  // read as free. Imported from the module, so the comparison is by value.
  it("product type, tier and name are the Deno module's, by value", () => {
    expect(PASS.productType).toBe(passModule.PASS_PRODUCT_TYPE);
    expect(PASS.tier).toBe(passModule.PASS_TIER);
    expect(PASS.name).toBe(passModule.PASS_PRODUCT_NAME);
    expect(PASS.key).toBe(passModule.PASS_TIER);
  });

  // TEETH. A guard that cannot fail reads as coverage. Feed the parser a copy
  // of pass.ts with exactly one number changed — a trailing digit appended to
  // one declaration, nothing else — and the mismatch it reports must name that
  // constant and only that constant. Done for each of the six, so no single
  // mirror line can be dropped from the table without this noticing.
  it.each(NUMBER_MIRROR)("fails on a copy of pass.ts where only %s's %s is changed", (_field, constName) => {
    const declaration = new RegExp(`(${constName}\\s*=\\s*\\d+)`);
    expect(passSrc).toMatch(declaration);
    const mutated = passSrc.replace(declaration, (decl) => `${decl}1`);
    expect(mutated).not.toBe(passSrc);
    expect(mirrorMismatches(mutated)).toEqual([constName]);
  });

  // Written first and watched fail against an empty pass.ts: the parser refuses
  // to answer from a file that does not declare the constant, so an empty or
  // renamed source is a loud failure, never a silent zero.
  it("fails loudly against an empty pass.ts", () => {
    expect(() => mirrorMismatches("")).toThrow(/PASS_PRICE_CENTS not found/);
  });

  it("the pass sits beside SUBSCRIPTIONS, never inside PRODUCTS", async () => {
    const { PRODUCTS } = await import("@/config/products");
    const skus = Object.values(PRODUCTS) as Array<{ name?: string; priceUsd?: number }>;
    expect(skus.some((p) => p.name === PASS.name)).toBe(false);
    expect(Object.keys(PRODUCTS)).not.toContain(PASS.key);
  });
});
