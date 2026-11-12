// @vitest-environment node
/**
 * A COUNTRY WORD INSIDE ANOTHER PLACE IS NOT THAT COUNTRY (S13-041).
 *
 * The connector's readQuery read the place after "in" with toCode, which
 * takes any country word it contains: "medical interpreter in Spanish"
 * searched Spain (ES is also "spanish"), "in Latin America" the US, "in New
 * South Wales" the UK, "in Northern Ireland" Ireland, and "in New Mexico"
 * Mexico. Each one filtered the right postings out.
 *
 * Now a country word counts only as a whole word that names the country:
 * never a language ("Spanish", "French Camp"), never inside a "New ..." place
 * named after it, never in a compass America (a continent); "Northern
 * Ireland" is the UK's, and two countries read as none. Measured over 1,115
 * places (every alias, compass forms, named places, and 806 parts of the
 * board's own location strings labelled with the country the board placed
 * them in): main read a wrong country 32 times, this rule 2 (both US towns
 * main also misread), and never worse case by case (n1418).
 */
import { describe, expect, it } from "vitest";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { countryMentions } from "../../supabase/functions/_shared/work-countries";

const country = (q: string) => readQuery(q).country ?? null;

describe("the reviewer's four, and their kin", () => {
  it.each([
    ["medical interpreter in Spanish", null],
    ["teacher in French", null],
    ["analyst in Latin America", null],
    ["sales in South America", null],
    ["nurse in New South Wales", null],
    ["nurse in New Mexico", null],
    ["engineer in New England", null],
    ["nurse in Northern Ireland", "GB"],
    ["warehouse in French Camp", null],
    ["engineer in UK or Ireland", null],
  ])("%s -> %s", (q, want) => expect(country(q)).toBe(want));
});

describe("a country still reads as itself", () => {
  it.each([
    ["nurse in Spain", "ES"], ["nurse in southern Spain", "ES"], ["engineer in Western Australia", "AU"],
    ["nurse in South Wales", "GB"], ["engineer in South Africa", "ZA"], ["engineer in South Korea", "KR"],
    ["developer in New Delhi India", "IN"], ["analyst in the Netherlands", "NL"],
    ["nurse in Republic of Ireland", "IE"], ["nurse in Central Ireland", "IE"], ["engineer in Remote US", "US"],
    ["engineer in India - Bengaluru", "IN"], ["engineer in New Zealand", "NZ"], ["cook in Rural America", "US"],
  ])("%s -> %s", (q, want) => expect(country(q)).toBe(want));
});

describe("countryMentions: whole words, with the words before", () => {
  it("a city named after its country's word is that city, not the whole country (connect W1, BR-02)", () => {
    expect(readQuery("analyst in Mexico City")).toMatchObject({ query: "analyst", location: "Mexico City" });
    expect(readQuery("analyst in Mexico City").country).toBeUndefined();
  });

  it("reads a phrase the way the connector needs", () => {
    expect(countryMentions("New South Wales")).toEqual([{ code: "GB", alias: "wales", before: "new south" }]);
    expect(countryMentions("Spanish")).toEqual([{ code: "ES", alias: "spanish", before: "" }]);
    expect(countryMentions("industry customer")).toEqual([]);
  });
});
