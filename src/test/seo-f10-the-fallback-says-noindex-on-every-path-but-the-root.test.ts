/**
 * SEO-F10, THE OWNER'S CHOICE: THE FALLBACK SAYS NOINDEX ON EVERY PATH BUT
 * THE ROOT (index.html, branch bugs/a-site-shell-owner).
 *
 * WHAT WAS WRONG. The host serves the baked root page for every address with
 * no baked page of its own: an unbaked live posting, a mistyped address. Its
 * robots tag said index, follow, so each such address was an indexable copy
 * of the homepage, or, once React rendered it, an indexable page the bake had
 * never vouched for.
 *
 * WHAT HOLDS NOW, with this branch's index.html rendered through the bake's
 * own composeHtml and every inline script run in document order:
 *   - the fallback at any path but the root says noindex, follow, once;
 *   - the root, and a scanner address of the root, keep index, follow;
 *   - a baked page at its own address keeps its robots, whatever they are;
 *   - the template served when the bake did not run is left alone, so a
 *     failed bake never takes the site out of search;
 *   - the script runs after the fallback's own script, which takes the
 *     canonical off, and before the app.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scannerAddressScript } from "@/lib/scanner-address";
import { composeHtml } from "../../scripts/prerender-seo.mjs";

const TEMPLATE = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const bake = (page: Record<string, unknown>): string =>
  composeHtml(
    { title: "A title", description: "A description", content: "<h1>A page</h1>", ...page } as never,
    { template: TEMPLATE, D: { POSTING_LD_TAG_ID: "posting-jsonld", scannerAddressScript }, esc, shell: (c: string) => c, preloadFor: () => "", publicHref: (p: string) => p, onTruncated: () => {} } as never,
  );

/** Serve `html` at `address`: the document as written, then each classic inline script in order. */
function serve(html: string, address: string): void {
  window.history.replaceState({}, "", address);
  const doc = new DOMParser().parseFromString(html, "text/html");
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  for (const s of [...doc.querySelectorAll("script")]) {
    if (s.getAttribute("src") || (s.getAttribute("type") ?? "") !== "") continue;
    new Function(s.textContent ?? "")();
  }
}
const robots = () => [...document.head.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content"));

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  try { sessionStorage.clear(); } catch { /* none */ }
});

describe("the fallback", () => {
  const fallback = bake({ path: "/", isFallback: true });

  it("says noindex, follow, once, at an unbaked posting and at a mistyped address", () => {
    for (const address of ["/jobs/acme-nurse-12345", "/jobs/acme-nurse-12345/", "/no-such-page?x=1"]) {
      serve(fallback, address);
      expect(robots(), address).toEqual(["noindex, follow"]);
    }
  });

  it("keeps index, follow at the root, and at a scanner address of the root", () => {
    serve(fallback, "/");
    expect(robots()).toEqual(["index, follow"]);
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();
    serve(fallback, "/#upload");
    expect(document.head.querySelector('link[rel="canonical"]'), "the fallback's own script takes the canonical off a scanner address").toBeNull();
    expect(robots()).toEqual(["index, follow"]);
  });
});

describe("what is not the fallback", () => {
  it("a baked page at its own address keeps its robots", () => {
    serve(bake({ path: "/jobs/acme-nurse-12345" }), "/jobs/acme-nurse-12345");
    expect(robots()).toEqual(["index, follow"]);
    serve(bake({ path: "/jobs/acme-nurse-99999", robots: "noindex, follow" }), "/jobs/acme-nurse-99999");
    expect(robots()).toEqual(["noindex, follow"]);
    serve(bake({ path: "/pricing" }), "/pricing/");
    expect(robots()).toEqual(["index, follow"]);
  });

  it("the template served when the bake did not run is left alone", () => {
    serve(TEMPLATE, "/pricing");
    expect(robots(), "a failed bake took the site out of search").toEqual(["index, follow"]);
  });
});

describe("where the script sits", () => {
  it("after the root and the fallback's own script, before the app", () => {
    const html = bake({ path: "/", isFallback: true });
    const root = html.indexOf('<div id="root">');
    const clear = html.indexOf('<script>if(location.pathname!=="/"');
    const mine = html.indexOf("<script data-fallback-noindex>");
    const app = html.indexOf('<script type="module"');
    expect(root).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(root);
    expect(mine).toBeGreaterThan(clear);
    expect(app).toBeGreaterThan(mine);
  });

  it("is one script in the template, outside the head", () => {
    expect(TEMPLATE.split("data-fallback-noindex").length - 1).toBe(1);
    expect(TEMPLATE.indexOf("data-fallback-noindex")).toBeGreaterThan(TEMPLATE.indexOf("</head>"));
  });
});
