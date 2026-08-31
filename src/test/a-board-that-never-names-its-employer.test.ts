import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adpBoardParams, normalizeAdp } from "../../supabase/functions/job-board/normalize";

/**
 * ADP WORKFORCE NOW JOINED AS THE EIGHTEENTH VENDOR, AND ITS PAYLOADS NEVER
 * NAME THE EMPLOYER.
 *
 * The career-center page is a JS shell, but the JSON it renders from is a
 * public endpoint on the same host — the page's own data channel, watched
 * live on 2026-08-31. Everything below is live-captured from real boards that
 * day (a fashion retailer's 82 postings, a Massachusetts school's 13, plus
 * two smaller centers): the list pages at a hard server cap of 20 rows, the
 * detail carrying the only full description, the share id the SPA's own URL
 * builder appends to deep links, and — measured across every channel we could
 * reach — no employer name anywhere. The catalog entry is the only thing that
 * names an adp board, which is the oracle situation and shapes the whole
 * census pipeline (names come from branding prose or nowhere).
 *
 * The vendor also re-runs two traps older vendors already paid for: an HTML
 * or reshaped body on a healthy HTTP 200 must be a FAILED fetch and never an
 * empty board (personio/rippling/paylocity), and a two-letter location tail
 * is a claim that needs interrogating before it becomes a country
 * (paylocity's Britain problem, plus the US-state/ISO-code collisions that
 * are this vendor's own).
 */

const root = resolve(__dirname, "../..");
// Comments are stripped before any structural pin, so a guard can only be
// satisfied by code that runs — a hazard well documented in a comment has
// falsified spelling-pinned guards in this repo four times.
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FN = codeOnly(readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8"));

const VINCE_TOKEN = "89da4960-4d45-4b46-b7aa-5959c5f71827";

// A live-captured list row, verbatim but for custom fields the adapter does
// not read (posting-date mirrors, feature toggles) trimmed away.
const SEASONAL_ITEM = {
  itemID: "9201236345403_1",
  requisitionTitle: "Seasonal Sales Associate",
  postDate: "2026-08-27T16:53:00.000-04:00",
  workLevelCode: { shortName: "Temporary/seasonal" },
  clientRequisitionID: "5051",
  requisitionLocations: [
    {
      address: { cityName: "San Francisco", countrySubdivisionLevel1: { codeValue: "CA" }, postalCode: "94108" },
      nameCode: { shortName: " San Francisco, CA, US" },
    },
  ],
  customFieldGroup: {
    stringFields: [
      { stringValue: "601833", nameCode: { codeValue: "ExternalJobID" } },
      { stringValue: "", nameCode: { codeValue: "HomeDepartment" } },
      { stringValue: "20 To 21 (USD) Hourly", nameCode: { codeValue: "SalaryRange" } },
    ],
    indicatorFields: [{ indicatorValue: false, nameCode: { codeValue: "InternalPostingFlag" } }],
    codeFields: [{ codeValue: "HR", shortName: "Hourly", nameCode: { codeValue: "SalaryType" } }],
  },
};

describe("a board that never names its employer", () => {
  it("ids are stable, and the apply link is the SPA's own share URL", () => {
    const [j] = normalizeAdp([SEASONAL_ITEM], "Vince", VINCE_TOKEN);
    expect(j.id).toBe(`adp:${VINCE_TOKEN}:9201236345403_1`);
    expect(j.source).toBe("adp");
    // The deep link carries the numeric share id the SPA itself appends —
    // confirmed against the app bundle's URL builder and Google-indexed
    // posting links — NOT the API's requisition id, which only the detail
    // endpoint understands.
    expect(j.applyUrl).toBe(
      `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${VINCE_TOKEN}&ccId=19000101_000001&lang=en_US&jobId=601833`,
    );
    // The feed's stated publish timestamp, offset and all, kept — the shared
    // 30-day ingest window does the age filtering, the adapter does none.
    expect(j.postedAt).toBe("2026-08-27T20:53:00.000Z");
    expect(j.title).toBe("Seasonal Sales Associate");
  });

  it("a posting marked internal-only never ships — its apply flow sits behind the employee login", () => {
    const internal = {
      ...SEASONAL_ITEM,
      customFieldGroup: {
        ...SEASONAL_ITEM.customFieldGroup,
        indicatorFields: [{ indicatorValue: true, nameCode: { codeValue: "InternalPostingFlag" } }],
      },
    };
    expect(normalizeAdp([internal], "x", VINCE_TOKEN)).toEqual([]);
    // The flag being merely PRESENT is not a conviction — 100 of 100 live
    // rows carried it as false and all of them are real public postings.
    expect(normalizeAdp([SEASONAL_ITEM], "x", VINCE_TOKEN)).toHaveLength(1);
  });

  it("an item without a requisition id is dropped, never shipped with a dangling id", () => {
    expect(normalizeAdp([{ ...SEASONAL_ITEM, itemID: undefined }], "x", VINCE_TOKEN)).toEqual([]);
  });

  it("the ccId is board identity, not routing — the compound token carries it into every URL", () => {
    // Measured live: one cid answered 19 postings on its default career
    // center and 1 on its second. Collapsing the two onto the cid would
    // serve one board's postings under the other's identity.
    expect(adpBoardParams("aaaa1111-2222-3333-4444-555566667777~9200080780705_2")).toEqual({
      cid: "aaaa1111-2222-3333-4444-555566667777",
      ccId: "9200080780705_2",
    });
    expect(adpBoardParams(VINCE_TOKEN).ccId).toBe("19000101_000001");
    const [j] = normalizeAdp([SEASONAL_ITEM], "x", "aaaa1111-2222-3333-4444-555566667777~9200080780705_2");
    expect(j.applyUrl).toContain("ccId=9200080780705_2");
  });

  it("a two-letter location tail is interrogated before it becomes a country", () => {
    const at = (shortName: string) =>
      normalizeAdp(
        [{ ...SEASONAL_ITEM, requisitionLocations: [{ nameCode: { shortName } }] }],
        "x",
        VINCE_TOKEN,
      )[0]?.country ?? null;
    // The measured three-segment shape — region then country — reads clean.
    expect(at(" Cluj-Napoca, CJ, RO")).toBe("RO");
    expect(at("Toronto, ON, CA")).toBe("CA");
    expect(at(" San Francisco, CA, US")).toBe("US");
    // The word people write for Britain that is not its ISO code — the same
    // trap normalizePaylocity documents, arriving here in the display tail.
    expect(at("REMOTE UK, GB")).toBe("GB");
    expect(at("London Office, UK")).toBe("GB");
    // The collision trap: a countryless city-plus-state tail is a US state,
    // not Canada/Georgia/India — it falls to detectCountry's state patterns.
    expect(at("San Francisco, CA")).toBe("US");
    expect(at("Atlanta, GA")).toBe("US");
  });

  it("salary is the employer's own display string, reshaped when it parses and untouched when it doesn't", () => {
    const [j] = normalizeAdp([SEASONAL_ITEM], "x", VINCE_TOKEN);
    expect(j.salary).toBe("USD 20–21 per hour");
    const cents = {
      ...SEASONAL_ITEM,
      customFieldGroup: {
        ...SEASONAL_ITEM.customFieldGroup,
        stringFields: [
          { stringValue: "601833", nameCode: { codeValue: "ExternalJobID" } },
          // Live-captured: fractional rates keep their cents, annual figures
          // drop the ".00" and gain grouping.
          { stringValue: "22.50 To 26.40 (USD) Hourly", nameCode: { codeValue: "SalaryRange" } },
        ],
      },
    };
    expect(normalizeAdp([cents], "x", VINCE_TOKEN)[0].salary).toBe("USD 22.50–26.40 per hour");
    const annual = {
      ...cents,
      customFieldGroup: {
        ...cents.customFieldGroup,
        stringFields: [{ stringValue: "70000.00 To 85000.00 (USD) Annually", nameCode: { codeValue: "SalaryRange" } }],
      },
    };
    expect(normalizeAdp([annual], "x", VINCE_TOKEN)[0].salary).toBe("USD 70,000–85,000 per year");
    // An employer who typed prose instead of a range keeps their own words —
    // it is their public display string either way.
    const prose = {
      ...cents,
      customFieldGroup: {
        ...cents.customFieldGroup,
        stringFields: [{ stringValue: "Competitive, DOE", nameCode: { codeValue: "SalaryRange" } }],
      },
    };
    expect(normalizeAdp([prose], "x", VINCE_TOKEN)[0].salary).toBe("Competitive, DOE");
    // No display string, no salary — payGradeRange rides the payload on rows
    // whose display string is absent, and mining it would publish figures the
    // employer's own career site does not show.
    const none = { ...cents, customFieldGroup: { ...cents.customFieldGroup, stringFields: [] } };
    expect(normalizeAdp([none], "x", VINCE_TOKEN)[0].salary).toBeNull();
  });

  it("employment type maps the client-authored work level through the shared mapper, or stays null", () => {
    const at = (shortName: string | undefined) =>
      normalizeAdp([{ ...SEASONAL_ITEM, workLevelCode: shortName === undefined ? undefined : { shortName } }], "x", VINCE_TOKEN)[0]
        .employmentType ?? null;
    // All values below were measured live across the 100-row capture.
    expect(at("Temporary/seasonal")).toBe("temporary");
    expect(at("Part-Time Hourly")).toBe("part_time");
    expect(at("Full Time Employee")).toBe("full_time");
    expect(at("Full-Time Salary")).toBe("full_time");
    // A label the shared mapper doesn't recognize states nothing — null, and
    // the UI shows nothing, per the trinary-or-nothing contract.
    expect(at("On-Call")).toBeNull();
    expect(at(undefined)).toBeNull();
  });

  it("work mode is never invented — no structured field exists, so text detection or nothing", () => {
    const [j] = normalizeAdp([SEASONAL_ITEM], "x", VINCE_TOKEN);
    expect(j.workMode).toBeNull();
    const remote = normalizeAdp(
      [{ ...SEASONAL_ITEM, requisitionLocations: [{ nameCode: { shortName: "REMOTE US, Cambridge, MA, US" } }] }],
      "x",
      VINCE_TOKEN,
    )[0];
    expect(remote.workMode).toBe("remote");
  });

  it("a 200 whose body is not the requisition envelope is a FAILED fetch, never an empty board", () => {
    // The personio/rippling/paylocity line, structural: page 0 of the walk
    // throws on an unrecognized shape, so the prune never sees a bot-wall or
    // a reshaped payload as an employer with nothing open.
    expect(FN).toMatch(/if \(pages\[i\] === 0\) throw new Error\("adp payload shape unrecognized"\);/);
    // And the workday/oracle/icims guard rides along: an empty read against a
    // non-zero advertised total is a refusal, not an empty board.
    expect(FN).toMatch(/if \(all\.length === 0 && feedTotal > 0\) throw new Error\(`empty page but total=\$\{feedTotal\}`\);\s*\n\s*return \{ items: all, raw: \{ jobRequisitions: all \}, windowed: !exhausted, feedTotal \};/);
  });

  it("windowing is honest — false only when the feed itself ran out", () => {
    expect(FN).toMatch(/if \(reqs\.length < ADP_PAGE\) \{ exhausted = true; break outer; \}/);
  });

  it("is registered in the vendor dispatch", () => {
    expect(FN).toMatch(/if \(s\.source === "adp"\) \{/);
    expect(FN).toMatch(/normalizeAdp\(items as never, s\.name, s\.token\)/);
  });
});
