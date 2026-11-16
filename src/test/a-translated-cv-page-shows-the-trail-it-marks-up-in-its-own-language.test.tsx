/**
 * A TRANSLATED CV PAGE SHOWS THE TRAIL IT MARKS UP, IN ITS OWN LANGUAGE
 * (SEO-F18, the bug round's review).
 *
 * WHAT WAS WRONG. The round gave the translated CV-standards pages (es, fr,
 * de, pt, nl) a BreadcrumbList, but an English one ("Home", "CV Standards"),
 * on baked pages that show no trail at all: the bake's translated pages print
 * no breadcrumb nav (dist/de/lebenslauf-standards/deutschland.html, offline
 * bake of 2026-11-16: the markup's trail, no <nav>). Markup that describes
 * nothing on the page is what a search engine discounts. The React page
 * showed the trail, in English, on every language.
 *
 * WHAT HOLDS NOW. Each CV template carries the trail's two labels in its own
 * language. The bake builds one trail for a translated page and prints it
 * both ways, the visible nav and the BreadcrumbList; the React page prints
 * the same labels. (The bake's main needs the live database, so its wiring is
 * read from the shipped source; the React page is rendered.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import CvStandards from "@/pages/CvStandards";
import { CV_LOCALES, EN_TEMPLATE } from "@/data/cv-standards-content";

afterEach(cleanup);

const BAKE = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
const TRANSLATED = (() => {
  const a = BAKE.indexOf("// Localized pages per CV_LOCALES");
  expect(a, "the translated CV block moved").toBeGreaterThan(-1);
  return BAKE.slice(a, BAKE.indexOf("// ---- The employer pages this bake writes", a));
})();

type Labels = { breadcrumbHome?: string; breadcrumbIndex?: string };

describe("every CV template names the trail in its own language", () => {
  it("English and the five translated templates carry both labels", () => {
    expect((EN_TEMPLATE as Labels).breadcrumbHome).toBe("Home");
    expect((EN_TEMPLATE as Labels).breadcrumbIndex).toBe("CV Standards");
    for (const [locale, cfg] of Object.entries(CV_LOCALES)) {
      const t = cfg.t as Labels;
      expect(t.breadcrumbHome, locale).toBeTruthy();
      expect(t.breadcrumbIndex, locale).toBeTruthy();
      expect(t.breadcrumbIndex, `${locale} names the index in English`).not.toBe("CV Standards");
    }
    expect((CV_LOCALES.de.t as Labels).breadcrumbHome).toBe("Startseite");
  });
});

describe("the bake's translated CV pages", () => {
  it("build one trail from the template and print it both ways: the visible nav and the BreadcrumbList", () => {
    expect(TRANSLATED).toMatch(/const trail = \[\{ name: t\.breadcrumbHome, href: "\/", path: "\/" \}, \{ name: t\.breadcrumbIndex, href: "\/cv-standards", path: "\/cv-standards" \}, \{ name, path: `\/\$\{cfg\.pathBase\}\/\$\{slug\}` \}\];/);
    expect(TRANSLATED).toContain("breadcrumbLd(trail)");
    const content = TRANSLATED.slice(TRANSLATED.indexOf("content: `"));
    expect(content, "the translated page shows no trail").toContain("${breadcrumbNav(trail)}");
    expect(TRANSLATED, "an English trail is still marked up").not.toContain('{ name: "CV Standards", path: "/cv-standards" }');
  });
});

describe("the React page", () => {
  it("shows a German page's trail in German", () => {
    const slug = CV_LOCALES.de.slugs.DE;
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[`/de/lebenslauf-standards/${slug}`]}>
          <Routes><Route path="/de/lebenslauf-standards/:country" element={<CvStandards locale="de" />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    const nav = document.querySelector("main nav");
    expect(nav?.textContent).toBe(`Startseite / ${CV_LOCALES.de.t.breadcrumbIndex} / ${CV_LOCALES.de.content.DE.countryName}`);
  });

  it("keeps the English page's trail as it was", () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/cv-standards/germany"]}>
          <Routes><Route path="/cv-standards/:country" element={<CvStandards />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(document.querySelector("main nav")?.textContent).toBe("Home / CV Standards / Germany");
  });
});
