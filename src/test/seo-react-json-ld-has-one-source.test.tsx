/**
 * A ROUTE STATES EACH STRUCTURED-DATA TYPE ONCE (SEO-031).
 *
 * The bake writes each prerendered route's JSON-LD into its head, and nothing
 * removed it when the React page rendered its own block of the same @type, so
 * after hydration /methodology carried two different HowTo entities, the
 * keyword pages two BreadcrumbList/FAQPage sets, /vs two FAQPages, and so on.
 *
 *   - A page with a baked file for this address renders no JSON-LD of its own:
 *     the bake is the single source (PageJsonLd).
 *   - Without a baked file (an SPA visit, or a build whose bake did not run)
 *     the page renders its own blocks (the positive control).
 *   - A page that still renders its own block over a baked one (the homepage
 *     and /pricing, owned elsewhere) has the baked block of that @type removed
 *     (supersedeBakedJsonLd, run by SEO).
 *   - /methodology states no HowTo at all (Google no longer shows HowTo results).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import type { ReactElement } from "react";
import { resetBakedHeadForTests, ldTypesOf } from "@/components/seo/baked-head";
import { SEO } from "@/components/seo/SEO";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stub(),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stub() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Methodology from "@/pages/Methodology";
import IndustryKeywords from "@/pages/IndustryKeywords";
import RoleKeywords from "@/pages/RoleKeywords";
import VsCompetitor from "@/pages/VsCompetitor";
import AtsVendorGuide from "@/pages/AtsVendorGuide";
import GuideArticle from "@/pages/GuideArticle";
import ScoreStudy from "@/pages/ScoreStudy";

vi.setConfig({ testTimeout: 30_000 });
afterEach(() => { cleanup(); document.head.innerHTML = ""; window.history.replaceState({}, "", "/"); resetBakedHeadForTests(); });

const ROUTES: Array<{ path: string; route: string; el: ReactElement; baked: string[] }> = [
  { path: "/methodology", route: "/methodology", el: <Methodology />, baked: ["WebPage", "BreadcrumbList"] },
  { path: "/industries/hr", route: "/industries/:slug", el: <IndustryKeywords />, baked: ["BreadcrumbList", "FAQPage"] },
  { path: "/roles/rn", route: "/roles/:slug", el: <RoleKeywords />, baked: ["BreadcrumbList"] },
  { path: "/vs/chatgpt", route: "/vs/:slug", el: <VsCompetitor />, baked: ["FAQPage"] },
  { path: "/ats/workday", route: "/ats/:vendor", el: <AtsVendorGuide />, baked: ["FAQPage"] },
  { path: "/guides/why-resumes-get-rejected", route: "/guides/:slug", el: <GuideArticle />, baked: ["Article", "BreadcrumbList"] },
  { path: "/research/ats-score-benchmarks", route: "/research/ats-score-benchmarks", el: <ScoreStudy />, baked: ["Article", "Dataset"] },
];

/** A prerendered file's head at `path`, with one baked block per type. */
function bake(path: string, types: string[]) {
  window.history.replaceState({}, "", path);
  document.head.innerHTML = [
    "<title>Baked</title>",
    '<meta name="description" content="Baked.">',
    `<link rel="canonical" href="https://resumebooster.work${path}">`,
    '<meta name="x-prerendered" content="1">',
    ...types.map((t) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": t, name: "baked" })}</script>`),
  ].join("");
  resetBakedHeadForTests();
}
const mount = (path: string, route: string, el: ReactElement) =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={el} /></Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
const typesOnPage = () => [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => ldTypesOf(s.textContent));
const repeated = (types: string[]) => types.filter((t, i) => types.indexOf(t) !== i);

describe("over its own baked file", () => {
  it.each(ROUTES)("$path repeats no @type, and the bake's blocks are the ones left", async ({ path, route, el, baked }) => {
    bake(path, baked);
    mount(path, route, el);
    await new Promise((r) => setTimeout(r, 30));
    const types = typesOnPage();
    expect(repeated(types), `${path}: ${types.join(", ")}`).toEqual([]);
    expect(types.sort()).toEqual([...baked].sort());
  });
});

describe("with no baked file (an SPA visit)", () => {
  it.each(ROUTES.filter((r) => r.path !== "/methodology" && r.path !== "/research/ats-score-benchmarks"))("$path renders its own structured data", async ({ path, route, el }) => {
    window.history.replaceState({}, "", path);
    resetBakedHeadForTests();
    mount(path, route, el);
    await waitFor(() => expect(typesOnPage().length).toBeGreaterThan(0));
    expect(repeated(typesOnPage())).toEqual([]);
  });
});

describe("/methodology", () => {
  it("states no HowTo, baked or not", async () => {
    window.history.replaceState({}, "", "/methodology");
    resetBakedHeadForTests();
    mount("/methodology", "/methodology", <Methodology />);
    await new Promise((r) => setTimeout(r, 30));
    expect(typesOnPage()).not.toContain("HowTo");
  });
});

describe("a page that renders its own block over a baked one", () => {
  function OwnBlocks() {
    return (
      <>
        <SEO title="Pricing" description="Pricing." path="/pricing" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "react" }) }} />
      </>
    );
  }
  it("keeps one block of the type: the baked one of that type is removed, others stay", async () => {
    bake("/pricing", ["SoftwareApplication", "BreadcrumbList"]);
    mount("/pricing", "/pricing", <OwnBlocks />);
    await waitFor(() => expect(repeated(typesOnPage())).toEqual([]));
    expect(typesOnPage().sort()).toEqual(["BreadcrumbList", "SoftwareApplication"]);
    const app = [...document.querySelectorAll('script[type="application/ld+json"]')].find((s) => ldTypesOf(s.textContent).includes("SoftwareApplication"));
    expect(JSON.parse(app?.textContent ?? "{}").name).toBe("react");
  });
});

// THE SEO CHUNK STAYS SMALL (measured on the built output, 2026-10-24).
// SEO.tsx is in every page's chunk graph, and PageJsonLd imported its posting
// slot id from src/components/jobs/posting-page.ts: the bundler moved that
// whole module (8 KB gzip) into the shared SEO chunk, so /, /pricing and every
// other page downloaded the posting page's builders (SEO chunk 957 B -> 10,408
// B gzip). The head modules name the slot themselves; this holds the two equal
// and the slot left in place.
describe("the posting slot", () => {
  it("is named by the head modules without importing the posting page's builders", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { codeOf } = await import("./helpers/strip-comments");
    for (const f of ["../components/seo/PageJsonLd.tsx", "../components/seo/SEO.tsx", "../components/seo/baked-head.ts"]) {
      expect(codeOf(readFileSync(resolve(__dirname, f), "utf8")), f).not.toMatch(/components\/jobs\/posting-page/);
    }
    const { POSTING_LD_TAG_ID } = await import("@/components/jobs/posting-page");
    const { POSTING_SLOT_ID } = await import("@/components/seo/PageJsonLd");
    expect(POSTING_SLOT_ID).toBe(POSTING_LD_TAG_ID);
  });

  it("keeps the baked posting block when React states a JobPosting of its own", async () => {
    const { supersedeBakedJsonLd, POSTING_SLOT_ID } = await import("@/components/seo/PageJsonLd");
    document.head.innerHTML = `<script type="application/ld+json" id="${POSTING_SLOT_ID}">{"@type":"JobPosting","title":"baked"}</script><script type="application/ld+json">{"@type":"JobPosting","title":"stray"}</script>`;
    const own = document.createElement("script");
    own.type = "application/ld+json";
    own.textContent = JSON.stringify({ "@type": "JobPosting", title: "react" });
    (own as unknown as Record<string, unknown>)["__reactFiber$test"] = {};
    document.body.appendChild(own);
    supersedeBakedJsonLd();
    const left = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent || "{}").title);
    expect(left.sort()).toEqual(["baked", "react"]);
    own.remove();
    document.head.innerHTML = "";
  });
});
