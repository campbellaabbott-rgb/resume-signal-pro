import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { stripCoordinateSuffix } from "../../supabase/functions/job-board/normalize";

/**
 * A PLACE NAME IS NOT A LATITUDE.
 *
 * Some Greenhouse employers append the geocode to the location string, and
 * the card printed it: "BAYADA Home Health Care · Waipahu, HI 96797 |
 * 21.396369637 | -158.01142287". Measured 2026-08-24: 398 of 1,000 sampled
 * pipe-bearing servable locations carry the suffix, all Greenhouse.
 *
 * The interesting half of this fix is what it must NOT do. A pipe in a
 * location is usually real — "Latin & South America | Remote", "3 Locations |
 * PT-Orlando" — so the rule targets a trailing run of decimals with three or
 * more decimal places, never the separator. Those preservation cases are the
 * reason a blanket pipe-strip was rejected: it would have damaged 60% of the
 * rows it touched.
 *
 * Asserted on RETURN VALUES, not on the presence of a regex in source.
 */
describe("a place name is not a latitude", () => {
  it.each([
    ["Waipahu, HI 96797 | 21.396369637 | -158.01142287", "Waipahu, HI 96797"],
    ["Bradford, PA 16701 | 41.955844744 | -78.650981041", "Bradford, PA 16701"],
    ["Winston Salem, NC 27106 | 36.143432038 | -80.311782946", "Winston Salem, NC 27106"],
    ["Dover, DE 19901 | 39.154775745", "Dover, DE 19901"],
  ] as const)("strips the geocode from %s", (input, want) => {
    expect(stripCoordinateSuffix(input)).toBe(want);
  });

  it.each([
    // Every one of these is a real place string a reader needs intact.
    ["Latin & South America | Remote"],
    ["San Francisco, CA | New York City, NY"],
    ["3 Locations   |   PT-Orlando - South"],
    ["New York City, NY; San Francisco, CA | New York City, NY"],
    ["Remote"],
    // Numbers that are not coordinates must survive: a postcode has no
    // decimal point, and a suite number has too few decimal places.
    ["Springfield, IL 62704"],
    ["Building 7 | Suite 3.10"],
  ] as const)("leaves %s alone", (input) => {
    expect(stripCoordinateSuffix(input)).toBe(input.trim());
  });

  it("the stored rows are corrected by a migration with the same narrow rule", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const sql = readFileSync(resolve(dir, readdirSync(dir).find((f) => f.includes("a_place_name_is_not_a_latitude"))!), "utf8")
      .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(sql).toMatch(/UPDATE public\.job_board_postings/);
    expect(sql).toMatch(/regexp_replace\(/);
    // Scoped to the one vendor measured, and anchored to the end of the string.
    expect(sql).toMatch(/source = 'greenhouse'/);
    expect(sql).toMatch(/\$'\s*$|\\s\*\$'/m);
    // It must not strip pipes generally.
    expect(sql).not.toMatch(/replace\(location, '\|'/);
  });
});
