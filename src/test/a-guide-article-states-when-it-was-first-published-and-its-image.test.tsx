/**
 * A GUIDE'S ARTICLE STATES WHEN IT WAS FIRST PUBLISHED, AND ITS IMAGE
 * (SEO/GEO audit 2026-11-07, SD-09).
 *
 * The guides' Article markup carried dateModified alone and no image, the two
 * things Google's Article guidance asks for beside the headline; the research
 * page's Article already had both. Each guide now carries the day it was first
 * published (its first commit, written into src/data/guides.ts so nothing
 * reads git history) and names the share card every guide page already
 * carries as og:image. The bake writes the same two properties: the offline
 * bake in seo-bake-crawler-output.test.ts reads them off every guide page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resetBakedHeadForTests } from "@/components/seo/baked-head";
import { GUIDES, GUIDE_ARTICLE_IMAGE_PATH } from "@/data/guides";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import GuideArticle from "@/pages/GuideArticle";

vi.setConfig({ testTimeout: 30_000 });
afterEach(() => { cleanup(); document.head.innerHTML = ""; window.history.replaceState({}, "", "/"); resetBakedHeadForTests(); });

const guides = Object.values(GUIDES);

describe("every guide's first-publish date", () => {
  it("is a calendar day, no later than the day it was last changed", () => {
    expect(guides.length).toBeGreaterThan(0);
    for (const g of guides) {
      expect(g.published, g.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(Date.parse(g.published)), g.slug).toBe(true);
      expect(g.published <= g.updated, `${g.slug}: published ${g.published} after updated ${g.updated}`).toBe(true);
    }
  });

  it("names an image the site serves, the one every guide page carries as og:image", () => {
    expect(GUIDE_ARTICLE_IMAGE_PATH).toBe("/og-image.png");
    const head = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
    expect(head).toContain(`<meta property="og:image" content="https://resumebooster.work${GUIDE_ARTICLE_IMAGE_PATH}" />`);
  });
});

describe("the React guide page's Article, with no baked file (an SPA visit)", () => {
  it.each(guides.map((g) => [g.slug, g] as const))("%s states datePublished and image", async (_slug, g) => {
    const path = `/guides/${g.slug}`;
    window.history.replaceState({}, "", path);
    resetBakedHeadForTests();
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="/guides/:slug" element={<GuideArticle />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    const article = () => [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } })
      .find((b) => b && b["@type"] === "Article");
    await waitFor(() => expect(article()).toBeTruthy());
    expect(article()).toMatchObject({ datePublished: g.published, dateModified: g.updated, image: `https://resumebooster.work${GUIDE_ARTICLE_IMAGE_PATH}` });
  });
});
