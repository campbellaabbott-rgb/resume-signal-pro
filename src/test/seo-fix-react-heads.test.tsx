/**
 * THE SEO ROUND'S REVIEW, REACT'S HEADS AND ROUTES (2026-10-24).
 *
 *   - preferBakedHead kept the bake's ENGLISH title and description for every
 *     visitor of a baked page: a German reader of /jobs/company/dominos got
 *     "Domino's jobs: 29,163 open roles from their own hiring system" as the
 *     tab title over a German page (production showed "Jobs bei Domino's…").
 *     The baked head is kept only when the reader's language is the bake's.
 *   - /v1, /v1/jobs and the other baked API guidance pages were painted over
 *     by React's NotFound ("404 Oops! Page not found"), with two robots tags,
 *     because React had no /v1 route.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { SEO } from "@/components/seo/SEO";
import { resetBakedHeadForTests } from "@/components/seo/baked-head";
import { publicApiBase } from "@/config/public-endpoints";
import ApiAddress from "@/pages/ApiAddress";

const ROOT = resolve(__dirname, "../..");
afterEach(async () => {
  cleanup();
  document.head.innerHTML = "";
  resetBakedHeadForTests();
  await i18n.changeLanguage("en");
});

const bake = (path: string, title: string) => {
  window.history.replaceState({}, "", path);
  document.head.innerHTML = `<meta name="x-prerendered" content="1"><title>${title}</title><meta name="description" content="Baked description."><link rel="canonical" href="https://resumebooster.work${path}"><meta name="robots" content="index, follow">`;
  resetBakedHeadForTests();
};
const mount = () => render(
  <HelmetProvider>
    <SEO title="React title" description="React description." path="/about" preferBakedHead />
  </HelmetProvider>,
);

describe("a baked head is kept only for a reader of the bake's language", () => {
  it("keeps the baked English title for an English reader", async () => {
    await i18n.changeLanguage("en");
    bake("/about", "Baked English title");
    mount();
    await waitFor(() => expect(document.title).toBe("Baked English title"));
  });
  it("gives a German or Spanish reader React's localized head", async () => {
    for (const lng of ["de", "es"]) {
      await i18n.changeLanguage(lng);
      bake("/about", "Baked English title");
      mount();
      await waitFor(() => expect(document.title, lng).toBe("React title"));
      cleanup();
    }
  });
});

describe("the API's addresses on this site are a page of their own, not a 404", () => {
  it("states where the API lives, links /data-api and says noindex once", async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/v1/jobs"]}>
          <Routes><Route path="/v1/*" element={<ApiAddress />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This is not the API address");
    expect(document.body.textContent).toContain(`${publicApiBase()}/v1/jobs`);
    const article = document.querySelector("[data-api-address]") as HTMLElement;
    expect(within(article).getByRole("link", { name: /Hiring Data & API/ }).getAttribute("href")).toBe("/data-api");
    await waitFor(() => {
      const robots = [...document.head.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content"));
      expect(robots).toEqual(["noindex,nofollow"]);
    });
  });
  it("is routed for /v1 and everything under it", () => {
    const app = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
    // Nested, not a "/v1/" + "*" path literal: the route guards strip block
    // comments, and that literal would open one.
    expect(app).toMatch(/<Route path="\/v1">\s*<Route index element=\{<ApiAddress \/>\} \/>\s*<Route path="\*" element=\{<ApiAddress \/>\} \/>\s*<\/Route>/);
  });
});
