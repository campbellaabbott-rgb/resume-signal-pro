// @vitest-environment node
/**
 * AN INTERNAL-ONLY POSTING OR A PAID-SURVEY AD GETS NO JOB MARKUP (SEO check
 * 2026-11-15, F02 and the screen half of F03).
 *
 * /jobs/posting/greenhouse/coupanginternal/8287892 was indexable, in the
 * sitemap and marked up as a JobPosting whose hiringOrganization was "Coupang
 * Internal", while its own text said "This posting is exclusively for internal
 * employees" and asked applicants to submit a form from their Coupang email
 * address. Google's policy refuses a posting with no way to apply, with a
 * manual action as the penalty. The catalogue holds 44 such boards, and no
 * rule anywhere knew the case. The Lever board usasurveyjob, whose 1,571
 * postings are paid-survey ads sending applicants to an affiliate tracker,
 * had a company page, and nothing stopped a posting page being picked from it
 * (Google's policy names advertisements disguised as job postings).
 *
 * The screen is in scripts/prerender-posting-rule.mjs: the board
 * (internalBoardReason and PAID_SURVEY_AD_BOARDS, asked by rule 1, so the bake
 * retires a carried page to its noindex stub and never picks a new one) and
 * the posting's own words (internalOnlyTextReason and paidSurveyAdReason,
 * asked by postingMarkupGate, so neither the bake nor the React page nor the
 * board's detail pane writes markup for it, on any board).
 *
 * CORPUS FIRST (src/test/fixtures/posting-selection-screen-2026-11-15.json).
 * Every internal board in the catalogue is caught and every board carrying the
 * same words that is open to everyone is not; over the catalogue as this
 * branch holds it, the screen catches exactly the labelled boards. Every
 * recorded internal-only posting and survey ad is caught, and none of 330 real
 * public postings is: the 208 marked-up pages the live site served on
 * 2026-11-15, the hardest board rows of the free-scan corpora (internal
 * applicants, current employees, surveys and focus groups as work), and public
 * Brazilian postings.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAID_SURVEY_AD_BOARDS, internalBoardReason, internalOnlyTextReason, paidSurveyAdReason, postingRowEligible } from "../../scripts/prerender-posting-rule.mjs";
import { bakePostingPage } from "../../scripts/prerender-seo.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import { postingJsonLdShape, type PostingRow } from "@/components/jobs/posting-page";
import { CATALOG } from "./helpers/catalog";

type Board = { source: string; token: string; name: string; kind?: string };
type Posting = { id: string; title: string; company?: string | null; description: string; from?: string; board?: string | null };
const FIX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/posting-selection-screen-2026-11-15.json"), "utf8")) as {
  catalogue: { internal: Board[]; public: Board[] };
  internalOnly: Posting[];
  surveyAds: Posting[];
  public: Posting[];
};

const D = { ...companyDisplay, ...postingPage };
const SITE = "https://resumebooster.work";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const DESC = "Join the team running the work this posting describes, with the duties, the hours and the requirements the employer set out in full. ".repeat(4);
const textOf = (p: Posting) => `${p.title}\n${p.description}`;

/** The Coupang Internal row as the live page carried it on 2026-11-15 (title, employer, place from its served markup). */
const coupang = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "greenhouse:coupanginternal:8287892",
  title: "Principal, Real Estate [L6-II]",
  company: "Coupang Internal",
  token: "coupanginternal",
  source: "greenhouse",
  location: "Seoul, South Korea",
  country: "KR",
  workMode: null,
  postedAt: ago(3),
  missingSince: null,
  applyUrl: "https://job-boards.greenhouse.io/coupanginternal/jobs/8287892",
  salary: null,
  agency: false,
  ...over,
});
/** A public board's row: the positive control, and the board the text cases run on. */
const open = (over: Partial<PostingRow> = {}): PostingRow => coupang({
  id: "greenhouse:acmefoods:5550001",
  title: "Farm Operations Supervisor",
  company: "Acme Foods",
  token: "acmefoods",
  location: "Springfield, MO",
  country: "US",
  applyUrl: "https://job-boards.greenhouse.io/acmefoods/jobs/5550001",
  ...over,
});
const vitalFarms = FIX.internalOnly.find((p) => p.id.startsWith("greenhouse:vitalfarmsinternalcrew:"))!;

describe("the corpus: every internal board in the catalogue, and none open to everyone", () => {
  it("holds the boards the report named and the three kinds it asked for", () => {
    const tokens = FIX.catalogue.internal.map((b) => b.token);
    for (const t of ["coupanginternal", "charliehealthinternalcandidates", "homechefinternalemployees", "remotereferralboardinternaluseonly"]) expect(tokens).toContain(t);
    // Every catalogue token that spells "internal" is labelled: the report's 15
    // on 2026-11-15 (the other 29 say it in their names, or say referral,
    // employees or invitation). The catalogue may retire them; it may not add
    // one unlabelled.
    const spelled = FIX.catalogue.internal.filter((b) => /internal/i.test(b.token));
    expect(spelled.length).toBe(15);
    expect(CATALOG.filter((b) => /internal/i.test(b.token)).map((b) => b.token).filter((t) => !tokens.includes(t))).toEqual([]);
    expect(new Set(FIX.catalogue.internal.map((b) => b.kind))).toEqual(new Set(["an internal board", "a referral board", "an employees-only board", "an invitation-only board"]));
  });

  it("catches every labelled internal board, as the kind it is labelled", () => {
    const wrong = FIX.catalogue.internal.filter((b) => internalBoardReason(b.token, b.name) !== b.kind);
    expect(wrong, JSON.stringify(wrong.map((b) => [b.token, b.name, internalBoardReason(b.token, b.name)]))).toEqual([]);
  });

  it("passes every board open to everyone whose name or token carries the same words", () => {
    expect(FIX.catalogue.public.length).toBeGreaterThanOrEqual(25);
    const caught = FIX.catalogue.public.filter((b) => internalBoardReason(b.token, b.name));
    expect(caught.map((b) => `${b.token} ${b.name}`)).toEqual([]);
    // The three a bare "internal" would take: a medical specialty, an audit profession, a government department.
    for (const name of ["Internal Medicine Associates", "Indiana Internal Medicine Consultants", "The Institute of Internal Auditors (IIA)", "Candidate Experience Site - Department of Internal Affairs"]) {
      expect(FIX.catalogue.public.map((b) => b.name)).toContain(name);
    }
  });

  it("over the whole catalogue this branch holds, catches exactly the labelled boards", () => {
    expect(CATALOG.length).toBeGreaterThan(40_000);
    const labelled = new Set(FIX.catalogue.internal.map((b) => `${b.source}|${b.token}`));
    const caught = CATALOG.filter((b) => internalBoardReason(b.token, b.name)).map((b) => `${b.source}|${b.token}`);
    expect(caught.filter((k) => !labelled.has(k)), "caught but not labelled: label it in the fixture, or narrow the screen").toEqual([]);
    const present = new Set(CATALOG.map((b) => `${b.source}|${b.token}`));
    expect([...labelled].filter((k) => present.has(k) && !caught.includes(k))).toEqual([]);
  });
});

describe("the corpus: a posting's own words", () => {
  it("catches every recorded posting that says only the employer's own people may apply", () => {
    expect(FIX.internalOnly.length).toBeGreaterThanOrEqual(5);
    const missed = FIX.internalOnly.filter((p) => !internalOnlyTextReason(textOf(p)));
    expect(missed.map((p) => p.id)).toEqual([]);
    expect(internalOnlyTextReason(textOf(FIX.internalOnly.find((p) => p.id.startsWith("greenhouse:coupanginternal:"))!))).toBe("This posting is exclusively for internal employees");
    expect(internalOnlyTextReason(textOf(vitalFarms))).toBe("This posting is intended for current Vital Farms employees");
  });

  it("catches none of 330 real public postings, the 208 live marked-up pages among them", () => {
    expect(FIX.public.length).toBeGreaterThanOrEqual(330);
    expect(FIX.public.filter((p) => p.from?.startsWith("live page")).length).toBe(208);
    const caught = FIX.public.map((p) => [p.id, internalOnlyTextReason(textOf(p))]).filter(([, why]) => why);
    expect(caught).toEqual([]);
  });

  it("passes what public postings print for internal applicants (each sentence is in the public corpus)", () => {
    const all = FIX.public.map(textOf).join("\n");
    for (const sentence of [
      "IMPORTANT NOTICE FOR INTERNAL APPLICANTS ONLY:",
      "Note: Internal candidates are only asked to join on video",
      "Current employees, if you want to apply to our internal career site",
      "For internal use only: #LI-",
      "Internal Applicants due by:",
      "IF YOU ARE AN EXISTING EMPLOYEE, PLEASE NAVIGATE TO THE INTERNAL JOB POSTING",
    ]) {
      expect(all, `the corpus no longer holds "${sentence}"`).toContain(sentence);
      expect(internalOnlyTextReason(sentence)).toBeNull();
    }
    // A role open to both, said either way round.
    expect(internalOnlyTextReason("This position is open to internal and external candidates.")).toBeNull();
    expect(internalOnlyTextReason("This position is open to current employees and external applicants.")).toBeNull();
    expect(internalOnlyTextReason("This position is open to current employees only.")).toBe("This position is open to current employees");
  });
});

describe("rule 1 refuses an internal board's row, so the bake gives it no page of its own", () => {
  it("the Coupang Internal row as served, and a Workday site named Invitation-Only", () => {
    expect(postingRowEligible(coupang(), D)).toBe(false);
    const invited = open({ id: "workday:franklintempleton~wd5~Invitation-Only:R1", source: "workday", token: "franklintempleton~wd5~Invitation-Only", company: "Franklin Templeton" });
    expect(postingRowEligible(invited, D)).toBe(false);
    // The token alone says it, whatever the stored name.
    expect(postingRowEligible(coupang({ company: "Coupang" }), D)).toBe(false);
  });

  it("positive control: the same row on a public board is eligible", () => {
    expect(postingRowEligible(open(), D)).toBe(true);
  });
});

describe("no writer marks up a posting only the employer's own people may apply for", () => {
  it("the markup every writer asks for is null for the Coupang Internal row and for a public board's posting that says so", () => {
    expect(postingJsonLdShape(coupang(), DESC, { site: SITE })).toBeNull();
    expect(postingJsonLdShape(open(), vitalFarms.description, { site: SITE })).toBeNull();
    // Nor does either D7 question (the name or the country the only thing in the way) bring it back.
    expect(postingJsonLdShape(open(), vitalFarms.description, { site: SITE, ignoreNameGate: true, ignoreCountryMismatch: true })).toBeNull();
    expect(postingJsonLdShape(open({ title: "Distribution Trainer (Internal Only)" }), DESC, { site: SITE })).toBeNull();
  });

  it("the bake retires both to the noindex stub, carried or new, with no markup", () => {
    for (const carried of [true, false]) {
      expect(bakePostingPage(coupang(), DESC, { D, SITE, carried })).toMatchObject({ live: false, ld: null });
      expect(bakePostingPage(open(), vitalFarms.description, { D, SITE, carried })).toMatchObject({ live: false, ld: null });
    }
  });

  it("positive control: a public board's posting with a description open to everyone is a live page with markup", () => {
    expect(postingJsonLdShape(open(), DESC, { site: SITE })?.hiringOrganization).toEqual({ "@type": "Organization", name: "Acme Foods" });
    const page = bakePostingPage(open(), DESC, { D, SITE, carried: true });
    expect(page.live).toBe(true);
    expect(page.ld).toBeTruthy();
  });
});

describe("a paid-survey panel ad is not a job (F03)", () => {
  it("catches every recorded ad, one or two for each shape of its wording", () => {
    expect(FIX.surveyAds.length).toBeGreaterThanOrEqual(10);
    expect(FIX.surveyAds.filter((p) => !paidSurveyAdReason(textOf(p))).map((p) => p.id)).toEqual([]);
    expect(paidSurveyAdReason(FIX.surveyAds.map(textOf).join("\n"))).toBeTruthy();
    expect(FIX.surveyAds.map(textOf).join("\n")).not.toMatch(/ttrk\.io/);
  });

  it("catches none of the public postings, the ones that speak of surveys, focus groups, panels or polls as work among them", () => {
    const work = FIX.public.filter((p) => /survey|focus group|panelist|polls?\b/i.test(textOf(p)));
    expect(work.length).toBeGreaterThanOrEqual(35);
    expect(FIX.public.map((p) => [p.id, paidSurveyAdReason(textOf(p))]).filter(([, why]) => why)).toEqual([]);
  });

  it("rule 1 holds the feed the check found, and the markup gate reads the ad on any board", () => {
    expect(PAID_SURVEY_AD_BOARDS.has("usasurveyjob")).toBe(true);
    const ad = FIX.surveyAds[0];
    const fromFeed = open({ id: "lever:usasurveyjob:d60f2773-5722-438d-be70-ddfa533facf8", source: "lever", token: "usasurveyjob", company: "Usasurveyjob", title: ad.title });
    expect(postingRowEligible(fromFeed, D)).toBe(false);
    expect(postingJsonLdShape(open({ title: ad.title }), ad.description, { site: SITE })).toBeNull();
    for (const carried of [true, false]) {
      expect(bakePostingPage(fromFeed, ad.description, { D, SITE, carried })).toMatchObject({ live: false, ld: null });
      expect(bakePostingPage(open({ title: ad.title }), ad.description, { D, SITE, carried })).toMatchObject({ live: false, ld: null });
    }
  });
});
