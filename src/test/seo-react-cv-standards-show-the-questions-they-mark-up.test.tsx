/**
 * A CV-STANDARDS PAGE SHOWS THE QUESTIONS ITS FAQ MARKUP ASKS (SEO-032).
 *
 * Baked /cv-standards/united-states and /germany (and 57 English and 16
 * localized pages in all) carried a FAQPage asking "Should a CV in United
 * States include a photo?" and "How long should a CV be in …?", and neither
 * question appeared on the page. Both renderers now print the two questions
 * with their answers, from the one array the markup is built from
 * (cvStandardsFaqs), and the country reads as its language says it after a
 * preposition: "in the United States", "in der Schweiz".
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import CvStandards from "@/pages/CvStandards";
import { COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan/country-standards";
import { CV_LOCALES, EN_TEMPLATE } from "@/data/cv-standards-content";
import { countryPhraseFix, cvFill, cvStandardsFaqs } from "@/lib/cv-country-phrase";

afterEach(cleanup);

const at = (path: string, route: string, locale?: string) =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={<CvStandards locale={locale} />} /></Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );

describe("the questions a country page answers", () => {
  it("/cv-standards/united-states shows both questions and both answers, as the markup states them", () => {
    at("/cv-standards/united-states", "/cv-standards/:country");
    const us = COUNTRY_STANDARDS.US;
    const faqs = cvStandardsFaqs(undefined, EN_TEMPLATE, { name: us.name, docTerm: us.docTerm, photo: us.photo, photoNote: us.photoNote, lengthNote: us.lengthNote });
    expect(faqs[0].q).toBe("Should a CV in the United States include a photo?");
    for (const f of faqs) {
      expect(screen.getByRole("heading", { level: 3, name: f.q })).toBeTruthy();
      expect(document.body.textContent).toContain(f.a);
    }
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("CV & resume standards in the United States");
  });

  it("a localized page asks in its own language, with the article German needs", () => {
    const slug = CV_LOCALES.de.slugs.CH;
    at(`/de/lebenslauf-standards/${slug}`, "/de/lebenslauf-standards/:country", "de");
    expect(screen.getByRole("heading", { level: 3, name: "Braucht ein Lebenslauf in der Schweiz ein Foto?" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: CV_LOCALES.de.t.faqHeading })).toBeTruthy();
  });

  // The bake fills its own copy of these pages with the same function
  // (src/lib/cv-country-phrase.ts), so the two renderers print one sentence
  // for each country.
  it("writes each phrase the way the bake's country-phrase rules do", () => {
    const fr = CV_LOCALES.fr.t;
    expect(cvFill(fr.intro, { name: "France", docTerm: "CV" }, "fr")).toContain("quand un CV vise la France");
    expect(cvFill(fr.ctaText, { name: "Belgique", docTerm: "CV" }, "fr")).toContain("selon les normes de la Belgique");
    expect(cvFill(fr.faqPhoto, { name: "Suisse", docTerm: "CV" }, "fr")).toBe("Faut-il une photo sur un CV en Suisse ?");
    const de = CV_LOCALES.de.t;
    expect(cvFill(de.intro, { name: "Schweiz", docTerm: "Lebenslauf" }, "de")).toContain("wenn ein Lebenslauf auf die Schweiz zielt");
    expect(cvFill(de.ctaText, { name: "Schweiz", docTerm: "Lebenslauf" }, "de")).toContain("nach den Normen von der Schweiz");
    const pt = CV_LOCALES.pt.t;
    expect(cvFill(pt.intro, { name: "Brasil", docTerm: "currículo" }, "pt")).toContain("quando um currículo mira o Brasil");
    expect(cvFill(pt.title, { name: "Brasil", docTerm: "currículo" }, "pt")).toBe("Currículo no Brasil: foto, extensão e formato");
    expect(cvFill(EN_TEMPLATE.intro, { name: "Czech Republic", docTerm: "CV" }, "en")).toContain("when a resume targets the Czech Republic");
    expect(cvFill("{name}'s norms", { name: "Netherlands" }, "en")).toBe("the Netherlands' norms");
  });

  it("leaves names that take no article alone (positive control)", () => {
    expect(countryPhraseFix("en", "in Germany", "Germany")).toBe("in Germany");
    expect(countryPhraseFix("pt", "Currículo em Brasil", "Brasil")).toBe("Currículo no Brasil");
    expect(countryPhraseFix("de", "Lebenslauf in Deutschland", "Deutschland")).toBe("Lebenslauf in Deutschland");
  });
});
