// @vitest-environment node
/**
 * POSTING REQUIREMENTS (_shared/posting-requirements.ts) AND LICENCE RULES
 * (_shared/licence-rules.ts).
 *
 * What a posting asks for is read with the sentence it came from (cut to 160
 * characters); "ability to obtain" a clearance is information, an active one a
 * requirement; a stored minimum of 16 or more is unknown and a re-read one
 * replaces it; the term walk equals fit-score's own (computeFit runs only
 * here, in a test, never in resume-match); a call walks at most six uncached
 * postings or 40,000 characters; and a licence gates only after a 57-of-60
 * audit, which no family has passed yet.
 */
import { describe, expect, it } from "vitest";
import { computeFit, scanResume } from "../../supabase/functions/_shared/fit-score";
import {
  effectiveMinYears, extractRequirements, MAX_UNCACHED_WALKS, MAX_WALK_CHARS, planTermWalks, postingTerms, readable, STALE_MIN_YEARS,
} from "../../supabase/functions/_shared/posting-requirements";
import {
  AUDIT_PASS, AUDITED_LICENCE_FAMILIES, licenceIsGate, licenceVerdict, NLC_PENDING, NLC_STATES, readPostingLicence, readResumeLicences, statesIn,
} from "../../supabase/functions/_shared/licence-rules";

const NURSE_POSTING = [
  "About us", "We are a hospital.",
  "Qualifications",
  "- Current Texas RN license or compact multistate license required",
  "- BLS and ACLS required within 30 days of hire",
  "- 2+ years of acute care experience",
  "- Bachelor's degree in Nursing (BSN) preferred",
  "- Must be 18 years of age or older",
  "- Bilingual Spanish preferred",
  "This position requires an active Secret clearance. Must be a U.S. citizen. Night shift. Valid driver's license. We do not sponsor visas.",
].join("\n");

describe("extractRequirements", () => {
  const r = extractRequirements(NURSE_POSTING);
  it("reads the minimum with the board's own age-guarded parser (an age is not experience)", () => {
    expect(r.minYears).toBe(2);
    expect(r.minYearsQuote).toMatch(/2\+ years of acute care/);
  });
  it("licence, jurisdiction and a compact accepted", () => {
    expect(r.licence).toMatchObject({ kind: "rn", jurisdictions: ["TX"], compactAccepted: true, pending: false });
  });
  it("sponsorship refusal, citizenship and an ACTIVE clearance, each quoted", () => {
    expect(r.noSponsorship).toBe("We do not sponsor visas");
    expect(r.citizenshipRequired).toBe("Must be a U.S. citizen");
    expect(r.activeClearance).toMatch(/active Secret clearance/);
    expect(r.clearanceObtainable).toBeNull();
  });
  it("'ability to obtain' a clearance is information, not an active requirement", () => {
    const o = extractRequirements("Analyst role in Arlington. Must have the ability to obtain a Secret clearance. Two years of experience with SQL required for this analyst role.");
    expect(o.activeClearance).toBeNull();
    expect(o.clearanceObtainable).toMatch(/ability to obtain/);
  });
  it("required and preferred lines follow the posting's headings and its own words; degree, language, shift, driving, credentials", () => {
    expect(r.must).toContain("Current Texas RN license or compact multistate license required");
    expect(r.nice).toContain("Bachelor's degree in Nursing (BSN) preferred");
    expect(r.degree).toMatchObject({ level: "bachelor", must: false });
    expect(r.languages).toEqual([expect.objectContaining({ language: "Spanish", must: false })]);
    expect(r.shift).toBe("Night shift");
    expect(r.driving?.quote).toBe("Valid driver's license");
    expect(r.credentials).toEqual(["BLS", "ACLS"]);
  });
  it("the lowest required degree is the bar; a preferred higher one is not", () => {
    expect(extractRequirements("Requirements\n- High school diploma or GED required\n- Bachelor's degree preferred\nWe train you on the register and the floor.").degree).toMatchObject({ level: "high_school", must: true });
    expect(extractRequirements("Requirements\n- B.S. in Computer Science or a related field\n- 3+ years of experience building web services").degree).toMatchObject({ level: "bachelor", must: true });
  });
  it("every quote is at most 160 characters", () => {
    const long = `Requirements\n- ${"Experience with distributed systems and cloud infrastructure at scale, ".repeat(6)}required\nWe do not sponsor visas ${"for any role in this team at this time ".repeat(5)}.`;
    const x = extractRequirements(long);
    for (const q of [...x.must, ...x.nice, x.noSponsorship ?? ""]) expect(q.length).toBeLessThanOrEqual(160);
  });
  it("a description of 150 characters or fewer is not readable (fit-batch's own line)", () => {
    expect(readable("x".repeat(150))).toBe(false);
    expect(readable("x".repeat(151))).toBe(true);
    expect(readable(null)).toBe(false);
  });
});

describe("the stored minimum", () => {
  it(`a stored value of ${STALE_MIN_YEARS} or more is unknown; a re-read replaces the stored one, null included`, () => {
    expect(effectiveMinYears(16, null)).toBeNull();
    expect(effectiveMinYears(18, "not read")).toBeNull();
    expect(effectiveMinYears(15, null)).toBe(15);
    expect(effectiveMinYears(3, null)).toBe(3);
    const reread = extractRequirements("Cashier. Must be at least 18 years of age. No experience required; we train you on the register, returns and the floor.");
    expect(reread.minYears).toBeNull();
    expect(effectiveMinYears(18, reread)).toBeNull();
    expect(effectiveMinYears(2, reread), "the text states none, so none").toBeNull();
    expect(effectiveMinYears(null, extractRequirements(NURSE_POSTING))).toBe(2);
  });
});

describe("posting terms: fit-score's walk, without computeFit", () => {
  const postings = [
    NURSE_POSTING,
    "Senior Software Engineer. Python, Kubernetes, AWS, PostgreSQL, React and TypeScript. CI/CD with GitHub Actions; on-call rotation; agile scrum team; REST APIs and microservices.",
    "Store Manager: P&L ownership, inventory management, merchandising, scheduling, hiring and training associates, loss prevention, customer service and visual merchandising standards.",
    "Financial Analyst - FP&A. Excel, SQL, budgeting, forecasting, variance analysis, financial modeling, NetSuite, Tableau, month-end close support and board reporting.",
  ];
  it("the same terms computeFit reads from the same posting (the parity the keyword overlap rests on)", () => {
    const scan = scanResume("x".repeat(120));
    for (const d of postings) {
      const f = computeFit(d, scan, 40);
      expect(new Set(postingTerms(d))).toEqual(new Set([...f.matched, ...f.missing]));
    }
  });
  it(`at most ${MAX_UNCACHED_WALKS} uncached walks or ${MAX_WALK_CHARS.toLocaleString("en-US")} characters, in display order`, () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, chars: 3000 }));
    expect(planTermWalks(rows)).toEqual({ walk: ["p0", "p1", "p2", "p3", "p4", "p5"], pending: ["p6", "p7", "p8", "p9"] });
    const big = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, chars: 25_000 }));
    expect(planTermWalks(big).walk, "each counts up to the 20,000 it is read to: two fit").toEqual(["b0", "b1"]);
  });
});

describe("licence rules", () => {
  it("no licence family is a gate until its extractor passes 57 of 60, and every audit names its day and score", () => {
    for (const a of AUDITED_LICENCE_FAMILIES) {
      expect(a.auditedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.of).toBeGreaterThanOrEqual(AUDIT_PASS.of);
      expect(a.correct / a.of).toBeGreaterThanOrEqual(AUDIT_PASS.correct / AUDIT_PASS.of);
    }
    expect(AUDITED_LICENCE_FAMILIES).toEqual([]);
    expect(licenceIsGate("rn")).toBe(false);
  });

  it("the compact list holds no pending state and no non-member", () => {
    for (const s of NLC_PENDING) expect(NLC_STATES.has(s)).toBe(false);
    for (const s of ["CA", "NY", "IL", "OR", "NV", "HI", "AK", "MN", "MI", "DC"]) expect(NLC_STATES.has(s), s).toBe(false);
    for (const s of ["AZ", "TX", "NM", "FL", "PA", "OH"]) expect(NLC_STATES.has(s), s).toBe(true);
  });

  it("verdicts: met in place, met by the compact, transfer elsewhere, met-pending when eligibility is accepted", () => {
    const az = readResumeLicences("Arizona RN license (multistate/compact), active.");
    const il = readResumeLicences("Illinois RN license (active).");
    expect(az).toEqual([expect.objectContaining({ kind: "rn", jurisdiction: "AZ", compact: true })]);
    const tx = readPostingLicence("Current Texas RN license required.")!;
    expect(licenceVerdict(az, tx)).toBe("met");
    expect(licenceVerdict(il, tx)).toBe("transfer");
    const txPending = readPostingLicence("Active Texas RN license or eligible for licensure upon hire.")!;
    expect(txPending.pending).toBe(true);
    expect(licenceVerdict(il, txPending)).toBe("transfer_pending");
    expect(licenceVerdict([], txPending)).toBe("met_pending");
    expect(licenceVerdict([], tx)).toBe("missing");
    expect(licenceVerdict(il, readPostingLicence("RN license required."))).toBe("met");
    expect(licenceVerdict(il, null)).toBe("not_asked");
    const ca = readPostingLicence("Current California RN license required.")!;
    expect(licenceVerdict(az, ca), "California is not a compact state").toBe("transfer");
  });

  it("an upper-case pair that is usually a word counts as a state only after a comma (OR is an operating room)", () => {
    expect(statesIn("OR nurse, day shift")).toEqual([]);
    expect(statesIn("Portland, OR")).toEqual(["OR"]);
    expect(statesIn("TX or NM")).toEqual(["TX", "NM"]);
    expect(statesIn("licensed in Texas")).toEqual(["TX"]);
  });
});
