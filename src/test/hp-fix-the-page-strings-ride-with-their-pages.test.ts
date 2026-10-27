/**
 * THE HOMEPAGE'S AND THE PRICING PAGE'S ENGLISH STRINGS RIDE WITH THOSE
 * PAGES, NOT IN EVERY PAGE'S ENTRY (review round of 2026-10-26).
 *
 * Registering the two shards (switch-over step 2) put their English strings
 * in the entry chunk, which every page loads: +6.7 KB gzip, and 7-11 KB more
 * static JavaScript on /resume-checker, the guides, the posting pages and
 * /jobs, undoing part of SEO-040's split. Now the eager glob leaves them out,
 * and each component that renders them imports a module that adds its
 * page's English strings when it loads, so they arrive in the page's own
 * chunk. Other languages' shards still load with their main file, as before.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const tsx = (dir: string) => readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".tsx")).map((f) => `${dir}/${f}`);

describe("the entry", () => {
  it("globs every English shard eagerly except the two pages'", async () => {
    const index = codeOf(read("src/i18n/index.ts"));
    const eager = /import\.meta\.glob\((\[[^\]]*\]|'[^']*'),\s*\{\s*eager:\s*true/.exec(index)?.[1] ?? "";
    expect(eager).toContain("'./shards/*/en.json'");
    expect(eager).toContain("'!./shards/home/en.json'");
    expect(eager).toContain("'!./shards/pricing/en.json'");
    const { enTranslation } = await import("@/i18n");
    expect(enTranslation.home, "the homepage's strings are in the entry's English").toBeUndefined();
    expect(enTranslation.pricingPlans, "the pricing page's strings are in the entry's English").toBeUndefined();
    expect(enTranslation.companyProfile, "the other shards stay eager").toBeTruthy();
  });
});

describe("the pages' own modules", () => {
  it("every homepage and pricing component that translates imports its page's strings", () => {
    const missing: string[] = [];
    for (const [dirs, mod] of [
      [["src/components/home", "src/pages/home"], "@/i18n/home-strings"],
      [["src/components/pricing", "src/pages/pricing"], "@/i18n/pricing-strings"],
    ] as const) {
      for (const f of dirs.flatMap(tsx)) {
        const code = codeOf(read(f));
        if (!/useTranslation/.test(code)) continue;
        if (!code.includes(`import "${mod}";`)) missing.push(`${f} (${mod})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("loading the module adds the page's English strings", async () => {
    const { default: i18n } = await import("@/i18n");
    await import("@/i18n/home-strings");
    await import("@/i18n/pricing-strings");
    const home = JSON.parse(read("src/i18n/shards/home/en.json")).home;
    const pricing = JSON.parse(read("src/i18n/shards/pricing/en.json")).pricingPlans;
    expect(i18n.t("home.seo.title", { lng: "en" })).toBe(home.seo.title);
    expect(i18n.t("pricingPlans.before.h2", { lng: "en" })).toBe(pricing.before.h2);
  });
});
