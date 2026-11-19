/**
 * THE HOMEPAGE LINKS THE LARGEST FIELDS (CONTENT-N5, SEO audit 2026-11-18b).
 *
 * "/" links six field pages, and the six skipped the largest field on the
 * board: Operations & Logistics, 166,215 open roles on the field count the
 * bake printed on /explore on 2026-11-19, while Education, ninth at 13,492,
 * had a link. Education gives its place to Operations. React's rail and the
 * bake's "/" read the one list (src/lib/home/fields.ts), and each label is the
 * board's own name for the field, copied into the home shard.
 *
 * The counts below are that bake's, as printed (largest first); the rule is
 * that every field "/" links is among the seven largest on that count, and
 * the largest is one of them. On f1ea5e353 Operations is missing and
 * Education is linked.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HOME_FIELD_SLUGS, fieldPath, homeFields } from "@/lib/home/fields";
import { BOARD_CATEGORY_SLUGS } from "@/lib/job-board-categories";

/** /explore as baked on 2026-11-19: open roles per field. */
const FIELD_COUNTS_2026_11_19: ReadonlyArray<readonly [string, number]> = [
  ["operations", 166_215],
  ["healthcare", 153_250],
  ["engineering", 94_423],
  ["sales", 93_130],
  ["hospitality_retail", 88_009],
  ["customer", 49_149],
  ["finance", 43_317],
  ["marketing", 18_634],
  ["education", 13_492],
  ["people_hr", 12_281],
  ["data_ai", 11_363],
  ["science", 10_375],
  ["legal", 10_143],
  ["product", 9_694],
  ["security", 8_702],
  ["admin", 7_555],
  ["design", 4_656],
];

const ROOT = resolve(__dirname, "../..");

describe("the homepage's field links", () => {
  it("are six, and Operations & Logistics, the largest field, is one of them", () => {
    expect(HOME_FIELD_SLUGS).toHaveLength(6);
    expect(HOME_FIELD_SLUGS).toContain("operations");
    expect(HOME_FIELD_SLUGS).not.toContain("education");
    expect(homeFields()).toEqual([...HOME_FIELD_SLUGS]);
    expect(homeFields().map(fieldPath)).toContain("/jobs/field/operations");
  });

  it("each is among the seven largest fields on the 2026-11-19 count", () => {
    expect(FIELD_COUNTS_2026_11_19.map(([s]) => s).sort()).toEqual([...BOARD_CATEGORY_SLUGS].sort());
    const ranked = [...FIELD_COUNTS_2026_11_19].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    const top = new Set(ranked.slice(0, 7));
    for (const slug of HOME_FIELD_SLUGS) expect(top.has(slug), `${slug} is not among the seven largest`).toBe(true);
    expect(HOME_FIELD_SLUGS).toContain(ranked[0]);
  });

  it("every language labels Operations with the board's own name for it, and none keeps Education", () => {
    for (const lng of ["de", "en-GB", "en", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const home = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/home/${lng}.json`), "utf8")).home;
      const main = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${lng}.json`), "utf8"));
      expect(home.rail.fields.operations, lng).toBe(main.jobsPage.categories.operations);
      expect(home.rail.fields.education, lng).toBeUndefined();
    }
  });
});
