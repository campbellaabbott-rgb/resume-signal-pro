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
import { GAP_LABEL, readerYears, REQUIREMENTS_NOT_READ } from "../../supabase/functions/_shared/match-tiers";
import { effectiveMinYears, extractRequirements } from "../../supabase/functions/_shared/posting-requirements";
import { familyByKey, levelFacets } from "../../supabase/functions/_shared/title-families";

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
    // Where the level is the job, the family's own noun is left out when the facets are read (levelFacets(title, family)),
    // so a facet that still says aboveEntry is a real seniority word and gates like any other.
    expect(gateFor(facets({ level: levelFacets("Store Manager", familyByKey("store_manager")!), levelInQuery: true }), reader({ level: "entry" })), "the level is the job").toBeNull();
    expect(gateFor(facets({ level: { ...LEVEL0, aboveEntry: true }, levelInQuery: true }), reader({ level: "entry" }))?.reason).toBe("level_above");
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

// ---------------------------------------------------------------------------
// The fixer's round (review of rm/integration 7af55e52). Each block failed on
// that commit.
// ---------------------------------------------------------------------------
const PAD = "\nThe team supports month-end close, reconciliations and reporting for a growing business across several offices and entities.";

describe("an unread row carries its label wherever it is tiered", () => {
  it("tierFor adds 'requirements not read' after the tier is set, so the label is never counted as a gap", () => {
    expect(tierFor(facets({ requirements: "not read" }), reader())).toMatchObject({ tier: "good", gaps: [REQUIREMENTS_NOT_READ] });
    expect(tierFor(facets({ requirements: "not read", titleRank: 1 }), reader())).toMatchObject({ tier: "good", gaps: [GAP_LABEL.nearTitle, REQUIREMENTS_NOT_READ] });
    expect(tierFor(facets(), reader()).gaps).not.toContain(REQUIREMENTS_NOT_READ);
  });
});

describe("a requirement read but not compared is never a Strong", () => {
  it("a stated minimum with the reader's years unknown is a smaller gap", () => {
    expect(tierFor(facets({ minYears: 5 }), reader({ years: null }))).toMatchObject({ tier: "good", gaps: ["asks 5+ years; we could not read yours"] });
  });
  it("a required degree with none on the résumé is a smaller gap; a preferred one is no gap", () => {
    const must = reqs({ degree: { level: "bachelor", must: true, quote: "Bachelor's degree required" } });
    expect(tierFor(facets({ requirements: must }), reader({ degree: null }))).toMatchObject({ tier: "good", gaps: ["asks for a bachelor's degree; none on your résumé"] });
    const nice = reqs({ degree: { level: "bachelor", must: false, quote: "Bachelor's degree preferred" } });
    expect(tierFor(facets({ requirements: nice }), reader({ degree: null })).tier).toBe("strong");
  });
  it("the reviewer's probe: 5 years and a bachelor's both required, a mid reader with neither read is never Strong", () => {
    const q = extractRequirements(`Bachelor's degree in Accounting required.\nMinimum of 5 years of accounting experience required.${PAD}`);
    expect(q.minYears).toBe(5);
    const f = facets({ requirements: q, minYears: effectiveMinYears(null, q) });
    expect(gateFor(f, reader({ years: null, degree: null }))).toBeNull();
    expect(tierFor(f, reader({ years: null, degree: null })).tier).toBe("stretch");
  });
  it("a career changer whose years in the new field are unknown is judged on no years at all, never on the old career's", () => {
    expect(readerYears(reader({ careerChanger: true, targetYears: null, years: { low: 12, high: 12 } }))).toBeNull();
    expect(tierFor(facets({ minYears: 5 }), reader({ careerChanger: true, targetYears: null, years: { low: 12, high: 12 } })).tier).toBe("good");
  });
});

describe("levels in a family whose level is the job: only the family's own noun is exempt", () => {
  const g = (title: string, key: string, level: TierReader["level"]) =>
    gateFor(facets({ level: levelFacets(title, familyByKey(key)!), levelInQuery: true }), reader({ level }))?.reason ?? null;
  it("Director, VP and Principal are above a mid reader; Senior is above an entry reader; the bare title is neither", () => {
    for (const t of ["Director of Product Management", "VP, Product Management", "Principal Product Manager"]) {
      expect(g(t, "product_manager", "mid"), t).toBe("level_above");
      expect(g(t, "product_manager", "entry"), t).toBe("level_above");
    }
    expect(g("Senior Marketing Manager", "marketing_manager", "entry")).toBe("level_above");
    expect(g("Senior Product Manager", "product_manager", "mid")).toBeNull();
    expect(g("Product Manager", "product_manager", "entry")).toBeNull();
    expect(g("Store Manager", "store_manager", "entry")).toBeNull();
    expect(g("Staff Software Engineer", "swe_staff", "mid")).toBeNull();
    expect(g("Principal Software Engineer", "swe_staff", "mid")).toBe("level_above");
  });
});

describe("a clearance is held, not held, or never sent", () => {
  const f = facets({ requirements: reqs({ activeClearance: "Active Secret clearance required" }) });
  it("a held clearance read as a licence counts as held", () => {
    expect(gateFor(f, reader({ licences: [{ kind: "clearance", jurisdiction: null, compact: false, grade: "secret", basis: "" }] }))).toBeNull();
  });
  it("a reader whose clearance was never sent is not set aside: the row carries a smaller gap the device resolves", () => {
    const unsent = reader({ workAuth: { status: "unknown", needsSponsorship: false, citizenOf: [], clearance: null, clearanceKnown: false } });
    expect(gateFor(f, unsent)).toBeNull();
    expect(tierFor(f, unsent)).toMatchObject({ tier: "good", gaps: [GAP_LABEL.clearanceNotSent] });
    expect(gateFor(f, reader())?.reason, "a reader known to hold none is still set aside").toBe("clearance_required");
  });
});

describe("a posting that accepts permanent residents", () => {
  const f = facets({ requirements: reqs({ citizenOrResident: "Must be a US citizen or permanent resident" }) });
  const wa = (status: string, needsSponsorship = false) => reader({ workAuth: { status, needsSponsorship, citizenOf: [], clearance: null } });
  it("sets aside only work-visa and student-visa readers", () => {
    expect(gateFor(f, wa("permanent_resident"))).toBeNull();
    expect(gateFor(f, wa("unknown"))).toBeNull();
    expect(gateFor(f, wa("work_visa", true))?.reason).toBe("citizen_or_resident_required");
    expect(gateFor(f, wa("student_visa", true))?.reason).toBe("citizen_or_resident_required");
  });
});
