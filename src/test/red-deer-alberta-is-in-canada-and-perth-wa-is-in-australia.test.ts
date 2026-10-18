/**
 * RED DEER, ALBERTA IS IN CANADA, AND PERTH, WA IS IN AUSTRALIA (S12-037,
 * job-board .93, wave 4 round 2).
 *
 * Three residuals of the L7-14 country rules, each a live board row:
 *   - "Red Deer, AB, CA" (Finning): the trailing ", CA" was read as California
 *     because "Red Deer" is not in the city table, though the province code
 *     sits right before it;
 *   - "Perth, WA" (Westgold): the city table files Perth in Australia, but a
 *     trailing "WA" is also Washington, and the state won;
 *   - "IL - Tel Aviv" (Airwallex): the state-first reading refused IL because
 *     Tel Aviv is in Israel, and the short leading-code list then filed it
 *     US-IL anyway.
 * COUNTRY_MAP_VERSION moves to 10; the ingest re-derives a stored row's
 * country on the board's next read.
 */
import { describe, expect, it } from "vitest";
import { COUNTRY_MAP_VERSION, detectCountry, detectPlace, statedCountry } from "../../supabase/functions/job-board/normalize";

describe("country placement residuals (S12-037)", () => {
  it.each([
    ["Red Deer, AB, CA", "CA"],
    ["Fort McMurray, AB, CA", "CA"],
    ["Kamloops, BC, CA", "CA"],
    ["Moncton, New Brunswick, CA", "CA"],
    ["Perth, WA", "AU"],
    ["Perth, WA 6000", "AU"],
    ["Adelaide, SA", "AU"],
    ["IL - Tel Aviv", "IL"],
    ["IN - Bangalore", "IN"],
  ] as const)("%s is %s", (loc, want) => {
    expect(detectCountry(loc)).toBe(want);
  });

  it("the stated reading agrees, so a vendor's own AU or CA code is no longer refused", () => {
    expect(statedCountry("Perth, WA")).toBe("AU");
    expect(statedCountry("Red Deer, AB, CA")).toBe("CA");
    expect(detectPlace("Red Deer, AB, CA").country).toBe("CA");
  });

  it("positive control: the US readings these rules sit beside are unchanged", () => {
    expect(detectCountry("San Diego, CA")).toBe("US");
    expect(detectCountry("Los Angeles, CA, US")).toBe("US");
    expect(detectCountry("Seattle, WA")).toBe("US");
    expect(detectCountry("Spokane, WA")).toBe("US");
    expect(detectCountry("IL - Chicago")).toBe("US");
    expect(detectCountry("TX - Houston")).toBe("US");
    expect(detectCountry("SD, Aberdeen")).toBe("US");
    expect(COUNTRY_MAP_VERSION).toBe(10);
  });
});
