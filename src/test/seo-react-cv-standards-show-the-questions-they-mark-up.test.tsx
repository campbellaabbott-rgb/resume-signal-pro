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
import { CV_LOCALES, EN_TEMPLATE, countryPhraseFix, cvStandardsFaqs } from "@/data/cv-standards-content";

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

  it("leaves names that take no article alone (positive control)", () => {
    expect(countryPhraseFix("en", "in Germany", "Germany")).toBe("in Germany");
    expect(countryPhraseFix("pt", "Currículo em Brasil", "Brasil")).toBe("Currículo no Brasil");
    expect(countryPhraseFix("de", "Lebenslauf in Deutschland", "Deutschland")).toBe("Lebenslauf in Deutschland");
  });
});
