// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as normalize from "../../supabase/functions/job-board/normalize";
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";
import { codeOf } from "./helpers/strip-comments";

/**
 * FEDERAL POSTINGS WERE STORED WITH NO BODY, NO TELEWORK, NO PAY PERIOD, AND
 * ALWAYS IN THE US.
 *
 * Sweeps S8-023 and S8-083 (2026-10-08), both live since USAJOBS rows began
 * landing in .89. Measured on .91: descCoverage usajobs 7,927 total, 0
 * described; 60 sampled rows had work mode null 60/60 and salaryPeriod null
 * 60/60; `{vendor:["usajobs"], location:"Germany"}` returned 107 rows, every
 * one stored country US, and country DE returned none.
 *
 *  - The API puts JobSummary, MajorDuties, TeleworkEligible and
 *    RemoteIndicator under UserArea.Details (developer.usajobs.gov's search
 *    reference); the normaliser read the two telework fields at the top level
 *    and no ingest branch read a body at all.
 *  - PositionRemuneration carries RateIntervalCode ("PA", "PH") and the salary
 *    text dropped it: "$42 - $49" with no period.
 *  - country was the literal "US"; PositionLocation[].CountryCode names the
 *    country ("Germany").
 */
const item = (over: Record<string, unknown> = {}, details: Record<string, unknown> = {}) => ({
  MatchedObjectId: "21947200",
  MatchedObjectDescriptor: {
    PositionID: "SW62210-05",
    PositionTitle: "IT SPECIALIST (INFOSEC/NETWORK)",
    PositionURI: "https://www.usajobs.gov/GetJob/ViewDetails/21947200",
    ApplyURI: ["https://www.usajobs.gov/GetJob/ViewDetails/21947200?PostingChannelID=RESTAPI"],
    PositionLocationDisplay: "Point Loma Complex, San Diego, California",
    PositionLocation: [{ LocationName: "San Diego, California", CountryCode: "United States" }],
    OrganizationName: "Space and Naval Warfare Systems Command",
    DepartmentName: "Department of the Navy",
    JobCategory: [{ Name: "Information Technology Management" }],
    PositionSchedule: [{ Name: "Full-time" }],
    QualificationSummary: "You must have one year of specialized experience at the GS-11 level.",
    PositionRemuneration: [{ MinimumRange: "88520.0", MaximumRange: "115079.0", RateIntervalCode: "PA", Description: "Per Year" }],
    PublicationStartDate: "2026-10-01T00:00:00Z",
    UserArea: {
      Details: {
        JobSummary: "This position is located in the Cyber Security Division.",
        MajorDuties: ["Administers network security tools.", "Leads incident response."],
        TeleworkEligible: true,
        RemoteIndicator: false,
        ...details,
      },
    },
    ...over,
  },
});
const one = (it: ReturnType<typeof item>) => normalize.normalizeUsajobs([it as never], "USAJOBS", "usajobs")[0] as unknown as Record<string, unknown>;

describe("a federal posting carries what the API states", () => {
  it("telework read from UserArea.Details: eligible is hybrid, remote is remote, both stated false is on-site", () => {
    expect(one(item()).workMode).toBe("hybrid");
    expect(one(item({}, { RemoteIndicator: true })).workMode).toBe("remote");
    expect(one(item({}, { TeleworkEligible: false, RemoteIndicator: false })).workMode).toBe("onsite");
  });

  it("the pay names its period, and the stored period follows from it", () => {
    const yearly = one(item()).salary as string;
    expect(yearly).toBe("$88,520 - $115,079 per year");
    expect(parseSalaryStructured(yearly, "US")?.period).toBe("year");
    const hourly = one(item({ PositionRemuneration: [{ MinimumRange: "42.31", MaximumRange: "49.12", RateIntervalCode: "PH", Description: "Per Hour" }] })).salary as string;
    expect(hourly).toBe("$42.31 - $49.12 per hour");
    expect(parseSalaryStructured(hourly, "US")?.period).toBe("hour");
    expect(one(item({ PositionRemuneration: [{ MinimumRange: "0", MaximumRange: "0", RateIntervalCode: "WC" }] })).salary).toBeNull();
  });

  it("an overseas post is stored in its own country, a domestic one in the US", () => {
    const de = one(item({ PositionLocation: [{ LocationName: "Ramstein AB, Germany", CountryCode: "Germany" }], PositionLocationDisplay: "Ramstein AB, Germany" }));
    expect(de.country).toBe("DE");
    const jp = one(item({ PositionLocation: [{ LocationName: "Yokosuka, Japan", CountryCode: "Japan" }] }));
    expect(jp.country).toBe("JP");
    expect(one(item()).country).toBe("US");
    expect(one(item({ PositionLocation: [{ LocationName: "Multiple Locations" }], PositionLocationDisplay: "Multiple Locations" })).country).toBe("US");
  });

  it("the posting body is the summary, the duties and the qualifications, keyed like the row", () => {
    const fn = (normalize as Record<string, unknown>).usajobsDescriptions as ((items: unknown, token: string) => Map<string, string>) | undefined;
    expect(fn, "nothing reads a federal posting's body").toBeTypeOf("function");
    const map = fn!([item()], "usajobs");
    const text = map.get(String(one(item()).id));
    expect(text).toContain("Cyber Security Division");
    expect(text).toContain("Leads incident response.");
    expect(text).toContain("specialized experience at the GS-11 level");
  });

  it("the ingest stores that body for usajobs rows", () => {
    const CODE = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8"));
    expect(CODE).toMatch(/\} else if \(s\.source === "usajobs"\) \{\s*for \(const \[k, v\] of usajobsDescriptions\(\(r\.raw as \{ items\?: unknown\[\] \}\)\.items, s\.token\)\) descs\.set\(k, v\.slice\(0, STORED_DESC_CAP\)\);/);
  });
});
