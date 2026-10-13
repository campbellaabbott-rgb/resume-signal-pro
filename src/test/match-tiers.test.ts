// @vitest-environment node
/**
 * GATES, TIERS AND ORDER (_shared/match-tiers.ts).
 *
 * Gates set rows aside, counted with the rows they were counted over; a
 * description-based gate applies only to rows that were read and only to a
 * reader who declared the fact; a row whose requirements were not read is
 * never Strong; years never gate; collapse and the employer cap never drop a
 * row; the set-aside line names its basis.
 */
import { describe, expect, it } from "vitest";
import {
  collapseAndCap, compareRows, declaredNotCitizen, freshnessBucket, gateFor, type PostingReqFacet, requisitionKey, type RowFacets,
  setAsideCounts, setAsideSummary, tierFor, type TierReader, TOP_N,
} from "../../supabase/functions/_shared/match-tiers";
import { readPostingLicence, type Licence } from "../../supabase/functions/_shared/licence-rules";

const LEVEL0 = { intern: false, aboveEntry: false, numeral: false, overreach: false, junior: false, assistant: false };
const facets = (over: Partial<RowFacets> = {}): RowFacets => ({
  place: { kind: "ring", label: "in your Columbus commute area (40 km)" }, titleRank: 0, previousField: false, level: { ...LEVEL0 },
  levelInQuery: false, assistantIsJunior: false, widenStep: 0, minYears: null, band: null, requirements: reqs(), rowStates: ["OH"],
  licenceStateNotStated: false, country: "US", ...over,
});
function reqs(over: Partial<PostingReqFacet> = {}): PostingReqFacet {
  return { minYears: null, licence: null, noSponsorship: null, citizenshipRequired: null, activeClearance: null, degree: null, must: [], ...over };
}
const reader = (over: Partial<TierReader> = {}): TierReader => ({
  level: "mid", years: { low: 5, high: 5 }, targetYears: null, careerChanger: false, student: false,
  workAuth: { status: "unknown", needsSponsorship: false, citizenOf: [], clearance: null }, licences: [], degree: "bachelor", ...over,
});

describe("gates", () => {
  it("place: outside the countries said, beyond the commute, place not stated, a licence in another state", () => {
    expect(gateFor(facets({ place: { kind: "outside_countries", country: "GB" } }), reader())).toEqual({ reason: "outside_countries", detail: "GB" });
    expect(gateFor(facets({ place: { kind: "beyond_commute" } }), reader())?.reason).toBe("beyond_commute");
    expect(gateFor(facets({ place: { kind: "place_not_stated" } }), reader())?.reason).toBe("place_not_stated");
    expect(gateFor(facets({ place: { kind: "licence_elsewhere", state: "CA" } }), reader())).toEqual({ reason: "licence_elsewhere", detail: "CA" });
  });

  it("occupation: a different job, and a career changer's previous field apart from it", () => {
    expect(gateFor(facets({ titleRank: 9 }), reader())?.reason).toBe("different_occupation");
    expect(gateFor(facets({ titleRank: 9, previousField: true }), reader())?.reason).toBe("previous_field");
    expect(gateFor(facets({ titleRank: 1, previousField: true }), reader())?.reason).toBe("previous_field");
  });

  it("level: entry readers are spared senior and II/III titles; mid readers staff/principal/director; senior readers junior ones", () => {
    expect(gateFor(facets({ level: { ...LEVEL0, aboveEntry: true } }), reader({ level: "entry" }))?.reason).toBe("level_above");
    expect(gateFor(facets({ level: { ...LEVEL0, numeral: true } }), reader({ level: "entry" }))?.reason).toBe("level_above");
    expect(gateFor(facets({ level: { ...LEVEL0, aboveEntry: true } }), reader({ level: "mid" }))).toBeNull();
    expect(gateFor(facets({ level: { ...LEVEL0, overreach: true } }), reader({ level: "mid" }))?.reason).toBe("level_above");
    expect(gateFor(facets({ level: { ...LEVEL0, junior: true } }), reader({ level: "senior" }))?.reason).toBe("level_below");
    expect(gateFor(facets({ level: { ...LEVEL0, assistant: true } }), reader({ level: "exec" }))).toBeNull();
    expect(gateFor(facets({ level: { ...LEVEL0, assistant: true }, assistantIsJunior: true }), reader({ level: "exec" }))?.reason).toBe("level_below");
    expect(gateFor(facets({ level: { ...LEVEL0, aboveEntry: true }, levelInQuery: true }), reader({ level: "entry" })), "the level is the job").toBeNull();
    expect(gateFor(facets({ level: { ...LEVEL0, intern: true } }), reader()))?.toEqual({ reason: "internship" });
    expect(gateFor(facets({ level: { ...LEVEL0, intern: true } }), reader({ student: true }))).toBeNull();
  });

  it("sponsorship gates only a reader who declared they need it; citizenship only one who declared they are not a citizen", () => {
    const f = facets({ requirements: reqs({ noSponsorship: "We do not sponsor visas", citizenshipRequired: "Must be a U.S. citizen" }) });
    expect(gateFor(f, reader())).toBeNull();
    expect(gateFor(f, reader({ workAuth: { status: "student_visa", needsSponsorship: true, citizenOf: [], clearance: null } }))?.reason).toBe("no_sponsorship");
    expect(gateFor(f, reader({ workAuth: { status: "permanent_resident", needsSponsorship: false, citizenOf: [], clearance: null } }))?.reason).toBe("citizenship_required");
    expect(gateFor(f, reader({ workAuth: { status: "citizen", needsSponsorship: false, citizenOf: ["US"], clearance: null } }))).toBeNull();
    expect(declaredNotCitizen(reader({ workAuth: { status: "citizen", needsSponsorship: false, citizenOf: ["GB"], clearance: null } }), "US")).toBe(true);
  });

  it("an active clearance gates a reader who listed none; a row that was not read gates on nothing from its description", () => {
    const f = facets({ requirements: reqs({ activeClearance: "Active Secret clearance required" }) });
    expect(gateFor(f, reader())?.reason).toBe("clearance_required");
    expect(gateFor(f, reader({ workAuth: { status: "citizen", needsSponsorship: false, citizenOf: ["US"], clearance: "secret" } }))).toBeNull();
    expect(gateFor(facets({ requirements: "not read" }), reader({ workAuth: { status: "student_visa", needsSponsorship: true, citizenOf: [], clearance: null } }))).toBeNull();
  });

  it("a missing licence is information until its family passes the audit: it keeps the row out of Strong, it never sets it aside", () => {
    const f = facets({ requirements: reqs({ licence: readPostingLicence("Current Ohio RN license required.") }) });
    expect(gateFor(f, reader())).toBeNull();
    expect(tierFor(f, reader()).tier).toBe("good");
  });

  it("years never gate", () => {
    expect(gateFor(facets({ minYears: 15 }), reader({ level: "entry" }))).toBeNull();
  });
});

describe("tiers", () => {
  it("Strong needs the requirements read, a core title, the years within reach and nothing else short", () => {
    expect(tierFor(facets(), reader()).tier).toBe("strong");
    expect(tierFor(facets({ requirements: "not read" }), reader())).toMatchObject({ tier: "good", notRead: true });
    expect(tierFor(facets({ titleRank: 1 }), reader()).tier).toBe("good");
    expect(tierFor(facets({ widenStep: 1 }), reader()).tier).toBe("good");
  });

  it("years: within high + 2 is fine, 1-2 beyond is Good, 3 or more beyond is Stretch; an entry reader is judged on 2", () => {
    expect(tierFor(facets({ minYears: 7 }), reader()).tier).toBe("strong");
    expect(tierFor(facets({ minYears: 8 }), reader()).tier).toBe("good");
    expect(tierFor(facets({ minYears: 10 }), reader()).tier).toBe("stretch");
    expect(tierFor(facets({ minYears: 2 }), reader({ level: "entry", years: { low: 0, high: 0 } })).tier).toBe("strong");
    expect(tierFor(facets({ minYears: 3 }), reader({ level: "entry", years: { low: 0, high: 0 } })).tier).toBe("good");
    expect(tierFor(facets({ minYears: 5 }), reader({ level: "entry", years: { low: 0, high: 0 } })).tier).toBe("stretch");
    expect(tierFor(facets({ minYears: 4 }), reader({ careerChanger: true, targetYears: 1, years: { low: 12, high: 12 } })).tier, "a career changer is judged on target-field years").toBe("good");
  });

  it("an entry reader against a senior band is a Stretch; two smaller gaps are a Stretch; unread plus one gap stays Good", () => {
    expect(tierFor(facets({ band: "senior" }), reader({ level: "entry" })).tier).toBe("stretch");
    expect(tierFor(facets({ titleRank: 1, widenStep: 1 }), reader()).tier).toBe("stretch");
    expect(tierFor(facets({ titleRank: 1, requirements: "not read" }), reader()).tier).toBe("good");
  });

  it("licences: met is Strong, a transfer is a Stretch, a pending transfer and an unstated state are Good", () => {
    const il: Licence[] = [{ kind: "rn", jurisdiction: "IL", compact: false, basis: "" }];
    const oh: Licence[] = [{ kind: "rn", jurisdiction: "OH", compact: false, basis: "" }];
    const need = reqs({ licence: readPostingLicence("Current Ohio RN license required.") });
    const needPending = reqs({ licence: readPostingLicence("Ohio RN license or eligible for licensure upon hire.") });
    expect(tierFor(facets({ requirements: need }), reader({ licences: oh })).tier).toBe("strong");
    expect(tierFor(facets({ requirements: need }), reader({ licences: il })).tier).toBe("stretch");
    expect(tierFor(facets({ requirements: needPending }), reader({ licences: il })).tier).toBe("good");
    expect(tierFor(facets({ licenceStateNotStated: true }), reader({ licences: oh })).tier).toBe("good");
  });

  it("a required line answered No keeps a row out of Strong; a degree one level below is a smaller gap", () => {
    const line = "Must have a forklift certification";
    expect(tierFor(facets({ requirements: reqs({ must: [line] }) }), reader({ answers: { [line]: "no" } })).tier).toBe("good");
    expect(tierFor(facets({ requirements: reqs({ must: [line] }) }), reader({ answers: { [line]: "skip" } })).tier).toBe("strong");
    expect(tierFor(facets({ requirements: reqs({ degree: { level: "master", must: true, quote: "Master's required" } }) }), reader()).tier).toBe("good");
    expect(tierFor(facets({ requirements: reqs({ degree: { level: "doctorate", must: true, quote: "PhD required" } }) }), reader()).tier).toBe("stretch");
  });
});

describe("order, collapse and caps", () => {
  it("within a tier: lane, then freshness by the employer's date, then openings, then keyword overlap, then the server's order", () => {
    const base = { tier: "good" as const, lane: "ring" as const, freshness: 1, openings: 1, overlap: null, serverOrder: 0 };
    expect(compareRows({ ...base, lane: "remote" }, base)).toBeGreaterThan(0);
    expect(compareRows({ ...base, freshness: 0 }, base)).toBeLessThan(0);
    expect(compareRows({ ...base, openings: 3 }, base)).toBeLessThan(0);
    expect(compareRows({ ...base, overlap: 5 }, { ...base, overlap: 2 })).toBeLessThan(0);
    expect(compareRows({ ...base, tier: "strong", lane: "country" }, base)).toBeLessThan(0);
  });

  it("freshness buckets 0-3, 4-7, 8-14, 15-30 days; a re-dating source and an undated row are unknown", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();
    expect([1, 5, 10, 20, 40].map((d) => freshnessBucket(ago(d), now))).toEqual([0, 1, 2, 3, 4]);
    expect(freshnessBucket(ago(1), now, true)).toBe(4);
    expect(freshnessBucket(null, now)).toBe(4);
  });

  it("siblings collapse into one row with N openings; Oracle sub-site copies of one requisition collapse; an employer holds at most 2 of the top 20, the rest move below, none dropped", () => {
    expect(requisitionKey("oracle:acme~us2~CX_1:7124")).toBe(requisitionKey("oracle:acme~us2~FR_SITE:7124"));
    const rows = [
      { id: "a1", employer: "acme", sibling: "acme|cashier|x", openings: 1 },
      { id: "a1b", employer: "acme", sibling: "acme|cashier|x", openings: 1 },
      { id: "oracle:acme~us2~CX_1:9", employer: "acme", sibling: "acme|clerk|y", openings: 1 },
      { id: "oracle:acme~us2~FR:9", employer: "acme", sibling: "acme|clerk|z", openings: 1 },
      { id: "a3", employer: "acme", sibling: "acme|stocker|q", openings: 1 },
      ...Array.from({ length: 25 }, (_, i) => ({ id: `o${i}`, employer: `co${i}`, sibling: `co${i}|cashier|x`, openings: 1 })),
    ];
    const out = collapseAndCap(rows);
    expect(out.find((r) => r.id === "a1")?.openings).toBe(2);
    expect(out.map((r) => r.id)).not.toContain("a1b");
    expect(out.map((r) => r.id)).not.toContain("oracle:acme~us2~FR:9");
    expect(out.slice(0, TOP_N).filter((r) => r.employer === "acme")).toHaveLength(2);
    expect(out.map((r) => r.id)).toContain("a3");
    expect(out.length).toBe(rows.length - 2);
  });
});

describe("the set-aside line names its basis", () => {
  it("place and title counts are over the postings found; description counts over the postings read", () => {
    const counts = setAsideCounts(
      [{ reason: "outside_countries" }, { reason: "outside_countries" }, { reason: "level_above" }, { reason: "no_sponsorship" }],
      { found: 60, read: 40 },
    );
    expect(counts.outside_countries).toEqual({ count: 2, basis: "of the 60 postings we found" });
    expect(counts.no_sponsorship).toEqual({ count: 1, basis: "of the 40 postings we read" });
    expect(setAsideSummary(counts, 40)).toBe("Set aside: 2 outside where you said you can work · 1 senior titles · of the 40 we read: 1 say they won't sponsor");
    expect(setAsideSummary({}, 0)).toBeNull();
  });
});
