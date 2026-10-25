/**
 * /about IS A PAGE, NOT A SOFT 404, AND SAYS WHAT THE BAKED PAGE SAYS (SEO-011b).
 *
 * App.tsx had no /about route, so the catch-all painted NotFound over the
 * address: the baked /about (SEO-011a) would be repainted as "page not found"
 * for every crawler that runs scripts. The route renders the About page from
 * main-locale strings, present in all nine languages, with the baked page's
 * title, description, lead, sections and links, naming only the AI apps
 * seeker pages may name and no seller identity the owner has not supplied.
 *
 * Loaded from the baked file, the page keeps the baked head (one title,
 * unchanged), as the company and field pages do. And it never says the site
 * never submits an application: the server-side apply agent is still live
 * (d823aae4 took the same claim off the homepage).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";
import { codeOf } from "./helpers/strip-comments";
import { resetBakedHeadForTests } from "@/components/seo/baked-head";

const invoke = vi.fn(async () => ({ data: { total: 612345, companiesOpenCount: 24567, trackedTotal: 700000 }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) }, rpc: async () => ({ data: [], error: null }) },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import About from "@/pages/About";

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
  resetBakedHeadForTests();
});

const EN = readMainLocale("en.json").aboutPage as Record<string, string>;
const BAKED_TITLE = EN.metaTitle;

const mount = () =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/about"]}>
        <Routes><Route path="/about" element={<About />} /></Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );

describe("/about", () => {
  it("is a route in the app, above the catch-all", () => {
    const app = codeOf(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
    const about = app.indexOf('<Route path="/about" element={<About />} />');
    expect(about, "no /about route").toBeGreaterThan(0);
    expect(about).toBeLessThan(app.indexOf('<Route path="*"'));
    expect(app).toMatch(/const About = lazy\(\(\) => import\("\.\/pages\/About"\)\);/);
  });

  it("renders the baked page's heading, lead, sections, links and head", async () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("About Resume Booster");
    expect([...document.querySelectorAll("[data-about] h2")].map((h) => h.textContent)).toEqual([
      "What the board is", "How the counts are made", "Where to go next",
    ]);
    const text = () => document.querySelector("[data-about]")?.textContent ?? "";
    expect(text()).toContain("Resume Booster, at resumebooster.work, is two things: a live job board of openings read from employers' own hiring systems, not copied from other job boards, and a free resume scanner");
    expect(text()).toContain("not the same product as resumebooster.io or ResumeBoostAI.");
    expect(text()).toMatch(/whose date falls inside the last 30 days/);
    expect(text()).toContain("so the board count is not a count of employers");
    // The live count, dated to the day it was read.
    await waitFor(() => expect(document.querySelector("[data-about-board]")?.textContent).toContain("612,345 open postings from 24,567 company job boards with roles open (as of 20"));
    // The two inline links of the counts paragraph, and the next-steps links.
    const hrefs = [...document.querySelectorAll("[data-about] a")].map((a) => a.getAttribute("href"));
    for (const h of ["/ghost-job-index", "/methodology", "/jobs", "/companies", "/data-api", "/agents", "/trust", "/changelog"]) expect(hrefs).toContain(h);
    expect(text()).not.toMatch(/never submit/i);
    expect(text()).not.toMatch(/Cursor|VS Code|Cline|Windsurf|Gemini CLI|Codex/);
    expect(text()).not.toMatch(/<\/?(ghost|method)>/);
    await waitFor(() => expect(document.title).toBe(BAKED_TITLE));
    expect(BAKED_TITLE).toBe("About Resume Booster — a Live Job Board and a Free Resume Scan");
    expect([...document.head.querySelectorAll('meta[name="robots"]')].some((m) => /noindex/.test(m.getAttribute("content") ?? ""))).toBe(false);
  });

  it("loaded from the baked file, keeps the baked title and description: one title, unchanged", async () => {
    window.history.replaceState(null, "", "/about");
    document.head.innerHTML = `<meta name="x-prerendered" content="1"><title>Baked about title</title><meta name="description" content="Baked about description"><link rel="canonical" href="https://resumebooster.work/about">`;
    resetBakedHeadForTests();
    mount();
    await waitFor(() => expect(document.head.querySelectorAll('meta[name="description"]').length).toBe(1));
    expect(document.title).toBe("Baked about title");
    expect(document.head.querySelectorAll("title").length).toBe(1);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("Baked about description");
  });

  // The bake's own /about (scripts/prerender-seo.mjs, SEO-011a) lands from
  // the bake builder's branch; once it is here, its title and lead are these.
  const bakeSrc = existsSync(resolve(__dirname, "../../scripts/prerender-seo.mjs")) ? readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8") : "";
  const bakeAbout = /path: "\/about",\s*title: "([^"]+)"/.exec(bakeSrc);
  it.runIf(!!bakeAbout)("the baked /about carries the same title", () => {
    expect(bakeAbout![1]).toBe(EN.metaTitle);
  });

  it.each(LOCALE_FILES)("%s carries every aboutPage string, with both link tags and every placeholder", (file) => {
    const page = readMainLocale(file).aboutPage as Record<string, string> | undefined;
    expect(Object.keys(page ?? {}).sort()).toEqual(Object.keys(EN).sort());
    for (const [k, v] of Object.entries(page ?? {})) {
      expect(v).not.toMatch(/Cursor|VS Code|Cline/);
      expect(v).not.toMatch(/never submit/i);
      const vars = (s: string) => (s.match(/\{\{\w+\}\}|<\/?\w+>/g) ?? []).sort();
      expect(vars(v), `${file} aboutPage.${k}`).toEqual(vars(EN[k]));
    }
  });
});
