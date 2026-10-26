/**
 * THE PAGES PROMISE ONLY WHAT HOLDS (review round of 2026-10-26).
 *
 *   - "/" listed "Ask for your résumé." in bold under "What we never do". As
 *     a blanket promise it is false: the connector's fit tool takes the
 *     résumé, /pricing advertises that tool, and "/" itself asks for an
 *     upload. The lead now says what is never asked for: the résumé, to
 *     search the board.
 *   - /pricing said everything free works "everywhere", while the free scan
 *     refuses Russia, Nigeria and Pakistan whenever it can place the caller
 *     (free-keyword-scan BLOCKED_COUNTRIES). The sentences sit under the
 *     territories where checkout is refused, so they now say what holds
 *     there: the free tools still work there. The time-zone notice says the
 *     same.
 *   - French used two nouns for a package ("pack" on "/", "lot" on /pricing
 *     and on the Pro card); the owner's rule is one noun.
 *   - The "/" title was 69 characters (SEO.tsx keeps a title to 60, and
 *     Google cuts a longer one), in every language over 60.
 *   - The /pricing Builder heading read "planned" twice before its own
 *     "Planned · not on sale" chip.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Lng = (typeof LNGS)[number];
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const home = (l: Lng) => json(`src/i18n/shards/home/${l}.json`).home;
const pricing = (l: Lng) => json(`src/i18n/shards/pricing/${l}.json`).pricingPlans;
const main = (l: Lng) => json(`src/i18n/locales/${l}.json`);

/** The word each language used for "everywhere". */
const EVERYWHERE: Record<Lng, RegExp> = {
  en: /everywhere/i, "en-GB": /everywhere/i, de: /überall/i, es: /en todas partes/i, fr: /partout/i,
  hi: /हर जगह/, nl: /overal/i, pt: /em todo (?:lugar|o lado)/i, tl: /kahit saan/i,
};
/** The word each language used for "planned" in the Builder's price. */
const PLANNED: Record<Lng, RegExp> = {
  en: /planned/i, "en-GB": /planned/i, de: /geplant/i, es: /previsto/i, fr: /prévu/i,
  hi: /योजना/, nl: /gepland/i, pt: /planejado/i, tl: /nakaplano/i,
};
/** The bare leads the page printed, one per language. */
const BARE_LEAD: Record<Lng, string> = {
  en: "Ask for your résumé.", "en-GB": "Ask for your CV.", de: "Nach deinem Lebenslauf fragen.", es: "Pedirte el currículum.",
  fr: "Demander votre CV.", hi: "आपका रिज़्यूमे मांगना।", nl: "Om je cv vragen.", pt: "Pedir seu currículo.", tl: "Hingin ang résumé mo.",
};

describe("what \"/\" says it never does", () => {
  it("the résumé lead is scoped to searching the board, in every language", () => {
    expect(home("en").ai.never3Lead).toBe("Ask for your résumé to search the board.");
    for (const l of LNGS) expect(home(l).ai.never3Lead, l).not.toBe(BARE_LEAD[l]);
  });
});

describe("where the free tools work", () => {
  it("no sentence on /pricing or in the time-zone notice says they work everywhere", () => {
    for (const l of LNGS) {
      const p = pricing(l);
      for (const [k, v] of Object.entries({ regionBody: p.before.regionBody, regionA: p.faq.regionA, regionANoAlerts: p.faq.regionANoAlerts, notice: main(l).checkoutGate.regionNoticeTimeZone })) {
        expect(v, `${l} ${k}`).not.toMatch(EVERYWHERE[l]);
      }
    }
    const notice = readFileSync(resolve(ROOT, "src/components/checkout/RegionNotice.tsx"), "utf8");
    expect(notice).not.toMatch(/work everywhere/);
  });
});

describe("one noun for a package", () => {
  it("French says lot on \"/\" as on /pricing and the Pro card", () => {
    expect(JSON.stringify(home("fr"))).not.toMatch(/\bpacks?\b/i);
    expect(main("fr").proPlan.perks.writingToolsPackages).toMatch(/\blots?\b/);
  });
});

describe("the \"/\" title", () => {
  it("is 60 characters or fewer in every language, and keeps the headline's words in English", () => {
    for (const l of LNGS) expect([...home(l).seo.title].length, `${l}: ${home(l).seo.title}`).toBeLessThanOrEqual(60);
    expect(home("en").seo.title).toMatch(/Live Jobs Straight From Employers' Own Hiring Systems/);
  });
});

describe("the Builder's heading on /pricing", () => {
  it("says planned once, in its chip, not again in its price", () => {
    for (const l of LNGS) {
      expect(pricing(l).b2b.builderPrice, l).not.toMatch(PLANNED[l]);
      expect(pricing(l).b2b.builderPrice, l).toContain("{{price}}");
    }
  });
});
