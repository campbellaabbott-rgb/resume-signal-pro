/**
 * THE HOMEPAGE SAYS WHOSE SITE IT IS (B03, GEO-04).
 *
 * On 2026-11-07 the homepage's title, H1 and meta description never named
 * "Resume Booster", five web searches for the site returned none of its pages
 * and showed resumebooster.io and ResumeBoostAI instead, and the #org entity
 * carried a name and a logo and nothing that said which "Resume Booster" it
 * was. The title and the description now name the brand in every language,
 * and the Organization says what it is and what it is not, with no sameAs,
 * legalName, address or contactPoint (owner decision SEO-045 / SEO-011a).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orgNode } from "../../scripts/prerender-copy.mjs";

const ROOT = resolve(__dirname, "../..");
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const home = (l: string) => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/home/${l}.json`), "utf8")).home as { seo: { title: string; description: string } };

describe("the homepage's title and description name the brand", () => {
  it.each(LNGS)("%s: the title names Resume Booster in 60 characters or fewer", (l) => {
    const { title } = home(l).seo;
    expect(title).toContain("Resume Booster");
    expect([...title].length).toBeLessThanOrEqual(60);
  });

  it.each(LNGS)("%s: the description names Resume Booster in 160 characters or fewer", (l) => {
    const { description } = home(l).seo;
    expect(description).toContain("Resume Booster");
    expect([...description].length).toBeLessThanOrEqual(160);
  });

  it("English opens the description with what the site is", () => {
    expect(home("en").seo.description.startsWith("Resume Booster is a free job board")).toBe(true);
    expect(home("en-GB").seo.description).toBe(home("en").seo.description);
  });
});

describe("the Organization says which Resume Booster it is, and nothing the owner has not supplied", () => {
  const o = orgNode("https://resumebooster.work") as Record<string, unknown>;

  it("carries a description and a disambiguation naming the look-alikes", () => {
    expect(String(o.description)).toMatch(/^Resume Booster is a free job board/);
    expect(String(o.disambiguatingDescription)).toContain("resumebooster.work");
    expect(String(o.disambiguatingDescription)).toMatch(/resumebooster\.io/);
    expect(String(o.disambiguatingDescription)).toMatch(/ResumeBoostAI/);
  });

  it("carries no sameAs, legalName, address or contactPoint", () => {
    for (const k of ["sameAs", "legalName", "address", "contactPoint"]) expect(o, k).not.toHaveProperty(k);
  });
});
