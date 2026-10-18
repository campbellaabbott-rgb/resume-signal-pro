/**
 * THE PRICING STRINGS ARE A SHARD IN ALL BUT ITS FOLDER, AND KEEP THE HOUSE RULES.
 *
 * They live in src/components/pricing/strings/<lng>.json until switch-over
 * moves them to src/i18n/shards/pricing/ (an unregistered shard directory
 * fails the shard guard, and SHARD_ROOT_KEYS is in a file this round may not
 * edit). Until then this file holds them to the shard rules the guard would:
 *
 *   - all nine languages, identical key sets, every value a non-empty string;
 *   - one root key, "pricingPlans", and no key the main locale defines;
 *   - the same {{placeholders}} and <link> tags as English in every language;
 *   - no plural keys (counts are interpolated as {{n}}, never `count`).
 *
 * And to the house rules, in every language: never "verified", never "zero
 * ghost jobs", never a hiring probability, never the word the owner banned for
 * scans, AI hosts named are only Claude, ChatGPT and Claude Code.
 *
 * Plus the component rules: no raw palette, pixel font size or opacity text
 * in src/components/pricing (the design-no-raw-palette rules, restated here
 * because that file is a test and importing it would run its suite twice),
 * and no nowrap anywhere translated text renders.
 *
 * And the loader: another language's strings are merged only after that
 * language's main locale has landed, so the page can never leave a reader
 * with nothing but its own strings.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import i18n from "@/i18n";
import { leafKeys, type Bundle } from "@/i18n/merge-shards";
import { LOCALE_FILES, readMainLocale, stringLeaves } from "./helpers/locale-strings";
import { codeOf } from "./helpers/strip-comments";
import { loadPricingStrings, PRICING_ROOT } from "@/components/pricing/use-pricing-strings";

const DIR = resolve(__dirname, "../components/pricing");
const STRINGS = join(DIR, "strings");
const read = (f: string) => JSON.parse(readFileSync(join(STRINGS, f), "utf8")) as Bundle;
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s: string) => (s.match(/<\/?(link|b)>/g) ?? []).join("");

describe("the pricing strings follow the shard rules", () => {
  const files = readdirSync(STRINGS).filter((f) => f.endsWith(".json")).sort();

  it("exist in exactly the nine languages the main locales do", () => {
    expect(files).toEqual([...LOCALE_FILES]);
  });

  it("have identical key sets, and every value is a non-empty string", () => {
    const enKeys = leafKeys(read("en.json")).sort();
    for (const f of files) {
      const b = read(f);
      expect(leafKeys(b).sort(), f).toEqual(enKeys);
      const leaves = stringLeaves(b);
      expect(leaves.length, f).toBe(enKeys.length);
      expect(leaves.filter(([, v]) => !v.trim()).map(([k]) => k), f).toEqual([]);
    }
  });

  it("write only under their one root and define nothing the main locale defines", () => {
    for (const f of files) {
      const b = read(f);
      expect(Object.keys(b), f).toEqual([PRICING_ROOT]);
      const main = readMainLocale(f);
      expect(main[PRICING_ROOT], `${f} main locale already has ${PRICING_ROOT}`).toBeUndefined();
    }
  });

  it("carry English's placeholders and tags in every language, and no plural keys", () => {
    const en = Object.fromEntries(stringLeaves(read("en.json")));
    for (const f of files) {
      for (const [k, v] of stringLeaves(read(f))) {
        expect(placeholders(v), `${f} ${k}`).toBe(placeholders(en[k]));
        expect(tags(v), `${f} ${k}`).toBe(tags(en[k]));
        expect(k, `${f} ${k}`).not.toMatch(/_(zero|one|two|few|many|other)$/);
        expect(v, `${f} ${k}`).not.toMatch(/\{\{count\}\}/);
      }
    }
  });
});

describe("the house rules, in every language", () => {
  const all = LOCALE_FILES.flatMap((f) => stringLeaves(read(f)).map(([k, v]) => [f, k, v] as const));

  it("never call a posting verified, never promise zero ghost jobs", () => {
    const re = /verif|vérifi|zero ghost|cero empleos fantasma|सत्यापित|geverifieerd|beripikado/i;
    expect(all.filter(([, , v]) => re.test(v)).map(([f, k]) => `${f} ${k}`)).toEqual([]);
  });

  it("never state a hiring probability", () => {
    const re = /likelihood|probabilit|\bodds\b|\d+\s?%|wahrscheinlich|probabilidad|probabilité|kans op|संभावना \d|posibilidad de \d/i;
    expect(all.filter(([, , v]) => re.test(v)).map(([f, k, v]) => `${f} ${k}: ${v}`)).toEqual([]);
  });

  it("never the banned word for scans, in any language", () => {
    const re = new RegExp(["un" + "limited", "unbegrenzt", "unbeschränkt", "ilimitad", "illimit", "onbeperkt", "onbegrensd", "असीमित", "walang hanggan", "all-access", "now and future"].join("|"), "i");
    expect(all.filter(([, , v]) => re.test(v)).map(([f, k, v]) => `${f} ${k}: ${v}`)).toEqual([]);
  });

  it("name no AI host but Claude, ChatGPT and Claude Code", () => {
    const re = /Gemini|Copilot|Cursor|Perplexity|Windsurf|VS ?Code|Codex|Grok|\bLlama\b|Mistral|Le Chat|DeepSeek|\bBard\b|\bZed\b|\bCline\b/;
    expect(all.filter(([, , v]) => re.test(v)).map(([f, k, v]) => `${f} ${k}: ${v}`)).toEqual([]);
  });

  it("name no product the owner cut", () => {
    const re = /Freelance|Transition Pro|Scan Pack|Premium|Morning Queue|Agent Pass|Apply Assistant|Interview Coach|Career Snapshot|Graduate Game Plan|ATS Defense|Keyword Fix/i;
    expect(all.filter(([, , v]) => re.test(v)).map(([f, k, v]) => `${f} ${k}: ${v}`)).toEqual([]);
  });

  it("say all sales are final and where the page does not sell, in every language", () => {
    for (const f of LOCALE_FILES) {
      const b = read(f) as { pricingPlans: { buy: Record<string, string>; before: Record<string, string> } };
      expect(b.pricingPlans.buy.finalSale.length, f).toBeGreaterThan(5);
      expect(b.pricingPlans.buy.region, f).toMatch(/EU|UE/);
      expect(b.pricingPlans.buy.region, f).toMatch(/India|Inde|Indien|Índia|भारत/);
      expect(b.pricingPlans.before.regionBody, f).toMatch(/IP/);
    }
  });
});

describe("the components keep the design rules", () => {
  const COLORS = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
  const UTIL = "text|bg|border|ring|ring-offset|from|via|to|fill|stroke|outline|divide|placeholder|shadow|decoration|accent|caret";
  const RULES: Array<[string, RegExp]> = [
    ["raw palette colour", new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${UTIL})-(?:${COLORS})-\\d{2,3}(?:\\/\\d{1,3})?(?![\\w-])`, "g")],
    ["raw white or black", new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${UTIL})-(?:white|black)(?:\\/\\d{1,3})?(?![\\w-])`, "g")],
    ["hex colour in a class", /\[#[0-9a-fA-F]{3,8}\]|className="[^"]*#[0-9a-fA-F]{3,8}\b/g],
    ["pixel font size", /(?<![\w-])(?:[a-z-]+:)*text-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g],
    ["text contrast from opacity", /(?<![\w-])(?:[a-z-]+:)*text-[a-z]+(?:-[a-z]+)*\/\d{1,3}(?![\w-])/g],
    ["opacity on content", /(?<![\w-])(?!(?:disabled|peer-disabled|data-\[disabled\]|aria-disabled|group-disabled):)(?:[a-z-]+:)*opacity-(?!0(?![\d])|100(?![\d]))\d{1,3}(?![\w-])/g],
  ];
  const sources = [
    ...readdirSync(DIR).filter((f) => /\.tsx?$/.test(f)).map((f) => join(DIR, f)),
    resolve(__dirname, "../pages/pricing/PricingPage.tsx"),
  ];

  it("no raw palette, pixel font size or opacity text", () => {
    for (const f of sources) {
      const code = codeOf(readFileSync(f, "utf8"));
      for (const [name, re] of RULES) expect([...code.matchAll(re)].map((m) => `${name}: ${m[0]}`), f).toEqual([]);
    }
  });

  it("no nowrap where translated text renders, and every Button may wrap", () => {
    for (const f of sources) {
      const code = codeOf(readFileSync(f, "utf8"));
      expect(code, f).not.toMatch(/nowrap/);
      for (const m of code.matchAll(/<Button\b[^>]*>/g)) expect(m[0], `${f}: ${m[0]}`).toMatch(/\bwrap\b/);
    }
  });
});

describe("the interim loader", () => {
  it("merges English at import, so the page's first render has it", () => {
    expect(i18n.exists("pricingPlans.head.h1", { lng: "en" })).toBe(true);
    expect(i18n.t("pricingPlans.buy.finalSale", { lng: "en" })).toBe("All sales are final.");
  });

  it("merges another language only after that language's main locale has landed", async () => {
    const lng = "nl";
    if (i18n.hasResourceBundle(lng, "translation")) i18n.removeResourceBundle(lng, "translation");
    let done = false;
    const pending = loadPricingStrings(lng).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(done, "merged before the main locale").toBe(false);
    expect(i18n.hasResourceBundle(lng, "translation"), "the loader created the bundle itself").toBe(false);
    i18n.addResourceBundle(lng, "translation", { header: { pricing: "Prijzen" } });
    await pending;
    expect(done).toBe(true);
    expect(i18n.t("pricingPlans.buy.finalSale", { lng })).toBe("Alle verkopen zijn definitief.");
    expect(i18n.t("header.pricing", { lng }), "the main locale's own strings survive the merge").toBe("Prijzen");
  });
});
