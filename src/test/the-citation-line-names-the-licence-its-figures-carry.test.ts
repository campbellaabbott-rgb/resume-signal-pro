// @vitest-environment node
/**
 * THE CITATION LINE NAMES THE LICENCE ITS FIGURES CARRY (SEO audit
 * 2026-11-18, GEO-6).
 *
 * The data pages' figures are published under CC BY 4.0, and that was said
 * only inside the Dataset markup: the visible "How to cite" lines on the data
 * pages and the benchmarks page, and the llms-full citation policy, did not
 * say it, so a person or an answer engine citing a figure was not told the
 * terms. Each now names the licence, linked, beside the citation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as seo from "../../scripts/prerender-seo.mjs";
import { codeOf } from "./helpers/strip-comments";

const S = seo as unknown as {
  citeLicenceHtml?: (licence: string | null) => string;
  citeLicenceText?: (licence: string | null) => string;
};
const CC = "https://creativecommons.org/licenses/by/4.0/";
const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));

describe("the licence words", () => {
  it("on a page: CC BY 4.0, linked to the licence as rel=license", () => {
    expect(typeof S.citeLicenceHtml).toBe("function");
    expect(S.citeLicenceHtml!(CC)).toBe(` Figures on this page: <a href="${CC}" rel="license">CC BY 4.0</a>.`);
  });

  it("in the llms-full policy: CC BY 4.0 with its address, the API's bulk data set apart", () => {
    const t = S.citeLicenceText!(CC);
    expect(t).toContain(`CC BY 4.0 (${CC})`);
    expect(t).toMatch(/Ghost Job Index/);
    expect(t).toMatch(/licensed separately/);
  });

  it("say nothing when no licence is set", () => {
    expect(S.citeLicenceHtml!(null)).toBe("");
    expect(S.citeLicenceText!(null)).toBe("");
  });
});

describe("where the bake prints them", () => {
  it("the data pages' and the benchmarks page's How to cite lines end with the licence", () => {
    const cites = [...code.matchAll(/<strong>How to cite:<\/strong>[^\n]*/g)].map((m) => m[0]);
    expect(cites.length).toBeGreaterThanOrEqual(2);
    for (const c of cites) expect(c, c.slice(0, 80)).toMatch(/\$\{citeLicenceHtml\(DATA_LICENSE\)\}<\/p>/);
  });

  it("the llms-full citation policy ends with the licence", () => {
    expect(code).toMatch(/Citation policy: [^\n]*\$\{citeLicenceText\(DATA_LICENSE\)\}`\);/);
  });

  it("the licence is the one the Dataset markup states", () => {
    expect(code).toMatch(/const DATA_LICENSE = "https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/";/);
    expect(code).toMatch(/license: DATA_LICENSE/);
  });
});
