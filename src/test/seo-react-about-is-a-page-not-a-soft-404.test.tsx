/**
 * /about IS A PAGE, NOT A SOFT 404 (SEO-011b).
 *
 * App.tsx had no /about route, so the catch-all painted NotFound over the
 * address: a baked /about would be repainted as "page not found" for every
 * crawler that runs scripts. The route renders the About page from main-
 * locale strings (which the bake reads from en.json for its own /about),
 * present in all nine languages, naming only the AI apps seeker pages may
 * name and no contact detail the owner has not published.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import About from "@/pages/About";
import { LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";
import { codeOf } from "./helpers/strip-comments";

afterEach(cleanup);

describe("/about", () => {
  it("is a route in the app, above the catch-all", () => {
    const app = codeOf(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
    const about = app.indexOf('<Route path="/about" element={<About />} />');
    expect(about, "no /about route").toBeGreaterThan(0);
    expect(about).toBeLessThan(app.indexOf('<Route path="*"'));
    expect(app).toMatch(/const About = lazy\(\(\) => import\("\.\/pages\/About"\)\);/);
  });

  it("renders the page's own heading, sections and head", async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/about"]}>
          <Routes><Route path="/about" element={<About />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("About Resume Booster");
    expect([...document.querySelectorAll("[data-about] h2")].map((h) => h.textContent)).toEqual([
      "What the job board is", "How the counts are made", "Not to be confused with", "Use it from your AI app", "Contact",
    ]);
    // The page's own article: the shared header and footer are not this page's words.
    const text = document.querySelector("[data-about]")?.textContent ?? "";
    expect(text).toMatch(/inside the last 30 days/);
    expect(text).not.toMatch(/Cursor|VS Code|Cline|Windsurf|Gemini CLI|Codex/);
    expect(text).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    await screen.findByText("About Resume Booster");
    expect(document.title).toBe("About Resume Booster — How the Live Job Board Works");
    expect([...document.head.querySelectorAll('meta[name="robots"]')].some((m) => /noindex/.test(m.getAttribute("content") ?? ""))).toBe(false);
  });

  it.each(LOCALE_FILES)("%s carries every aboutPage string", (file) => {
    const en = readMainLocale("en.json").aboutPage as Record<string, string>;
    const page = readMainLocale(file).aboutPage as Record<string, string> | undefined;
    expect(Object.keys(page ?? {}).sort()).toEqual(Object.keys(en).sort());
    for (const v of Object.values(page ?? {})) expect(v).not.toMatch(/Cursor|VS Code|Cline/);
  });
});
