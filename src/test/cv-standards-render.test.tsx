// SPA-side render tests for the CV-standards routes — the jsdom equivalent of
// loading the pages in a browser. The prerendered (crawler-facing) HTML is
// verified at build time; this locks the React (visitor-facing) side.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import CvStandards, { CvStandardsIndex } from "../pages/CvStandards";

const renderAt = (path: string, routePath: string, locale?: string) =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={<CvStandards locale={locale} />} />
          <Route path="/cv-standards" element={<CvStandardsIndex />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );

describe("CvStandards SPA routes", () => {
  it("renders the English Germany page with the engine's real data", () => {
    renderAt("/cv-standards/germany", "/cv-standards/:country");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/standards in Germany/i);
    expect(screen.getAllByText(/Lebenslauf/).length).toBeGreaterThan(0); // docTerm from the engine
    // The page states it in its section and again in the visible FAQ answer (SEO-032).
    expect(screen.getAllByText(/still widely included, and some recruiters still expect one/i)[0]).toBeInTheDocument();
  });

  it("renders the localized German page in German", () => {
    renderAt("/de/lebenslauf-standards/deutschland", "/de/lebenslauf-standards/:country", "de");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Lebenslauf-Standards in Deutschland/);
    // The page states it in its section and again in the visible FAQ answer (SEO-032).
    expect(screen.getAllByText(/weiterhin weit verbreitet/)[0]).toBeInTheDocument(); // hand-translated note
  });

  it("renders the localized Spanish Argentina page with the Ley 6471 detail", () => {
    renderAt("/es/normas-cv/argentina", "/es/normas-cv/:country", "es");
    // The page states it in its section and again in the visible FAQ answer (SEO-032).
    expect(screen.getAllByText(/Ley 6471/)[0]).toBeInTheDocument();
  });

  it("renders the index with every engine country", () => {
    renderAt("/cv-standards", "/cv-standards/:country");
    expect(screen.getByText("Germany")).toBeInTheDocument();
    expect(screen.getByText("Japan")).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  it("redirects unknown countries to the index instead of crashing", () => {
    renderAt("/cv-standards/atlantis", "/cv-standards/:country");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/by country/i);
  });
});
