/**
 * ONLY AN INDEXABLE PAGE'S OWN BAKED HEAD IS KEPT (SEO round integration,
 * 2026-10-24).
 *
 * React keeps the baked title and description on a load of a baked file
 * (SEO-007, SEO preferBakedHead). A baked file is also what a stub is: a
 * company or posting the bake no longer gives a page ("no longer has a page
 * of its own here", noindex) and a duplicate pointing at its twin (canonical
 * elsewhere). When the app renders the live page over such a file, keeping
 * the stub's title would title a full company page "… no longer has a page
 * of its own here". The baked head is kept only when it carries no noindex
 * and its canonical names its own address.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { SEO } from "@/components/seo/SEO";
import { bakedHeadFor, resetBakedHeadForTests } from "@/components/seo/baked-head";

const SITE = "https://resumebooster.work";

function bake(path: string, title: string, robots: string, canonical: string) {
  window.history.replaceState({}, "", path);
  document.head.innerHTML = [
    `<title>${title}</title>`,
    `<meta name="description" content="baked description">`,
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${SITE}${canonical}">`,
    `<meta name="x-prerendered" content="1">`,
  ].join("");
  resetBakedHeadForTests();
}
const mount = (path: string) => render(
  <HelmetProvider>
    <SEO title="React's own title" description="React's own description" path={path} preferBakedHead />
  </HelmetProvider>,
);
const titles = () => [...document.head.querySelectorAll("title")].map((t) => t.textContent);

afterEach(() => { cleanup(); document.head.innerHTML = ""; resetBakedHeadForTests(); });

describe("which baked heads the app keeps", () => {
  it("an indexable page's own head is kept (positive control)", async () => {
    bake("/jobs/company/acme", "Acme jobs: 40 open roles from their own hiring system", "index, follow", "/jobs/company/acme");
    expect(bakedHeadFor("/jobs/company/acme")?.indexable).toBe(true);
    mount("/jobs/company/acme");
    await waitFor(() => expect(titles()).toEqual(["Acme jobs: 40 open roles from their own hiring system"]));
  });

  it("a noindex stub's head gives way to the page React renders", async () => {
    bake("/jobs/company/acme", "Acme no longer has a page of its own here", "noindex, follow", "/jobs/company/acme");
    expect(bakedHeadFor("/jobs/company/acme")?.indexable).toBe(false);
    mount("/jobs/company/acme");
    await waitFor(() => expect(titles()).toEqual(["React's own title"]));
  });

  it("a duplicate whose canonical names its twin gives way too", async () => {
    bake("/jobs/posting/greenhouse/acme/2", "This posting no longer has a page of its own — Nurse", "", "/jobs/posting/greenhouse/acme/1");
    expect(bakedHeadFor("/jobs/posting/greenhouse/acme/2")?.indexable).toBe(false);
    mount("/jobs/posting/greenhouse/acme/2");
    await waitFor(() => expect(titles()).toEqual(["React's own title"]));
  });

  it("a dotted company address with its trailing slash is still its own page", () => {
    bake("/jobs/company/careers.akima.com/", "Akima jobs: 356 open roles from their own hiring system", "index, follow", "/jobs/company/careers.akima.com/");
    expect(bakedHeadFor("/jobs/company/careers.akima.com")?.indexable).toBe(true);
  });
});
