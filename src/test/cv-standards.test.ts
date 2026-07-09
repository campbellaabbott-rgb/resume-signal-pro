// Regression tests for the per-country CV-standards SEO pages.
// Locks: every country in the engine has an EN slug + sitemap URL, every
// localized page maps to a real country with hand-translated content, hreflang
// clusters are complete, and template strings keep their placeholders.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan/country-standards";
import {
  COUNTRY_SLUGS,
  CV_LOCALES,
  EN_TEMPLATE,
  fill,
  hreflangCluster,
} from "../data/cv-standards-content";

const sitemap = readFileSync(join(__dirname, "../../public/sitemap.xml"), "utf8");

describe("cv-standards data integrity", () => {
  it("every country in the engine has a slug, and every slug points at a real country", () => {
    for (const iso of Object.keys(COUNTRY_STANDARDS)) {
      expect(COUNTRY_SLUGS[iso], `missing slug for ${iso}`).toBeTruthy();
    }
    for (const iso of Object.keys(COUNTRY_SLUGS)) {
      expect(COUNTRY_STANDARDS[iso], `slug for ${iso} has no engine entry`).toBeTruthy();
    }
  });

  it("slugs are unique", () => {
    const slugs = Object.values(COUNTRY_SLUGS);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every localized page maps to a real country AND has hand-translated content", () => {
    for (const [locale, cfg] of Object.entries(CV_LOCALES)) {
      for (const iso of Object.keys(cfg.slugs)) {
        expect(COUNTRY_STANDARDS[iso], `${locale}: ${iso} not in engine`).toBeTruthy();
        const c = cfg.content[iso];
        expect(c, `${locale}: ${iso} missing localized content`).toBeTruthy();
        expect(c.photoNote.length, `${locale}/${iso} photoNote empty`).toBeGreaterThan(20);
        expect(c.personalDataNote.length, `${locale}/${iso} personalDataNote empty`).toBeGreaterThan(10);
      }
      // no orphan content without a slug
      for (const iso of Object.keys(cfg.content)) {
        expect(cfg.slugs[iso], `${locale}: content for ${iso} but no slug`).toBeTruthy();
      }
    }
  });

  it("template strings keep their interpolation placeholders in every locale", () => {
    const templates = [EN_TEMPLATE, ...Object.values(CV_LOCALES).map((c) => c.t)];
    for (const t of templates) {
      expect(t.title).toContain("{name}");
      expect(t.h1).toContain("{name}");
      expect(t.intro).toContain("{docTerm}");
      expect(t.ctaText).toContain("{name}");
      expect(Object.keys(t.photoNorms).sort()).toEqual(
        ["common", "discouraged", "expected", "never", "optional"],
      );
    }
    expect(fill("x {name} y", { name: "Z" })).toBe("x Z y");
  });

  it("hreflang clusters are complete: en + every locale that covers the country", () => {
    const de = hreflangCluster("DE");
    expect(de.en).toBe("/cv-standards/germany");
    expect(de.de).toBe("/de/lebenslauf-standards/deutschland");
    const be = hreflangCluster("BE"); // covered by BOTH fr and nl
    expect(be.fr).toBe("/fr/normes-cv/belgique");
    expect(be.nl).toBe("/nl/cv-normen/belgie");
    const us = hreflangCluster("US"); // EN-only
    expect(Object.keys(us)).toEqual(["en"]);
  });

  it("the sitemap contains the index, every EN country URL, and every localized URL", () => {
    expect(sitemap).toContain("<loc>https://resumebooster.work/cv-standards</loc>");
    for (const iso of Object.keys(COUNTRY_SLUGS)) {
      if (!COUNTRY_STANDARDS[iso]) continue;
      expect(sitemap, `sitemap missing ${iso}`).toContain(
        `<loc>https://resumebooster.work/cv-standards/${COUNTRY_SLUGS[iso]}</loc>`,
      );
    }
    for (const cfg of Object.values(CV_LOCALES)) {
      for (const [iso, slug] of Object.entries(cfg.slugs)) {
        if (!cfg.content[iso]) continue;
        expect(sitemap).toContain(`<loc>https://resumebooster.work/${cfg.pathBase}/${slug}</loc>`);
      }
    }
  });
});
