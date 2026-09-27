import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  detectWorkMode,
  homeOfficeResidue,
  isHomeOfficeSiteLabel,
  normalizePaylocity,
  withoutHomeOfficeToken,
} from "../../supabase/functions/job-board/normalize";
import { codeOf } from "./helpers/strip-comments";

/**
 * A HEAD OFFICE IS A BUILDING. THE BOARD PUBLISHED IT AS A WORK-FROM-HOME
 * POLICY.
 *
 * WHAT THIS GUARDS. In American corporate English "Home Office" is the
 * headquarters. normalizePaylocity took the vendor's LocationName
 * unconditionally over the City/State that arrives in the SAME list payload,
 * and handed that string to the shared work-mode detector, whose remote
 * pattern carries the token because in German and in plenty of English
 * postings it genuinely states the policy. So a building name became a remote
 * claim with no employer statement of any kind behind it — and
 * src/pages/Jobs.tsx publishes jobLocationType TELECOMMUTE in the JSON-LD of
 * any posting whose work mode is remote, so a Columbia SC equipment-operator
 * role was served to crawlers as telework.
 *
 * WHY THE FIXTURE IS A CENSUS AND NOT A SAMPLE. Every row below is real:
 * fixtures/paylocity-home-office-census.json holds all 39 stored postings whose
 * location carried the token, each with the verbatim list-payload item
 * re-fetched from its own tenant board (15 tenants, 39 of 39 still live,
 * 2026-09-27T03:55Z) and the values the board stored for it. The vendor's own
 * structured IsRemote is FALSE on 39 of 39, and 36 of the 39 carry a real
 * City/State in that same payload. Synthetic strings would have proved
 * nothing: the shapes that matter here are "1000-Home Office" (a cost-centre
 * code), "HOME OFFICE DEPARTMENTS" and "Property Management, Inc. Home
 * Office", and nobody would have invented them.
 *
 * WHAT THE RULE DELIBERATELY DOES NOT DO, because an adversarial re-check of
 * the audit REFUTED the wider gate a first draft proposed. A city beside the
 * token is NOT evidence of a building: Ashby answers workplaceType "Remote" on
 * "Home Office (Belfast)" and on "Palo Alto Home Office", a German ATS's own
 * remote boolean confirms the one-word spelling on 51 of 51 offers, and of the
 * Workday rows in this class that carry a structured remote type, 20 say
 * Remote. Stripping the token wherever it sits beside a place would have
 * deleted 114 genuinely-remote rows. So the rule answers yes on three residues
 * and no others — nothing left, a bare cost-centre number, or a residue naming
 * an organisation or a department — and the third describe block below is the
 * one that holds that line.
 *
 * THE ENTITY ARM IS NOT ANCHORED, AND THAT IS THE MEASURED CHOICE. Two of the
 * 39 labels are "Property Management, Inc. Home Office" and "Home
 * Office-Harold Grinspoon Foundation", whose residues are COMPANY NAMES with
 * an entity word inside them; a rule demanding a residue of nothing but entity
 * words would answer no on both and leave three of the measured rows
 * publishing a building as a policy. So an entity word qualifies a residue
 * wherever in it the word sits, INCLUDING when a place is also left, and the
 * fourth describe block pins that as a decision rather than leaving the
 * docblock and the code making different promises. The direction is the safe
 * one either way: a yes only ever removes a claim.
 *
 * TRINARY-OR-NOTHING. The vendor's flag being false is SILENCE, not onsite, so
 * these rows resolve to NULL or to whatever the posting's own title states.
 * Nothing here ever writes onsite, and the second describe block asserts that
 * as a property rather than trusting it.
 */

const FIXTURE = resolve(__dirname, "fixtures/paylocity-home-office-census.json");
const NORMALIZE_PATH = resolve(__dirname, "../../supabase/functions/job-board/normalize.ts");

interface CensusRow {
  token: string;
  company: string;
  item: Record<string, unknown> & {
    JobTitle: string;
    LocationName: string;
    IsRemote: boolean;
    JobLocation: { City: string | null; State: string | null } | null;
  };
  stored: {
    id: string;
    location: string;
    work_mode: string | null;
    remote: boolean;
    country: string | null;
    title: string;
    department: string | null;
  };
}

const CENSUS: CensusRow[] = (
  JSON.parse(readFileSync(FIXTURE, "utf8")) as { rows: CensusRow[] }
).rows;

/** The real function, one posting at a time, so a failure names its row. */
const ship = (r: CensusRow, over: Record<string, unknown> = {}) =>
  normalizePaylocity([{ ...r.item, ...over }] as never, r.company, r.token)[0];

const cityState = (r: CensusRow) =>
  [r.item.JobLocation?.City, r.item.JobLocation?.State].filter(Boolean).join(", ").trim();

/**
 * THE TWO LINES AS THEY SHIPPED, so the census can be shown to be a census OF
 * THE DEFECT and not an arbitrary 39 rows. This is the shape the negation
 * repair used for the same reason: a guard that only exercises the fixed code
 * cannot tell you the fixture ever reproduced anything.
 */
const preFixWorkMode = (r: CensusRow): string | null => {
  const location = String(r.item.LocationName ?? "").trim() || cityState(r);
  return r.item.IsRemote === true
    ? "remote"
    : detectWorkMode(location, String(r.item.JobTitle ?? "").trim(), r.stored.department);
};

describe("the census reproduces the defect it was captured for", () => {
  it("is 39 live postings whose vendor says it is not remote", () => {
    expect(CENSUS).toHaveLength(39);
    expect(CENSUS.filter((r) => r.item.IsRemote === false)).toHaveLength(39);
    // What the board stored for them: remote, every one.
    expect(CENSUS.filter((r) => r.stored.work_mode === "remote")).toHaveLength(39);
    expect(CENSUS.filter((r) => r.stored.remote === true)).toHaveLength(39);
  });

  it("would still be published as remote by the code that shipped", () => {
    const wrong = CENSUS.filter((r) => preFixWorkMode(r) === "remote");
    expect(
      wrong.length,
      "the pre-fix expression no longer reproduces the defect on the captured rows — " +
        "either the census or the replication has drifted, and the fix below is then " +
        "being proved against nothing",
    ).toBe(39);
  });

  it("carries a real City/State on 36 of the 39, which ingest was throwing away", () => {
    expect(CENSUS.filter((r) => cityState(r) !== "")).toHaveLength(36);
  });
});

describe("a head-office site label yields to the place in the same payload", () => {
  it("classifies 36 of the 39 stored labels as a site name and no more", () => {
    const labels = CENSUS.filter((r) => isHomeOfficeSiteLabel(r.item.LocationName));
    expect(labels).toHaveLength(36);
  });

  it("serves the vendor's own City/State wherever the payload states one", () => {
    const gained = CENSUS.filter(
      (r) => isHomeOfficeSiteLabel(r.item.LocationName) && cityState(r) !== "",
    );
    // 34, not 36: two of the site-label rows carry no City and no State at all.
    expect(gained).toHaveLength(34);
    for (const r of gained) {
      const row = ship(r);
      expect(row.location, `${r.stored.id} did not take the payload's place`).toBe(cityState(r));
      expect(row.location, `${r.stored.id} still quotes the building`).not.toMatch(/home\s+office/i);
    }
    // The places this recovers, named so a reader can check them against the
    // employers' own boards rather than taking a count on trust.
    expect(new Set(gained.map((r) => ship(r).location))).toEqual(
      new Set([
        "Peoria, IL", "Columbia, SC", "SC", "Camp Hill, PA", "Lemoyne, PA", "Edina, MN",
        "RALEIGH, NC", "Tallahassee, FL", "Overland Park, KS", "Madison, WI", "Houston, TX",
        "West Warwick, RI", "Agawam, MA", "Charleston, SC", "KY", "AR",
      ]),
    );
  });

  it("keeps the label as the displayed place when the payload states none, and still refuses it as a mode", () => {
    const orphans = CENSUS.filter(
      (r) => isHomeOfficeSiteLabel(r.item.LocationName) && cityState(r) === "",
    );
    expect(orphans).toHaveLength(2);
    for (const r of orphans) {
      const row = ship(r);
      // Losing the only location we have would be a second error, not a fix:
      // the building name is honest, it is simply not a work-mode statement.
      expect(row.location).toBe(r.item.LocationName);
      expect(row.workMode, `${r.stored.id} still reads its own building as a policy`).toBeNull();
    }
  });

  it("does not move the country the vendor stated", () => {
    for (const r of CENSUS) {
      expect(ship(r).country, `${r.stored.id} country moved`).toBe(r.stored.country);
    }
  });
});

describe("silence is never on-site, and a stated mode is never removed", () => {
  it("writes no work mode for the 35 rows whose only remote evidence was the building", () => {
    const shipped = CENSUS.map((r) => ({ r, row: ship(r) }));
    expect(shipped.filter((s) => s.row.workMode === null)).toHaveLength(35);
    // THE RULE THIS FILE EXISTS UNDER. The vendor flag reading false is the
    // employer saying nothing, not the employer saying on-site.
    expect(
      shipped.filter((s) => s.row.workMode === "onsite"),
      "a row was given a mode the employer never stated",
    ).toEqual([]);
    expect(shipped.filter((s) => s.row.workMode === "hybrid")).toEqual([]);
    for (const s of shipped) {
      expect(s.row.remote, `${s.r.stored.id} boolean disagrees with its trinary`)
        .toBe(s.row.workMode === "remote");
    }
  });

  it("leaves remote in place where the posting's own title says so", () => {
    const stated = CENSUS.filter((r) => /prime remote/i.test(r.item.JobTitle));
    expect(stated).toHaveLength(1);
    const row = ship(stated[0]);
    expect(row.workMode).toBe("remote");
    // And that row gains its place in the same pass — the two halves of the
    // fix are independent.
    expect(row.location).toBe("Houston, TX");
  });

  it("never overrides the vendor's structured remote flag", () => {
    // Collateral damage is the thing to fear here: the whole argument for this
    // change is that a vendor's own field beats our reading of a string, so the
    // change must not start beating the vendor's own field.
    for (const r of CENSUS) {
      const row = ship(r, { IsRemote: true });
      expect(row.workMode, `${r.stored.id} lost a vendor-stated remote`).toBe("remote");
      expect(row.remote).toBe(true);
    }
  });

  it("still moves a vendor-remote row's DISPLAYED place to the City/State, by decision", () => {
    // The substitution is unconditional on the vendor flag, and this asserts it
    // rather than leaving it as a side effect nobody chose. A vendor-stated
    // remote row whose LocationName is a cost-centre code is displayed at the
    // City/State FROM THE SAME PAYLOAD — the employer's own structured place,
    // not an inference — while the mode stays remote. Live rows affected: 0, the
    // flag being false on 39 of 39.
    const labelled = CENSUS.filter(
      (r) => isHomeOfficeSiteLabel(r.item.LocationName) && cityState(r) !== "",
    );
    expect(labelled.length).toBe(34);
    for (const r of labelled) {
      const row = ship(r, { IsRemote: true });
      expect(row.workMode, `${r.stored.id} lost a vendor-stated remote`).toBe("remote");
      expect(row.location, `${r.stored.id} kept the building as a vendor-remote row's place`)
        .toBe(cityState(r));
    }
  });

  it("does not read a head-office DEPARTMENT as a work-from-home policy", () => {
    // THE HOLE THE REVIEW FOUND, in the state it lives in. An employer whose
    // site labels read "HOME OFFICE DEPARTMENTS" names departments the same
    // way; the location yielded correctly while the department string reached
    // the detector untouched, so the building came back in through the other
    // door. The row below is the census shape with the token moved into
    // HiringDepartment. Live count of that shape: 0 of 3,646 rows across 30
    // boards sampled every tenth token (2026-09-27), so this is a latent hole
    // rather than shipping damage — and the repair migration masks the same
    // column so the two runtimes cannot disagree about it.
    const [job] = normalizePaylocity(
      [{
        JobId: "DEPT-TOKEN",
        JobTitle: "Mail Clerk",
        LocationName: "Home Office",
        IsRemote: false,
        HiringDepartment: "Home Office Services",
        JobLocation: { City: "Peoria", State: "IL", Country: "USA" },
      }] as never,
      "Employer",
      "aaaa1111-bbbb-2222-cccc-333333333333",
    );
    expect(job.location, "the site label did not yield").toBe("Peoria, IL");
    expect(job.workMode, "the department's building name was read as a policy").toBeNull();
    expect(job.remote).toBe(false);
    // The department itself is still DISPLAYED verbatim: only the mode input is
    // masked, because the employer's own name for the unit is not wrong.
    expect(job.department).toBe("Home Office Services");
  });

  it("leaves a department that states a mode in its own right alone", () => {
    // The mask must take the building and nothing else. A department genuinely
    // naming a work mode is still the employer's own words.
    const [job] = normalizePaylocity(
      [{
        JobId: "DEPT-ONSITE",
        JobTitle: "Mail Clerk",
        LocationName: "Home Office",
        IsRemote: false,
        HiringDepartment: "On-Site Property Maintenance",
        JobLocation: { City: "Peoria", State: "IL", Country: "USA" },
      }] as never,
      "Employer",
      "aaaa1111-bbbb-2222-cccc-333333333333",
    );
    expect(job.workMode).toBe("onsite");
  });
});

describe("the head-office mask takes the building and leaves the rest", () => {
  /**
   * WHAT THIS GUARDS. `withoutHomeOfficeToken` is the one way a vendor string
   * that names a BUILDING or an ORG-CHART UNIT is handed to the work-mode
   * detector, and its whole job is to be narrower than the site-label rule: it
   * does not decide anything, it removes one phrase. A TITLE is never masked,
   * because there the phrase is the posting's own words — pinned separately by
   * the older German-title guard.
   */
  it.each([
    ["Home Office", null, "nothing left is nothing said"],
    ["HOME OFFICE", null, "case does not matter"],
    ["Home Office Services", "Services", "the unit's real name survives"],
    ["CM Home Office", "CM", "and so does its prefix"],
    ["Claims", "Claims", "a string without the token is returned unchanged"],
    ["Remote Patient Monitoring", "Remote Patient Monitoring", "only the head-office phrase is touched"],
    ["Homeoffice", "Homeoffice", "the one-word German spelling is NOT the token — the separator is mandatory"],
    ["", null, "an empty string says nothing"],
    [null, null, "and so does an absent one"],
  ] as ReadonlyArray<readonly [string | null, string | null, string]>)(
    "%s -> %s (%s)", (input, expected) => {
      expect(withoutHomeOfficeToken(input)).toBe(expected);
    },
  );

  it("is what both changed arms hand the detector for a department", () => {
    // Comment-stripped: this repo has failed guards whose required literal was
    // satisfied by a sentence in a comment. The DECLARATION is masked out
    // first, because it lives at module scope above every vendor arm.
    const src = codeOf(readFileSync(NORMALIZE_PATH, "utf8"));
    const callsOnly = src.replace(/export function withoutHomeOfficeToken\(/g, "DECL_MASKED(");
    const arms = callsOnly.split(/(?=export function normalize[A-Z])/);
    const consumers = arms
      .filter((body) => /withoutHomeOfficeToken\(/.test(body))
      .map((body) => body.match(/export function (normalize\w+)/)?.[1] ?? "(module scope)")
      .sort();
    expect(
      consumers,
      "the head-office mask is read by an arm with no census behind it, or has stopped being read by one that has",
    ).toEqual(["normalizePaylocity", "normalizeUkg"]);
    // And the TITLE is never the masked argument — that is the whole asymmetry.
    for (const arm of arms) {
      expect(arm, "a title was handed to the detector with the head-office token removed")
        .not.toMatch(/withoutHomeOfficeToken\(\s*title\s*\)/);
    }
  });
});

/**
 * THE REFUTED GATE. Every string here is a live value the audit's adversarial
 * verifier fetched from the vendor named, with that vendor's own answer beside
 * it. A rule that read these as building names would delete an employer's
 * statement, which is strictly worse than the defect being fixed.
 */
const MUST_NOT_BE_A_SITE_LABEL: ReadonlyArray<readonly [string, string]> = [
  // Ashby, workplaceType "Remote" / isRemote true on both tenants.
  ["Home Office (Belfast)", "ashby says Remote"],
  ["Palo Alto Home Office", "ashby says Remote"],
  // Workday rows carrying a structured remoteType that says Remote.
  ["TX Home Office", "workday remoteType Remote"],
  ["Home Office (CT)", "workday remoteType Fully Remote"],
  // The German one-word spelling: 99 of 99 in the census belong to the vendor
  // whose own remote boolean confirms them 51 of 51.
  ["Homeoffice", "recruitee remote:true"],
  // The Workday building/ordinal class. It IS a site-name class — USAA
  // publishes 41 rows here and 23 of them say in their own words that you must
  // be in a San Antonio office four days a week — but it is a DIFFERENT build:
  // those rows need the ordinal and facility-number rule, and this one must not
  // reach into them silently.
  ["San Antonio Home Office I", "out of scope: workday ordinal class"],
  ["San Antonio Home Office II/III", "out of scope: workday ordinal class"],
  ["8775 Silver Spring MD Home Office", "out of scope: workday facility number"],
  // Jurisdiction-qualified: the class where 20 of the 24 rows carrying a
  // structured remote type say Remote. Demoting it was the worst move available.
  ["FL - Home Office", "workday jurisdiction class"],
  ["Home Office - Canada", "workday jurisdiction class"],
  ["Home Office Saudi Arabia", "workday jurisdiction class"],
  ["Home Office, Germany; Bundesweit, Germany", "icims multi-site"],
  ["Home Office, Columbus, OH, US", "adp, city in the string"],
  ["US-CA California Los Angeles/Orange County Home Office", "workday, city in the string"],
];

describe("a place beside the token is not evidence of a building", () => {
  it.each(MUST_NOT_BE_A_SITE_LABEL)("%s is not a site label (%s)", (label) => {
    expect(
      isHomeOfficeSiteLabel(label),
      `residue was ${JSON.stringify(homeOfficeResidue(label))}`,
    ).toBe(false);
  });

  it("the three census rows that still name a place are untouched", () => {
    const kept = CENSUS.filter((r) => !isHomeOfficeSiteLabel(r.item.LocationName));
    expect(kept).toHaveLength(3);
    for (const r of kept) {
      const row = ship(r);
      expect(row.location).toBe(r.item.LocationName);
      // Still remote, on purpose and stated as a known residue: the two
      // Montana rows and the Californian sentence are not settled by anything
      // we can read, and a wrong demotion here is the refuted gate.
      expect(row.workMode).toBe("remote");
    }
    expect(new Set(kept.map((r) => r.item.LocationName))).toEqual(
      new Set([
        "Bozeman, MT - Home Office",
        "San Jose, Watsonville, or Salinas (the applicant’s choice of home office)",
      ]),
    );
  });

  /**
   * AND THE LINE IS ABOUT A PLACE, NOT ABOUT LENGTH. The docblock used to
   * promise that "every string with a place left in it" answers no, which is not
   * what the code does and never could be: two of the 39 census labels put a
   * corporate-entity word inside a COMPANY NAME, so the entity arm has to fire
   * on a residue that still has other words in it — four of the 39 rows, under
   * two distinct labels. A review found the split between the comment and the
   * code; this is the half the comment was missing, pinned so the next reader
   * sees a decision instead of a contradiction.
   */
  it.each([
    ["Bozeman, MT - Home Office Inc", "a place AND an entity word: the entity word wins"],
    ["Home Office (Belfast) GmbH", "same, second spelling"],
    ["Home Office - Acme Inc, Denver, CO", "same, entity word in the middle"],
    ["Springfield Home Office Departments", "the department arm behaves the same way"],
  ])("%s IS a site label (%s)", (label) => {
    expect(
      isHomeOfficeSiteLabel(label),
      `residue was ${JSON.stringify(homeOfficeResidue(label))}`,
    ).toBe(true);
  });

  it("the entity arm is what makes those yeses, and the census needs it", () => {
    // TEETH for the paragraph above: anchoring the entity arm — requiring the
    // residue to be nothing but entity words, which is what the docblock used to
    // promise — un-fixes three of the 39 measured rows. So the unanchored form
    // is not laziness; it is the census.
    const ANCHORED = /^(?:inc|llc|corp|foundation|gmbh|departments?)(?:\s+(?:inc|llc|corp|foundation|gmbh|departments?))*$/i;
    const anchoredSaysLabel = (s: string): boolean => {
      const residue = homeOfficeResidue(s);
      if (residue === null) return false;
      return residue === "" || /^[0-9]{3,}$/.test(residue) || ANCHORED.test(residue);
    };
    const lost = CENSUS.filter(
      (r) => isHomeOfficeSiteLabel(r.item.LocationName) && !anchoredSaysLabel(r.item.LocationName),
    );
    expect(
      lost.length,
      "anchoring the entity arm no longer costs the census anything — re-read the docblock, " +
        "because the reason it is unanchored has gone",
    ).toBe(4);
    expect(new Set(lost.map((r) => r.item.LocationName))).toEqual(
      new Set([
        "Property Management, Inc. Home Office",
        "Home Office-Harold Grinspoon Foundation",
      ]),
    );
  });

  it("the wide gate the audit refuted would have caught the rows above", () => {
    // TEETH, in the direction that matters most. This is the gate the first
    // proposal wrote — the token anywhere in the field — and the assertion is
    // that it is NOT the gate that shipped.
    const wideGate = (s: string) => /\bhome\s?office\b/i.test(s);
    const wouldStrip = MUST_NOT_BE_A_SITE_LABEL.filter(([s]) => wideGate(s));
    expect(
      wouldStrip.length,
      "the refuted gate no longer differs from the shipped one — the whitelist has " +
        "been widened into a presence test, which deletes employer statements",
    ).toBeGreaterThanOrEqual(13);
    for (const [s] of wouldStrip) expect(isHomeOfficeSiteLabel(s)).toBe(false);
  });
});

describe("the rule stays inside the vendor arm its census covers", () => {
  const src = codeOf(readFileSync(NORMALIZE_PATH, "utf8"));

  it("is consulted by exactly one vendor arm", () => {
    // Comment-stripped: this repo has failed guards whose required literal was
    // satisfied by a sentence in a comment, seven times over. The DECLARATION
    // is masked out first, because it lives at module scope — above every
    // vendor arm — and a split on the arm boundary would otherwise file it
    // under whichever arm happens to be declared before it.
    const callsOnly = src.replace(/export function isHomeOfficeSiteLabel\(/g, "DECL_MASKED(");
    expect(
      [...callsOnly.matchAll(/isHomeOfficeSiteLabel\(/g)].length,
      "the site-label rule is now read in more than one place",
    ).toBe(1);
    const arms = callsOnly.split(/(?=export function normalize[A-Z])/);
    const consumers = arms
      .filter((body) => /isHomeOfficeSiteLabel\(/.test(body))
      .map((body) => body.match(/export function (normalize\w+)/)?.[1] ?? "(module scope)");
    expect(
      consumers,
      "the census this rule is measured on covers ONE vendor; another arm reading it " +
        "is measured on nothing. The Workday ordinal class needs its own build.",
    ).toEqual(["normalizePaylocity"]);
  });

  it("leaves the shared detector's own token alone", () => {
    // The token must keep meaning remote everywhere else, which is the whole
    // reason the fix went into the vendor arm instead of the regex. The German
    // title reading is pinned by its own older guard; this asserts the shared
    // detector still answers it.
    expect(detectWorkMode("Berater Home Office")).toBe("remote");
    expect(detectWorkMode("Cleveland, OH", "Homeoffice Berater")).toBe("remote");
  });
});
