/**
 * THE SEO ROUND'S REVIEW, THE COPY (2026-10-24).
 *
 *   - The re-check: the bake said "asks the employer's system again when you
 *     open a posting whose feed it last read more than 6 hours ago, where that
 *     system allows it"; React's posting note dropped "where that system
 *     allows it"; llms.txt said "every posting re-checked when you apply".
 *     Three rules for one board. They now say one.
 *   - /about's description promised "Who runs resumebooster.work", and the
 *     page names no operator (the seller's identity is not supplied, SEO-045).
 *   - /agents' SoftwareApplication carried no offer (Google's software-app
 *     result requires one).
 *   - robots.txt disallowed /dev/, so no crawler could read /dev/checkout-test's
 *     noindex.
 *   - The name-shared company page asserted that the other board belongs to a
 *     different employer, which the bake cannot know.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { RECHECK_CLAUSE } from "../../scripts/prerender-copy.mjs";
import { VERIFY_ON_VIEW_AFTER_HOURS } from "@/lib/seo/source-copy";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const LOCALES = join(ROOT, "src/i18n/locales");
const locale = (f: string) => JSON.parse(readFileSync(join(LOCALES, f), "utf8"));
/** Each language's own words for "where that system allows it". */
const CONDITION: Record<string, RegExp> = {
  "en.json": /, where that system allows it\.$/,
  "en-GB.json": /, where that system allows it\.$/,
  "de.json": /, sofern dieses System das zulässt\.$/,
  "es.json": /, donde ese sistema lo permite\.$/,
  "fr.json": /, lorsque ce système le permet\.$/,
  "hi.json": /, जहाँ वह सिस्टम इसकी अनुमति देता है।$/,
  "nl.json": /, waar dat systeem het toelaat\.$/,
  "pt.json": /, quando esse sistema o permite\.$/,
  "tl.json": /, kung saan pinapayagan ito ng system na iyon\.$/,
};

describe("one re-check rule: the bake, React's posting note and llms.txt", () => {
  it("states the threshold and the vendor condition in all three", () => {
    expect(RECHECK_CLAUSE).toContain(`more than ${VERIFY_ON_VIEW_AFTER_HOURS} hours ago`);
    expect(RECHECK_CLAUSE).toMatch(/where that system allows it$/);
    const note = String(locale("en.json").jobPostingPage.sourceNote).replace("{{hours}}", String(VERIFY_ON_VIEW_AFTER_HOURS));
    expect(note).toContain(`more than ${VERIFY_ON_VIEW_AFTER_HOURS} hours ago asks the employer's system again, where that system allows it.`);
    expect(read("public/llms.txt")).toContain(`the live board ${RECHECK_CLAUSE}`);
    expect(read("public/llms.txt")).not.toMatch(/re-checked when you apply/);
  });
  it("the posting page's default is the main locale's sentence", () => {
    expect(read("src/pages/JobPosting.tsx")).toContain(JSON.stringify(locale("en.json").jobPostingPage.sourceNote));
  });
  it.each(Object.keys(CONDITION))("%s keeps the condition", (f) => {
    expect(String(locale(f).jobPostingPage.sourceNote)).toMatch(CONDITION[f]);
  });
});

describe("/about promises no operator it does not name", () => {
  it("in the bake, the app's description in every locale, and both llms files", () => {
    const bake = read("scripts/prerender-seo.mjs");
    expect(bake).not.toMatch(/Who runs resumebooster\.work/i);
    expect(read("public/llms.txt")).not.toMatch(/Who runs resumebooster\.work/i);
    expect(read("src/pages/About.tsx")).not.toMatch(/Who runs resumebooster\.work/i);
    for (const f of readdirSync(LOCALES).filter((x) => x.endsWith(".json"))) {
      const d = String(locale(f).aboutPage.metaDescription);
      expect(d, f).toContain("resumebooster.work");
      expect(d, f).not.toMatch(/^(?:Who runs|Wer resumebooster|Quién gestiona|Qui gère|Wie resumebooster|Quem gere|Sino ang nagpapatakbo)|कौन चलाता/);
    }
  });
});

describe("the bake's other review fixes", () => {
  const bake = read("scripts/prerender-seo.mjs");
  it("gives the MCP server's SoftwareApplication a free offer", () => {
    expect(bake).toMatch(/"@id": `\$\{SITE\}\/agents#mcp-server`[\s\S]{0,900}offers: \{ "@type": "Offer", price: "0", priceCurrency: "USD" \}/);
  });
  it("lets crawlers read /dev/checkout-test's noindex: no Disallow, and a noindex page there", () => {
    expect(read("public/robots.txt")).not.toMatch(/^Disallow: \/dev\//m);
    expect(bake).toMatch(/path: "\/dev\/checkout-test",\s*robots: "noindex, nofollow",/);
  });
  it("says of a name-shared board only what the bake knows", () => {
    const pages = read("scripts/prerender-pages.mjs");
    expect(pages).toContain("another board under the same name, which we cannot tie to this one, has a page of its own");
    expect(pages).not.toContain("a different employer under the same name has a page of its own");
  });
});
