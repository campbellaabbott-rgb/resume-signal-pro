/**
 * AN ADDRESS WITH NO BAKED FILE IS NOT INDEXABLE (SEO-F10).
 *
 * /zz-not-real, /roles/not-a-real-role, /PRICING and an unbaked posting all
 * answered 200 with the homepage's bytes and its "index, follow". The
 * fallback's inline script took the canonical off but left the robots tag, so
 * an address the bake never wrote stayed an indexable copy of "/" until the
 * app wrote its own head. The owner's option: such an address is not
 * indexable. The script runs here against the fallback the bake composes.
 */
import { describe, expect, it } from "vitest";
import { scannerAddressScript } from "@/lib/scanner-address";
import { composeHtml } from "../../scripts/prerender-seo.mjs";

const TEMPLATE = `<html lang="en"><head><title>x</title><meta name="description" content="" /><meta name="robots" content="index, follow" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta name="twitter:title" content="" /><meta name="twitter:description" content="" /><meta property="og:url" content="" /><meta name="twitter:url" content="" /></head><body><div id="root"></div></body></html>`;
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fallback = () => composeHtml(
  { path: "/", title: "Resume Booster", description: "d", content: "<h1>Home</h1>", isFallback: true } as never,
  { template: TEMPLATE, D: { POSTING_LD_TAG_ID: "posting-jsonld", scannerAddressScript }, esc, shell: (c: string) => c, preloadFor: () => "", publicHref: (p: string) => p, onTruncated: () => {} } as never,
) as string;

/** The fallback as a browser at `pathname` leaves it once its inline script has run. */
function served(pathname: string, search = "") {
  const doc = new DOMParser().parseFromString(fallback(), "text/html");
  const script = [...doc.querySelectorAll("script")].map((s) => s.textContent ?? "").find((t) => t.includes("location.pathname"));
  expect(script, "the fallback carries its inline script").toBeTruthy();
  new Function("location", "document", "URLSearchParams", script!)({ pathname, search, hash: "" }, doc, URLSearchParams);
  return {
    robots: doc.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
  };
}

describe("the fallback's robots tag", () => {
  it.each(["/zz-not-real", "/roles/not-a-real-role", "/PRICING", "/jobs/posting/workday/zz/zz"])("is noindex, follow at %s", (path) => {
    expect(served(path)).toEqual({ robots: "noindex, follow", canonical: null });
  });

  it("stays index, follow on the homepage itself, with its canonical (the control)", () => {
    const home = served("/");
    expect(home.robots).toBe("index, follow");
    expect(home.canonical).toMatch(/\/$/);
  });
});
