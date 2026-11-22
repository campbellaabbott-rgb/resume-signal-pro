/**
 * THE DATA PAGES NAME THE LICENCE THEIR FIGURES ARE OFFERED UNDER (SEO-F24).
 *
 * The Dataset markup on /ghost-job-index, /hiring-trends,
 * /pay-transparency-index, /explore and the score benchmark study named no
 * licence, so a reader (or a dataset search) could not tell whether the
 * figures may be reused. The owner's option is CC BY 4.0, for the aggregate
 * figures only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BAKE = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
const CODE = BAKE.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("the data pages' licence", () => {
  it("is CC BY 4.0, by its canonical URL", () => {
    expect(CODE).toMatch(/const DATA_LICENSE = "https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/";/);
  });
  it("rides every Dataset the bake writes: the four data pages' and the study's", () => {
    const spread = "...(DATA_LICENSE ? { license: DATA_LICENSE } : {}),";
    expect(CODE.split(spread).length - 1).toBe(2);
    const ld = CODE.slice(CODE.indexOf("const datasetLd = ("), CODE.indexOf("});", CODE.indexOf("const datasetLd = (")));
    expect(ld).toContain(spread);
  });
});
