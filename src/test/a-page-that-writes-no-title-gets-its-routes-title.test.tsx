/**
 * A PAGE THAT WRITES NO TITLE GETS ITS ROUTE'S TITLE (NB-43).
 *
 * WHAT WAS WRONG. Thirteen routes render no <SEO> (sign-in, the account, the
 * payment results, the employer shortlist, the affiliate pages, the agent
 * page and the owner's dashboards). After a client-side move to one of them
 * the tab kept the previous page's title, and loaded directly it showed the
 * homepage's title from the fallback shell, whose "index, follow" also stood
 * on the private ones.
 *
 * WHAT HOLDS NOW, with the real component, Helmet and React's own head:
 *   - a private page with no title of its own is named in the reader's
 *     language and told to no search engine, and the shell's title and
 *     robots beside it are gone;
 *   - a move from a page with its own title to one without, and back, names
 *     each correctly, and the noindex leaves with the private page;
 *   - a page's own title always wins;
 *   - on the document load of a page the bake wrote, an English reader keeps
 *     the bake's title and any other reader gets this one;
 *   - every route in App.tsx whose page writes no title is on the list, and
 *     only those (the 404 page, the catch-all, writes its own);
 *   - App.tsx mounts it inside the router.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import { Helmet, HelmetProvider } from "react-helmet-async";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { DEFAULT_HEADS, RouteDefaultHead, defaultHeadFor } from "@/components/RouteDefaultHead";
import { resetBakedHeadForTests } from "@/components/seo/baked-head";
import { codeOf } from "./helpers/strip-comments";
import { readMainLocale, readShards } from "./helpers/locale-strings";
import { mergeShards } from "@/i18n/merge-shards";

/** A reader's language, as the site loads it: the main locale with its shards merged in. */
async function readIn(lng: string): Promise<void> {
  i18n.addResourceBundle(lng, "translation", mergeShards(readMainLocale(`${lng}.json`), readShards(`${lng}.json`)), true, true);
  await i18n.changeLanguage(lng);
}

const SHELL_HEAD = `<title>Resume Booster: the homepage's title</title><meta name="robots" content="index, follow">`;

let go: NavigateFunction;
function Nav() {
  go = useNavigate();
  return null;
}
const OwnTitle = () => <Helmet><title>A page's own title</title></Helmet>;

const mount = (start: string, accountElement: JSX.Element = <p>the account</p>) =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[start]}>
        <Nav />
        <RouteDefaultHead />
        <Routes>
          <Route path="/account" element={accountElement} />
          <Route path="/pricing" element={<OwnTitle />} />
          <Route path="/affiliates" element={<p>the affiliate page</p>} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );

const robots = () => [...document.head.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content"));
const titles = () => [...document.head.querySelectorAll("title")].map((n) => n.textContent);

afterEach(async () => {
  cleanup();
  document.head.innerHTML = "";
  window.history.replaceState({}, "", "/");
  resetBakedHeadForTests();
  await i18n.changeLanguage("en");
});

describe("a page that writes no title", () => {
  it("is named, told to no search engine, and the shell's title and robots beside it are gone", async () => {
    document.head.innerHTML = SHELL_HEAD;
    mount("/account");
    await waitFor(() => expect(document.title).toBe("Your account — Resume Booster"));
    await waitFor(() => expect(titles()).toEqual(["Your account — Resume Booster"]));
    expect(robots()).toEqual(["noindex,nofollow"]);
  });

  it("a move from a page with its own title to one without, and back, names each, and the noindex leaves with the private page", async () => {
    mount("/pricing");
    await waitFor(() => expect(document.title).toBe("A page's own title"));
    expect(robots()).toEqual([]);
    act(() => go("/account"));
    await waitFor(() => expect(document.title, "the tab kept the previous page's title").toBe("Your account — Resume Booster"));
    expect(robots()).toEqual(["noindex,nofollow"]);
    act(() => go("/pricing"));
    await waitFor(() => expect(document.title).toBe("A page's own title"));
    expect(robots(), "the private page's noindex stayed on a public page").toEqual([]);
  });

  it("is named in the reader's language", async () => {
    await readIn("de");
    mount("/account");
    await waitFor(() => expect(document.title).toBe(`${i18n.t("siteShell.titles.account")} — Resume Booster`));
    expect(document.title).not.toContain("Your account");
  });

  it("a page's own title always wins", async () => {
    mount("/account", <OwnTitle />);
    await waitFor(() => expect(document.title).toBe("A page's own title"));
  });

  it("writes nothing on a route whose page writes its own head", () => {
    expect(defaultHeadFor("/pricing")).toBeNull();
    expect(defaultHeadFor("/jobs")).toBeNull();
    expect(defaultHeadFor("/account")?.noIndex).toBe(true);
    expect(defaultHeadFor("/r/abc123")?.key).toBe("affiliateRedirect");
  });
});

describe("a page the bake wrote", () => {
  const bake = (path: string, title: string) => {
    window.history.replaceState({}, "", path);
    document.head.innerHTML = `<meta name="x-prerendered" content="1"><title>${title}</title><link rel="canonical" href="https://resumebooster.work${path}"><meta name="robots" content="index, follow">`;
    resetBakedHeadForTests();
  };

  it("keeps the bake's title for an English reader on the document load", async () => {
    bake("/affiliates", "Baked affiliate title");
    mount("/affiliates");
    await new Promise((r) => setTimeout(r, 20));
    expect(document.title).toBe("Baked affiliate title");
  });

  it("gives any other reader the route's title in their language", async () => {
    await readIn("de");
    bake("/affiliates", "Baked affiliate title");
    mount("/affiliates");
    await waitFor(() => expect(document.title).toBe(`${i18n.t("siteShell.titles.affiliates")} — Resume Booster`));
    expect(titles()).toHaveLength(1);
  });
});

describe("the list is the routes whose pages write no title", () => {
  const app = codeOf(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));

  /** Each lazily imported page and its file. */
  const pages = new Map<string, string>();
  for (const m of app.matchAll(/const (\w+) = lazy\(\(\) => import\("\.\/pages\/([^"]+)"\)/g)) {
    const base = resolve(__dirname, "../pages", m[2]);
    const file = [`${base}.tsx`, `${base}.ts`, resolve(base, "index.tsx")].find(existsSync);
    if (file) pages.set(m[1], file);
  }
  /** Whether a page file writes a head title of its own. */
  const writesTitle = (file: string) => /<SEO\b|<Helmet\b|<title\b/.test(codeOf(readFileSync(file, "utf8")));

  it("names every route whose page writes no title, and only those", () => {
    const untitled: string[] = [];
    let routes = 0;
    for (const m of app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)) {
      const page = [...m[2].matchAll(/<(\w+)/g)].map((x) => x[1]).find((n) => pages.has(n));
      if (!page) continue;
      routes++;
      if (!writesTitle(pages.get(page)!)) untitled.push(m[1]);
    }
    expect(routes, "the route scan found almost nothing: it has drifted").toBeGreaterThan(40);
    expect(untitled.sort()).toEqual(DEFAULT_HEADS.map((h) => h.path).sort());
    // The catch-all is the 404 page, which writes its own title.
    expect(app).toMatch(/<Route path="\*" element=\{<NotFound \/>\} \/>/);
  });

  it("every title on the list is a string in the shard", () => {
    for (const h of DEFAULT_HEADS) expect(i18n.exists(`siteShell.titles.${h.key}`, { lng: "en" }), h.key).toBe(true);
  });

  it("App.tsx mounts it inside the router, before the routes", () => {
    const i = app.indexOf("<RouteDefaultHead />");
    expect(i).toBeGreaterThan(app.indexOf("<BrowserRouter>"));
    expect(i).toBeLessThan(app.indexOf("<Routes>"));
  });
});
