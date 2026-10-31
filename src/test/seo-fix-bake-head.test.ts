/**
 * THE SEO ROUND'S REVIEW, THE BAKE'S HEADS (2026-10-24).
 *
 *   - The root index.html is also the page Lovable serves for every address
 *     the bake did not write (/auth, /account, an unbaked posting), and the
 *     round wrote the homepage's twelve route chunks into its static head:
 *     about 103 KB gzip on pages that never run them (/auth LCP 3,192 ms on a
 *     phone against 2,696 ms without).
 *   - /companies said every listed "company" was read from its own hiring
 *     system, while its list holds USAJOBS and a staffing agency.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fallbackPreloadHtml } from "../../scripts/prerender-preload.mjs";
import { bannedSourcePhrasesIn } from "../../scripts/prerender-copy.mjs";

const ROOT = resolve(__dirname, "../..");
const BAKE = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");

/** Runs the head's inline script against a stand-in document at one address; returns the hrefs it added. */
const runAt = (html: string, pathname: string): string[] => {
  const added: string[] = [];
  const doc = {
    head: { appendChild: (l: { href: string }) => added.push(l.href) },
    createElement: () => ({ rel: "", href: "" }),
  };
  for (const m of html.matchAll(/<script data-home-preload="1">([\s\S]*?)<\/script>/g)) {
    new Function("location", "document", m[1])({ pathname }, doc);
  }
  return added;
};

describe("the SPA fallback's static head preloads only what every page runs", () => {
  const files = ["Index-a1.js", "ValueComparison-b2.js", "SEO-c3.js", "Footer-f9.js"];
  const html = fallbackPreloadHtml(files, { always: ["Footer-f9.js"] });

  it("names Footer in the static head and no homepage chunk", () => {
    const hints = [...html.matchAll(/<link rel="modulepreload" href="\/assets\/([^"]+)">/g)].map((m) => m[1]);
    expect(hints).toEqual(["Footer-f9.js"]);
  });
  it("adds the homepage's chunks on '/' only", () => {
    expect(runAt(html, "/")).toEqual(["/assets/Index-a1.js", "/assets/ValueComparison-b2.js", "/assets/SEO-c3.js"]);
    expect(runAt(html, "/auth")).toEqual([]);
    expect(runAt(html, "/jobs/posting/workday/notbaked~wd1~x/R000000")).toEqual([]);
  });
  it("is what the bake writes into the fallback's head", () => {
    expect(BAKE).toMatch(/headExtra \+= preloadFor\(path, \{ fallback: isFallback \}\);/);
    // A scanner address of "/" preloads the scanner's chunks instead (review
    // round 2026-10-26, hp-fix-a-scanner-address-is-only-the-scanners).
    expect(BAKE).toMatch(/\? fallbackPreloadHtml\(files, \{ always: FOOTER_CHUNK \? \[FOOTER_CHUNK\] : \[\], scanner \}\)/);
  });
  it("never writes a file name the script could be broken by", () => {
    expect(fallbackPreloadHtml(['x"];alert(1);//.js', "Index-a.js"], { always: [] })).not.toContain("alert");
  });
});

describe("/companies says what each listed board is", () => {
  it("counts employers only and labels the federal listing site and staffing agencies", () => {
    expect(BAKE).toMatch(/title: `\$\{fmt\(employersListed\)\} Companies Hiring Now, From Their Own Hiring Systems`/);
    expect(BAKE).toMatch(/const KIND_LABEL = \{ usajobs: "the federal listing site", agency: "a staffing agency" \};/);
    expect(BAKE).not.toMatch(/Every posting comes from the company's own hiring system\./);
  });
  it("and React's /companies head says the same in every language: no 'every employer ... its own hiring system'", () => {
    const dir = resolve(ROOT, "src/i18n/shards/company");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(resolve(dir, f), "utf8")).companyProfile.directory;
      expect(String(d.seoDescription), f).not.toMatch(/Every employer on the board is read straight from its own hiring system|Jeder Arbeitgeber auf der Jobbörse wird direkt|Cada empleador del portal se lee directamente|Chaque employeur est lu directement|Elke werkgever wordt rechtstreeks|Cada empregador do portal é lido|Bawat employer sa board ay binabasa|हर नियोक्ता को सीधे/);
      expect(String(d.seoTitle), f).not.toMatch(/Their Own Hiring Systems|ihren eigenen|sus propios|leurs propres|hun eigen|seus próprios|sarili nilang|उनके अपने/);
    }
    const page = readFileSync(resolve(ROOT, "src/pages/Companies.tsx"), "utf8");
    expect(page).toContain(JSON.stringify(JSON.parse(readFileSync(resolve(ROOT, "src/i18n/shards/company/en.json"), "utf8")).companyProfile.directory.seoDescription));
  });
  it("refuses the blanket sentences on any page the bake writes", () => {
    expect(bannedSourcePhrasesIn("Every posting comes from the company's own hiring system.")).toHaveLength(1);
    expect(bannedSourcePhrasesIn("96,532 live openings, each read from the employer's own hiring system.")).toHaveLength(1);
    expect(bannedSourcePhrasesIn("Every posting is read from the hiring system that published it: an employer's own, a staffing agency's (labelled) or the federal listing site (labelled).")).toEqual([]);
  });
});
