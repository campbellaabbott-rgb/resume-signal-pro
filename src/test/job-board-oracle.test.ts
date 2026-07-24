// Oracle Recruiting Cloud normalizer, tested against a REAL payload captured
// from DTCC's and Fortinet's public CE REST API on 2026-07-24
// (ebxr/edel .fa.us2.oraclecloud.com — recruitingCEJobRequisitions).
import { describe, it, expect } from "vitest";
import { normalizeOracle } from "../../supabase/functions/job-board/normalize";

// Verbatim field shape from the live feed.
const REAL = [
  {
    Id: 210470,
    Title: "Lead QA Automation Engineer (Java/Selenium)",
    PostedDate: "2026-07-24",
    PrimaryLocation: "Tampa, FL, United States",
    PrimaryLocationCountry: "US",
    WorkplaceTypeCode: null,
    JobFamily: null,
  },
  {
    Id: 210471,
    Title: "Senior Data Engineer",
    PostedDate: "2026-07-20",
    PrimaryLocation: "Remote",
    PrimaryLocationCountry: "US",
    WorkplaceTypeCode: "REMOTE",
    JobFamily: "Technology",
  },
];

describe("normalizeOracle", () => {
  it("maps a real requisition to a board posting", () => {
    const jobs = normalizeOracle(REAL as never, "DTCC", "ebxr~us2~CX_1");
    expect(jobs).toHaveLength(2);
    const j = jobs[0];
    expect(j.id).toBe("oracle:ebxr~us2~CX_1:210470");
    expect(j.source).toBe("oracle");
    expect(j.company).toBe("DTCC");
    expect(j.title).toBe("Lead QA Automation Engineer (Java/Selenium)");
    expect(j.location).toBe("Tampa, FL, United States");
    expect(j.country).toBe("US");
    // The employer states a real calendar date — unlike Workday's relative age.
    expect(j.postedAt).toBe("2026-07-24T00:00:00.000Z");
    expect(j.applyUrl).toBe(
      "https://ebxr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/210470",
    );
  });

  it("honors the employer's structured workplace type over text inference", () => {
    const jobs = normalizeOracle(REAL as never, "DTCC", "ebxr~us2~CX_1");
    expect(jobs[1].workMode).toBe("remote");
    expect(jobs[1].remote).toBe(true);
    expect(jobs[1].department).toBe("Technology");
  });

  it("never invents a salary — ORC's list payload has no compensation", () => {
    for (const j of normalizeOracle(REAL as never, "DTCC", "ebxr~us2~CX_1")) {
      expect(j.salary).toBeNull();
    }
  });

  it("drops rows with no id or no title rather than emitting a dead apply link", () => {
    const bad = [
      { Id: "", Title: "Ghost Role", PostedDate: "2026-07-24" },
      { Id: 5, Title: "", PostedDate: "2026-07-24" },
    ];
    expect(normalizeOracle(bad as never, "DTCC", "ebxr~us2~CX_1")).toEqual([]);
  });

  it("leaves postedAt null when the feed states no usable date", () => {
    const undated = [{ Id: 9, Title: "Analyst", PostedDate: null, PrimaryLocation: "Austin, TX" }];
    expect(normalizeOracle(undated as never, "DTCC", "ebxr~us2~CX_1")[0].postedAt).toBeNull();
  });

  it("returns nothing for a malformed token or non-array payload", () => {
    expect(normalizeOracle(REAL as never, "DTCC", "ebxr")).toEqual([]);
    expect(normalizeOracle({} as never, "DTCC", "ebxr~us2~CX_1")).toEqual([]);
  });
});
