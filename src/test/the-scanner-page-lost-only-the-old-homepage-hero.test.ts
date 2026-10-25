/**
 * THE SCANNER PAGE LOST ONLY THE OLD HOMEPAGE HERO (homepage switch-over,
 * docs/homepage-pricing/README.md step 4: "src/pages/Index.tsx (hp/scanner,
 * delete-only)").
 *
 * Index served "/" as the homepage and every tool landing as the scanner. The
 * board-first homepage takes "/", so every Index route carries a landing and
 * the homepage-only parts go: the hero band (HomeHero with the
 * connect-your-AI strip), the strip itself, the head's board totals, and
 * their title and description fallbacks. Nothing of the scanner goes with
 * them: the uploader, the landing hero, the platform strip and the "#upload"
 * hash handling stay exactly as they were.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const INDEX = strip(readFileSync(resolve(ROOT, "src/pages/Index.tsx"), "utf8"));

describe("the homepage-only parts of Index are gone", () => {
  it("no hero band, no connect-your-AI strip", () => {
    expect(INDEX).not.toMatch(/<HomeHero\b/);
    expect(INDEX).not.toMatch(/\bHomeHero\b/);
    expect(INDEX).not.toMatch(/\bAgentOfferStrip\b/);
    expect(INDEX).not.toMatch(/!landing && !freeKeywordResult/);
    expect(existsSync(resolve(ROOT, "src/components/HomeHero.tsx")), "HomeHero.tsx has no page left to render it").toBe(false);
  });

  it("no homepage head: the title and description are the landing's", () => {
    expect(INDEX).not.toMatch(/\bhomeTitle\b|\bhomeDescription\b|\bhomeTotals\b/);
    expect(INDEX).not.toMatch(/use-board-totals/);
    expect(INDEX).toMatch(/title=\{landing\?\.title\}/);
    expect(INDEX).toMatch(/description=\{landing\?\.description\}/);
  });
});

describe("the scanner itself is untouched", () => {
  it("keeps the uploader, the landing hero and the platform strip", () => {
    expect(INDEX).toMatch(/<ResumeUploader\b/);
    expect(INDEX).toMatch(/\{\(landing \|\| freeKeywordResult\) && <Hero onFileSelect=\{handleFileSelect\} \/>\}/);
    expect(INDEX).toMatch(/<AtsCoverage variant="strip" \/>/);
  });

  it('keeps the "#upload" hash handling the old addresses rely on', () => {
    expect(INDEX).toMatch(/window\.location\.hash === '#upload'/);
  });

  it("keeps reading the scan report emails' outcome links", () => {
    expect(INDEX).toMatch(/params\.get\("outcome"\)/);
    expect(INDEX).toMatch(/params\.get\("rid"\)/);
  });
});
