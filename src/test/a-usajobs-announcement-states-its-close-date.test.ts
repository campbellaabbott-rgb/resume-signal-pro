/**
 * A USAJOBS ANNOUNCEMENT STATES ITS CLOSE DATE (XR-1, the interface half).
 *
 * An agency states the day its announcement closes, and the board kept no
 * place for it: a USAJOBS row stayed open until the feed stopped listing it,
 * however long ago the stated date passed. The ingest half (skip a row already
 * past its date, store the date, close stored rows on it) lives in index.ts and
 * is built in the core lane, which needs a field on the posting to carry the
 * date from the normaliser to the row. normalizeUsajobs now reads the agency's
 * ApplicationCloseDate into it, falling back to PositionEndDate. The API writes
 * both without a zone ("2026-11-24T23:59:59.9970"), so each check below compares
 * with the same runtime's own parse and holds in any time zone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { normalizeUsajobs, type JobPosting } from "../../supabase/functions/job-board/normalize";

const NORMALIZE = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/normalize.ts"), "utf8"));

describe("a posting has a place for the close date its employer states", () => {
  it("JobPosting declares an optional ISO closesAt that may be null", () => {
    const shape = /export interface JobPosting \{[\s\S]*?\n\}/.exec(NORMALIZE)?.[0] ?? "";
    expect(shape, "the JobPosting interface was not found in normalize.ts").toContain("applyUrl: string;");
    expect(shape, "JobPosting has no closesAt field for a stated close date").toMatch(/^\s*closesAt\?: string \| null;$/m);
  });

  it("a posting typed as JobPosting can carry a stated close date, or none", () => {
    // Without the field, this object literal fails the typecheck (an excess property).
    const stated: JobPosting = {
      id: "usajobs:usajobs:812345600", source: "usajobs", token: "usajobs", company: "Department of the Interior",
      title: "Hydrologist", location: "Denver, Colorado", remote: false, workMode: null, department: null,
      postedAt: "2026-11-01T00:00:00.000Z", category: "Science & Research" as JobPosting["category"], salary: null,
      applyUrl: "https://www.usajobs.gov/job/812345600", closesAt: "2026-11-21T00:00:00.000Z",
    };
    const unstated: JobPosting = { ...stated, closesAt: null };
    const { closesAt: _omit, ...absent } = stated;
    expect(stated.closesAt).toBe("2026-11-21T00:00:00.000Z");
    expect(unstated.closesAt).toBeNull();
    expect((absent as JobPosting).closesAt).toBeUndefined();
  });
});

describe("normalizeUsajobs reads the close date the agency states", () => {
  const item = (dates: Record<string, unknown>) => ({
    MatchedObjectId: "812345600",
    MatchedObjectDescriptor: {
      PositionID: "DOI-26-001", PositionTitle: "Hydrologist", OrganizationName: "U.S. Geological Survey",
      PositionLocation: [{ LocationName: "Denver, Colorado", CountryCode: "United States" }],
      PublicationStartDate: "2026-11-01T00:00:00.0000", ApplyURI: ["https://www.usajobs.gov:443/job/812345600"],
      ...dates,
    },
  });
  const read = (dates: Record<string, unknown>) => normalizeUsajobs([item(dates)] as never, "USAJOBS", "usajobs")[0];
  // The API's own shape: a local date-time with no zone, four fraction digits.
  const zoneless = (ms: number) => new Date(ms).toISOString().slice(0, 19) + ".9970";

  it("an ApplicationCloseDate of yesterday sets closesAt, and it is in the past", () => {
    const yesterday = zoneless(Date.now() - 86_400_000);
    const row = read({ ApplicationCloseDate: yesterday });
    expect(row.closesAt).toBe(new Date(yesterday).toISOString());
    expect(Date.parse(row.closesAt!)).toBeLessThan(Date.now());
  });

  it("the stated close date wins over the position's end date", () => {
    const close = "2026-11-24T23:59:59.9970", end = "2027-11-24T23:59:59.9970";
    expect(read({ ApplicationCloseDate: close, PositionEndDate: end }).closesAt).toBe(new Date(close).toISOString());
  });

  it("PositionEndDate stands in when the announcement names no close date, or one that does not parse", () => {
    const end = "2026-12-01T23:59:59.9970";
    expect(read({ PositionEndDate: end }).closesAt).toBe(new Date(end).toISOString());
    expect(read({ ApplicationCloseDate: "not a date", PositionEndDate: end }).closesAt).toBe(new Date(end).toISOString());
    expect(read({ ApplicationCloseDate: "" , PositionEndDate: end }).closesAt).toBe(new Date(end).toISOString());
  });

  it("an announcement that states neither carries closesAt null, and the rest of the row is unchanged", () => {
    const row = read({});
    expect(row.closesAt).toBeNull();
    expect(row.title).toBe("Hydrologist");
    expect(row.applyUrl).toBe("https://www.usajobs.gov:443/job/812345600");
    expect(row.country).toBe("US");
  });
});
