import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  detectWorkMode,
  statedWorkMode,
  NEGATED_REMOTE_SOURCE,
  stripNegatedRemote,
  normalizeGreenhouse,
  normalizeLever,
  normalizeAshby,
  normalizeSmartRecruiters,
  normalizeWorkable,
  normalizeBambooHR,
  normalizeRecruitee,
  normalizePersonio,
  normalizeBreezy,
  normalizeIcims,
  normalizeRippling,
  normalizePaylocity,
  normalizeAdp,
  normalizeUkg,
  normalizePinpoint,
  normalizeWorkday,
  normalizeOracle,
  normalizeTeamtailor,
  normalizeUsajobs,
  type JobPosting,
} from "../../supabase/functions/job-board/normalize.ts";

/**
 * THE REMOTE FILTER SERVED ROLES THAT SAY IN THEIR OWN TITLE THEY ARE NOT REMOTE.
 *
 * Measured live 2026-09-09 against deployed job-board .67 —
 *   POST job-board {"action":"list","q":"non-remote","workMode":"remote"}
 *     -> "Application Analyst II-Full Time- Days - Cupid/Radiant- NON-REMOTE" (workday)
 *     -> "RN (PRN - Not Remote)"                                             (icims)
 *
 * The mechanism: in "NON-REMOTE" the hyphen is a word boundary, so a bare
 * \bremote\b matches and the board stored the exact inverse of what the
 * employer wrote.
 *
 * This is the SECOND time. The 2026-08-17 incident fixed exactly this in the
 * index.ts remoteType classifier and wrote the rule down — "a classifier built
 * from substrings must answer the NEGATIONS before the POSITIVES" — and the
 * guard that holds it (work-mode-never-inverts-the-employer.test.ts) reads
 * index.ts and only index.ts. detectWorkMode in normalize.ts, which is what
 * actually classifies every vendor's title and location text, never got the
 * arm and no guard looked at it.
 *
 * So this file asserts the PROPERTY at the level the defect lives: for every
 * vendor adapter, the trinary and the boolean agree, and a string whose only
 * remote token sits inside a negation is never remote.
 */

// ── The pre-fix detector, verbatim, so "the guard has teeth" is a measurement
//    and not a claim. This is detectWorkMode as it shipped in .67.
const P_HYBRID_PREFIX = /\bhybrid\b|\bhybride\b|\bh[íi]brido?\b/i;
const P_REMOTE_PREFIX = /\bremote\b|\bwork from home\b|\bwfh\b|\bt[ée]l[ée]travail\b|\bhome\s?office\b|\bremoto\b|\bthuiswerken\b|\bteletrabajo\b/i;
const P_ONSITE_PREFIX = /\bon-?site\b|\bin-?office\b|\bvor ort\b|\bpresencial\b|\bsur site\b/i;
const detectWorkModePreFix = (...parts: Array<string | null | undefined>) => {
  const s = parts.filter(Boolean).join(" · ");
  if (!s) return null;
  if (P_HYBRID_PREFIX.test(s)) return "hybrid";
  if (P_REMOTE_PREFIX.test(s)) return "remote";
  if (P_ONSITE_PREFIX.test(s)) return "onsite";
  return null;
};

type Mode = "remote" | "hybrid" | "onsite" | null;

/**
 * Observed and constructed strings, each with the answer the board owes a
 * reader. `live` marks a string measured on the deployed board 2026-09-09;
 * `incident` marks one recorded in the 2026-08-17 repair migration. The rest
 * are the same shapes in the other languages P_REMOTE already carries — see
 * the coverage note in normalize.ts: those arms are grammar, not observation,
 * and are written narrowly for that reason.
 */
const NEGATED: ReadonlyArray<readonly [string, Mode, string]> = [
  // The two live rows, verbatim.
  ["Application Analyst II-Full Time- Days - Cupid/Radiant- NON-REMOTE", null, "live"],
  ["RN (PRN - Not Remote)", null, "live"],
  // From the 2026-08-17 incident — Nike's own Workday value and its siblings.
  ["Non-Remote Posting", null, "incident"],
  ["Not Remote", null, "incident"],
  ["No Remote", null, "incident"],
  ["non remote", null, "incident"],
  // A negation does not erase a mode the posting DOES state.
  ["Field Engineer (On-site, not remote)", "onsite", "constructed"],
  ["Analyst - On-Site / Non-Remote", "onsite", "constructed"],
  ["Product Manager, Hybrid (non-remote)", "hybrid", "constructed"],
  ["Nurse Practitioner - Nonremote", null, "constructed"],
  ["Staff Accountant — Remote: No", null, "constructed"],
  ["Technician - No remote work", null, "constructed"],
  ["Senior Analyst (not eligible for remote)", null, "constructed"],
  ["Support Rep - no work from home", null, "constructed"],
  // FR / ES / PT / NL / DE — grammar, narrowly written.
  ["Ingénieur système - non-télétravail", null, "fr"],
  ["Développeur (pas de télétravail)", null, "fr"],
  ["Chef de projet - télétravail : non", null, "fr"],
  ["Analista de datos - no remoto", null, "es"],
  ["Asesor comercial sin teletrabajo", null, "es"],
  ["Consultor presencial, no remoto", "onsite", "es"],
  ["Analista de sistemas - não remoto", null, "pt"],
  ["Adviseur - geen thuiswerken", null, "nl"],
  ["Berater (kein Home Office)", null, "de"],
  // The TRAILING negator: a title that states it is not remote by putting the
  // negation after the token. Each of these classified "remote" before the
  // trailing arm existed, and the repair migration could not reach them
  // either (v_neg did not match, so the rows stayed work_mode='remote').
  ["Work from home not available", null, "en"],
  ["Remote Not Available", null, "en"],
  ["Field Technician - Remote - unavailable", null, "en"],
  // The field-value form the narrowed arm still owns, including the
  // parenthesised spelling the old separator class could not see.
  ["Remote(No)", null, "en"],
  ["Remote — None", null, "en"],
];

/** The negation arm must not eat the real cases — that is the other way to
 *  break this, and the 2026-08-17 test says so in as many words. */
const NOT_NEGATED: ReadonlyArray<readonly [string, Mode]> = [
  ["Software Engineer (Remote)", "remote"],
  ["Fully Remote Data Analyst", "remote"],
  ["Customer Success Manager - Work From Home", "remote"],
  ["Hybrid Remote - Product Designer", "hybrid"],
  ["Ingénieur logiciel en télétravail", "remote"],
  ["Analista de datos remoto", "remote"],
  ["Adviseur thuiswerken", "remote"],
  ["Berater Home Office", "remote"],
  ["Asesor con teletrabajo", "remote"],
  ["Consultor presencial", "onsite"],
  ["Field Engineer - On-Site", "onsite"],
  // Words that merely CONTAIN a negator. "no" lives inside plenty of place
  // names, and a strip that fires on them deletes a genuine remote posting.
  ["Reno Remote Operations Technician", "remote"],
  ["Nome, AK - Remote Dispatcher", "remote"],
  ["Monorail Technician - Remote", "remote"],
  ["Note: Remote candidates welcome", "remote"],
  ["Analyst - Remote", "remote"],
  // THE OVER-STRIP DIRECTION, which this table did not test at all and which
  // a review caught as a blocker. A dash is a SEGMENT separator in a job
  // title, not a field separator, so an arm shaped
  // `remote\s*[:=–—-]\s*(?:no|none|not)\b` fires on the single most common
  // entry-level remote title family on this board and deletes the only remote
  // token in it — and the repair migration then rewrites those rows to
  // work_mode NULL irreversibly. Every one of these classified "remote"
  // before that arm existed, was demoted to null by its first draft, and must
  // stay "remote". ("no experience" is this board's own vocabulary:
  // index.ts's INTENT_FILTERS carries a rule for the phrase.)
  ["Remote - No Experience Needed", "remote"],
  ["Data Entry Clerk - Remote - No Experience Required", "remote"],
  ["Registered Nurse - Remote - No Weekends", "remote"],
  ["Software Engineer - Remote - No Travel Required", "remote"],
  ["Data Analyst — Remote — No sponsorship", "remote"],
  ["Remote: No Cold Calling Sales Rep", "remote"],
  ["Recruiter - Remote - Not currently hiring in NY", "remote"],
  ["Remote Vacation Resort Specialist | No Experience Needed", "remote"],
  // Adjacency is required by the trailing-negator arm, so a "not available"
  // that belongs to something else must not reach back to the remote token.
  ["Remote Support Engineer - not available for sponsorship", "remote"],
];

describe("a negated remote phrase is never read as remote", () => {
  it.each(NEGATED)("%s -> %s (%s)", (title, expected) => {
    expect(detectWorkMode(title)).toBe(expected);
    expect(detectWorkMode(title), "the whole point").not.toBe("remote");
  });

  it.each(NOT_NEGATED)("%s -> %s", (title, expected) => {
    expect(detectWorkMode(title)).toBe(expected);
  });

  it("PROVES THE TEETH: these cases fail against the pre-fix detector", () => {
    // If this list ever empties, the table above stopped covering the defect.
    const caughtByTheFix = NEGATED.filter(([title, expected]) =>
      detectWorkModePreFix(title) !== expected
    ).map(([title]) => title);
    expect(
      caughtByTheFix.length,
      "no case in NEGATED distinguishes the fixed detector from the shipped one",
    ).toBeGreaterThanOrEqual(20);
    // The two live rows are specifically among them.
    expect(caughtByTheFix).toContain("Application Analyst II-Full Time- Days - Cupid/Radiant- NON-REMOTE");
    expect(caughtByTheFix).toContain("RN (PRN - Not Remote)");
    expect(detectWorkModePreFix("RN (PRN - Not Remote)")).toBe("remote");
    // And the fix did not break anything the pre-fix detector got right.
    for (const [title, expected] of NOT_NEGATED) {
      expect(detectWorkModePreFix(title), `${title} regressed`).toBe(expected);
      expect(detectWorkMode(title)).toBe(expected);
    }
  });

  it("the detector already strips, so stripping again changes nothing", () => {
    // A property, not a spelling: if detectWorkMode did NOT strip first, some
    // string here would classify differently once pre-stripped.
    for (const [title] of [...NEGATED, ...NOT_NEGATED]) {
      expect(detectWorkMode(stripNegatedRemote(title)), title).toBe(detectWorkMode(title));
    }
  });
});

describe("the vendor label reader answers negation first and hybrid before remote", () => {
  it("reads a vendor's own workplace label without a second ladder", () => {
    // iCIMS location_type values. The shipped arm used
    //   lt.includes("remote") ? "remote" : lt.includes("hybrid") ? "hybrid" : …
    // which is both halves of the defect at once.
    expect(statedWorkMode("Non-Remote")).toBeNull();
    expect(statedWorkMode("Hybrid Remote")).toBe("hybrid");
    expect(statedWorkMode("Remote")).toBe("remote");
    expect(statedWorkMode("On-Site")).toBe("onsite");
    expect(statedWorkMode("Office")).toBe("onsite");
    expect(statedWorkMode("ORA_REMOTE")).toBe("remote");
    expect(statedWorkMode("ON_SITE")).toBe("onsite");
    expect(statedWorkMode("")).toBeNull();
    expect(statedWorkMode(null)).toBeNull();
    // "Office" is a clear statement in a workplace-type FIELD and a guess in a
    // job title — the detector must not have learned it.
    expect(detectWorkMode("Office Manager")).toBeNull();
  });

  it("PROVES THE TEETH: the pre-fix iCIMS ladder gets both of those wrong", () => {
    const preFixIcims = (raw: string) => {
      const lt = String(raw ?? "").toLowerCase();
      return lt.includes("remote") ? "remote"
        : lt.includes("hybrid") ? "hybrid"
        : lt.includes("onsite") || lt.includes("on-site") || lt.includes("office") ? "onsite"
        : null;
    };
    expect(preFixIcims("Non-Remote")).toBe("remote");
    expect(preFixIcims("Hybrid Remote")).toBe("remote");
    expect(statedWorkMode("Non-Remote")).not.toBe("remote");
    expect(statedWorkMode("Hybrid Remote")).toBe("hybrid");
  });
});

// ── EVERY VENDOR ARM, SAME ANSWER AS THE SHARED DETECTOR ───────────────────
//
// Each builder produces ONE posting whose only work-mode signal is the title;
// every other field is deliberately mode-neutral. So the answer a correct arm
// must give is exactly detectWorkMode(title) — no arg-order or extra-part
// bookkeeping in the test, and a seventh re-implementation of the ladder
// inside any arm shows up here as a disagreement.
const NEUTRAL_LOC = "Cleveland, OH";

const ARMS: ReadonlyArray<readonly [string, (title: string) => JobPosting[]]> = [
  ["greenhouse", (t) => normalizeGreenhouse(
    { jobs: [{ id: 1, title: t, location: { name: NEUTRAL_LOC }, absolute_url: "https://boards.greenhouse.io/acme/jobs/1" }] } as never,
    "Acme", "acme")],
  ["lever", (t) => normalizeLever(
    [{ id: "1", text: t, categories: { location: NEUTRAL_LOC }, hostedUrl: "https://jobs.lever.co/acme/1" }] as never,
    "Acme", "acme")],
  ["ashby", (t) => normalizeAshby(
    { jobs: [{ id: "1", title: t, location: NEUTRAL_LOC, jobUrl: "https://jobs.ashbyhq.com/acme/1" }] } as never,
    "Acme", "acme")],
  ["smartrecruiters", (t) => normalizeSmartRecruiters(
    { content: [{ id: "1", name: t, location: { fullLocation: NEUTRAL_LOC } }] } as never,
    "Acme", "acme")],
  ["workable", (t) => normalizeWorkable(
    { jobs: [{ shortcode: "aa11", title: t, city: "Cleveland", state: "OH", url: "https://apply.workable.com/j/aa11" }] } as never,
    "Acme", "acme")],
  ["bamboohr", (t) => normalizeBambooHR(
    { result: [{ id: 1, jobOpeningName: t, location: { city: "Cleveland", state: "OH" } }] } as never,
    "Acme", "acme")],
  ["recruitee", (t) => normalizeRecruitee(
    { offers: [{ id: 1, title: t, location: NEUTRAL_LOC, careers_url: "https://acme.recruitee.com/o/1" }] } as never,
    "Acme", "acme")],
  ["personio", (t) => normalizePersonio(
    `<position><id>1</id><name>${t}</name><office>${NEUTRAL_LOC}</office><department>Ops</department><schedule>full-time</schedule></position>`,
    "Acme", "acme", "jobs.personio.de")],
  ["breezy", (t) => normalizeBreezy(
    [{ id: "1", name: t, location: { name: NEUTRAL_LOC }, url: "https://acme.breezy.hr/p/1" }] as never,
    "Acme", "acme")],
  ["icims", (t) => normalizeIcims(
    [{ data: { req_id: "1", title: t, full_location: NEUTRAL_LOC, apply_url: "https://careers-acme.icims.com/jobs/1/job" } }] as never,
    "Acme", "careers-acme.icims.com")],
  ["rippling", (t) => normalizeRippling(
    [{ id: "1", name: t, locations: [{ name: NEUTRAL_LOC }], url: "https://ats.rippling.com/acme/jobs/1" }] as never,
    "Acme", "acme")],
  ["paylocity", (t) => normalizePaylocity(
    [{ JobId: "1", JobTitle: t, LocationName: NEUTRAL_LOC, JobLocation: { City: "Cleveland", State: "OH" } }] as never,
    "Acme", "acme")],
  ["adp", (t) => normalizeAdp(
    [{ itemID: "1", requisitionTitle: t, requisitionLocations: [{ nameCode: { shortName: NEUTRAL_LOC } }] }] as never,
    "Acme", "acme~19000101_000001")],
  ["ukg", (t) => normalizeUkg(
    [{ Id: "1", Title: t, Locations: [{ Address: { City: "Cleveland", State: { Code: "OH" } } }] }] as never,
    "Acme", "recruiting~acme~1")],
  ["pinpoint", (t) => normalizePinpoint(
    [{ id: "1", title: t, location: { name: NEUTRAL_LOC }, url: "https://acme.pinpointhq.com/jobs/1" }] as never,
    "Acme", "acme")],
  ["workday", (t) => normalizeWorkday(
    [{ title: t, locationsText: NEUTRAL_LOC, externalPath: "/job/Cleveland/Analyst_R-1", postedOn: "Posted 2 Days Ago" }] as never,
    "Acme", "acme~wd1~Careers")],
  ["oracle", (t) => normalizeOracle(
    [{ Id: "1", Title: t, PrimaryLocation: NEUTRAL_LOC }] as never,
    "Acme", "acme~us2~CX_1")],
  ["teamtailor", (t) => normalizeTeamtailor(
    `<item><title>${t}</title><link>https://acme.teamtailor.com/jobs/1</link><tt:city>Cleveland</tt:city><tt:country>US</tt:country></item>`,
    "Acme", "acme")],
  ["usajobs", (t) => normalizeUsajobs(
    [{ MatchedObjectId: "1", MatchedObjectDescriptor: { PositionTitle: t, PositionLocation: [{ LocationName: NEUTRAL_LOC }], OrganizationName: "Agency", ApplyURI: ["https://www.usajobs.gov/job/1"] } }] as never,
    "Acme", "acme")],
];

describe("every vendor arm answers with the one shared detector", () => {
  // Enumerated from comment-stripped normalize.ts (see the source guard
  // below) — if a vendor is added and not listed here, that guard fails.
  it("covers every exported vendor normalizer", () => {
    const src = stripComments(readFileSync(NORMALIZE_PATH, "utf8"));
    const exported = [...src.matchAll(/export function normalize([A-Z]\w*)\s*\(/g)]
      .map((m) => m[1])
      .filter((n) => !["EmploymentType", "CloseTitle"].includes(n))
      .map((n) => n.toLowerCase());
    const covered = ARMS.map(([name]) => name.replace(/[^a-z]/g, ""));
    const missing = exported.filter((n) => !covered.includes(n));
    expect(
      missing,
      "a vendor normalizer exists that this property test never exercises — " +
        "add it to ARMS, or the next re-implementation of the work-mode " +
        "ladder ships unseen",
    ).toEqual([]);
  });

  for (const [vendor, build] of ARMS) {
    it(`${vendor}: trinary matches detectWorkMode and the boolean matches the trinary`, () => {
      for (const [title, expected] of [...NEGATED, ...NOT_NEGATED] as ReadonlyArray<readonly [string, Mode]>) {
        const rows = build(title);
        expect(rows.length, `${vendor} fixture did not produce exactly one posting for "${title}"`).toBe(1);
        const row = rows[0];
        expect(row.workMode, `${vendor} disagrees with the shared detector on "${title}"`)
          .toBe(detectWorkMode(title));
        expect(row.workMode, `${vendor} classified a negated title as remote: "${title}"`)
          .toBe(expected);
        // The boolean and the trinary cannot disagree — that disagreement is
        // how the badge and the filter told a reader two different things.
        expect(row.remote, `${vendor} boolean/trinary disagree on "${title}"`)
          .toBe(row.workMode === "remote");
      }
    });
  }
});

// ── SOURCE GUARDS ─────────────────────────────────────────────────────────
// Comment-stripped, because this repo has failed four guards whose required
// literal was satisfied by a sentence in a comment.

const NORMALIZE_PATH = resolve(__dirname, "../../supabase/functions/job-board/normalize.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the source cannot grow a second work-mode ladder", () => {
  const src = stripComments(readFileSync(NORMALIZE_PATH, "utf8"));

  it("every posting's boolean is derived from that posting's own trinary", () => {
    // Not a spelling check: the shape `remote: <the same variable> === "remote"`
    // is the only shape in which the two CANNOT drift, and the drift is what
    // let a hybrid posting carry remote=true.
    const sites = [...src.matchAll(/^\s*remote:\s*(.+?),\s*$/gm)].map((m) => m[1].trim());
    expect(sites.length, "no remote: sites found — has the field been renamed?")
      .toBeGreaterThanOrEqual(19);
    const wrong = sites.filter((e) => e !== 'workMode === "remote"');
    expect(
      wrong,
      "a vendor arm computes its remote boolean from something other than the " +
        "workMode it just stored. Compute `const workMode = …` once and write " +
        '`remote: workMode === "remote"`.',
    ).toEqual([]);
  });

  it("no vendor arm matches a work-mode word by substring or regex of its own", () => {
    // Substring matching on a label is the exact mechanism of both inversions:
    // "Non-Remote".includes("remote") and /\bremote\b/ over "NON-REMOTE".
    // Whole-string equality against a vendor's own vocabulary is fine and is
    // deliberately still allowed (teamtailor's remoteStatus === "fully").
    const bodies = src.split(/(?=export function normalize[A-Z])/).slice(1);
    const offenders: string[] = [];
    for (const body of bodies) {
      const name = body.match(/export function (normalize\w+)/)?.[1] ?? "?";
      if (/normalize(EmploymentType|CloseTitle)/.test(name)) continue;
      const bad = [
        ...body.matchAll(/\.includes\(\s*["'`][^"'`]*(?:remote|hybrid|onsite|on-site|office|telework|wfh)/gi),
        ...body.matchAll(/\/[^/\n]*\b(?:remote|hybrid|onsite|telework|wfh)[^/\n]*\/[gimsuy]*\.test\(/gi),
      ];
      for (const m of bad) offenders.push(`${name}: ${m[0]}`);
    }
    expect(
      offenders,
      "a vendor arm is matching a work-mode word itself instead of calling " +
        "detectWorkMode/statedWorkMode/vendorWorkMode. That is how iCIMS read " +
        '"Non-Remote" as remote and "Hybrid Remote" as remote.',
    ).toEqual([]);
  });

  it("the repair migration's SQL rule and the TypeScript rule are the same rule", () => {
    // CROSS-RUNTIME, because the two live in different languages and drift
    // silently: the code fix only reaches a row when its posting is next
    // re-normalised, so the migration is what takes the falsehood off the
    // board today, and a migration that repairs a DIFFERENT set than the code
    // computes leaves the board internally inconsistent.
    //
    // Postgres ARE -> JavaScript: [[:space:]] is \s, and \m / \M are start-
    // and end-of-word. Every anchor in these patterns sits against a word
    // character, where \b is exactly equivalent.
    const sql = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20260909213000_a_title_that_says_not_remote_is_not_a_remote_job.sql"),
      "utf8",
    );
    const grab = (name: string) => {
      const m = sql.match(new RegExp(`${name} constant text := \\$re\\$([\\s\\S]*?)\\$re\\$;`));
      expect(m, `${name} not found in the repair migration`).not.toBeNull();
      return new RegExp(
        m![1].replace(/\[:space:\]/g, "\\s").replace(/\\m/g, "\\b").replace(/\\M/g, "\\b"),
        "gi",
      );
    };
    // The migration declares v_neg / v_pos twice (one block per repair). Two
    // nearly-identical regexes in one file is how the next drift starts, so
    // every copy must be byte-identical before anything else is checked.
    for (const name of ["v_neg", "v_pos"]) {
      const copies = [...sql.matchAll(new RegExp(`${name} constant text := \\$re\\$([\\s\\S]*?)\\$re\\$;`, "g"))]
        .map((m) => m[1]);
      expect(copies.length, `${name} not declared in the repair migration`).toBeGreaterThan(0);
      expect(new Set(copies).size, `${name} is declared ${copies.length} times with different bodies`).toBe(1);
    }
    const neg = grab("v_neg"), pos = grab("v_pos"), hyb = grab("v_hyb"), ons = grab("v_ons");
    const t = (re: RegExp, s: string) => { re.lastIndex = 0; return re.test(s); };
    const sqlStrip = (s: string) => { neg.lastIndex = 0; return s.replace(neg, " "); };
    /** What the migration would write, or UNCHANGED when its WHERE misses. */
    const sqlRule = (s: string): Mode | "UNCHANGED" => {
      if (!t(neg, s)) return "UNCHANGED";
      const stripped = sqlStrip(s);
      if (t(pos, stripped)) return "UNCHANGED";
      return t(hyb, stripped) ? "hybrid" : t(ons, stripped) ? "onsite" : null;
    };

    // The stripper itself agrees, phrase for phrase.
    for (const [title] of [...NEGATED, ...NOT_NEGATED]) {
      expect(sqlStrip(title), `stripper disagrees on "${title}"`).toBe(stripNegatedRemote(title));
    }
    // Every row the old code stored as remote and the new code no longer does
    // is repaired to exactly the value the new code computes.
    for (const [title, expected] of NEGATED) {
      expect(sqlRule(title), `the migration writes the wrong value for "${title}"`).toBe(expected);
    }
    // Of those, the ones the shipped code actually stored as remote — the rows
    // that are on the board right now — are repaired to the new value. (A
    // string like "Nonremote" has no word boundary for the old \bremote\b and
    // was never stored wrong; the migration's WHERE never reaches it.)
    const defectRows = NEGATED.filter(([title]) => detectWorkModePreFix(title) === "remote");
    expect(defectRows.length, "no NEGATED string reproduces the shipped defect")
      .toBeGreaterThanOrEqual(19);
    for (const [title, expected] of defectRows) {
      expect(sqlRule(title), `a live-defect row is not repaired: "${title}"`).toBe(expected);
    }
    // And a genuinely remote row is never touched.
    for (const [title, expected] of NOT_NEGATED) {
      if (expected !== "remote") continue;
      expect(sqlRule(title), `the migration would wrongly repair "${title}"`).toBe("UNCHANGED");
    }
  });

  it("the shared detector strips negations before it tests for remote", () => {
    // Behavioural, so it cannot be satisfied by a comment: the exported
    // stripper must actually remove the token the ladder would otherwise see.
    expect(stripNegatedRemote("NON-REMOTE")).not.toMatch(/remote/i);
    expect(stripNegatedRemote("PRN - Not Remote")).not.toMatch(/remote/i);
    expect(stripNegatedRemote("Fully Remote")).toMatch(/remote/i);
  });
});

// ── THE VENDOR'S OWN LABEL, NOT JUST THE TITLE ────────────────────────────
//
// The ARMS table above varies only the TITLE, so it could not see the defect
// a review found: `statedWorkMode(label) ?? detectWorkMode(text)` answers null
// for a label that NEGATES remote ("Non-Remote" — iCIMS's own location_type
// value), null is indistinguishable from "the vendor said nothing", and the
// `??` then handed the decision to the title. Measured on the real functions
// before the fix, both of these returned workMode "remote", remote true:
//   iCIMS  location_type "Non-Remote" + title "Remote Patient Monitoring RN"
//   Lever  workplaceType "Non-Remote" + title "Remote Support Engineer"
// The employer said not-remote and the board published Remote.
//
// The rule these assert: free text may NARROW a negated label (a title saying
// hybrid or onsite tells us which of the two it is), but it can never ANSWER
// "remote" over the employer's own negation.
describe("a vendor label that negates remote is never overridden by text", () => {
  const NEGATING_LABELS = ["Non-Remote", "Not Remote", "No Remote", "Non-Remote Posting"];

  const LABELLED: ReadonlyArray<readonly [string, (label: string, title: string, loc: string) => JobPosting[]]> = [
    ["icims", (label, title, loc) => normalizeIcims(
      [{ data: { req_id: "1", title, full_location: loc, location_type: label, apply_url: "https://acme.icims.com/jobs/1/login" } }] as never,
      "Acme", "acme")],
    ["lever", (label, title, loc) => normalizeLever(
      [{ id: "1", text: title, categories: { location: loc }, workplaceType: label, hostedUrl: "https://jobs.lever.co/acme/1" }] as never,
      "Acme", "acme")],
    ["ashby", (label, title, loc) => normalizeAshby(
      { jobs: [{ id: "1", title, location: loc, workplaceType: label, isRemote: true, jobUrl: "https://jobs.ashbyhq.com/acme/1" }] } as never,
      "Acme", "acme")],
  ];

  for (const [vendor, build] of LABELLED) {
    it(`${vendor}: a negating label beats a remote title`, () => {
      for (const label of NEGATING_LABELS) {
        // A title screaming REMOTE, and a location screaming REMOTE.
        for (const [title, loc] of [
          ["Remote Patient Monitoring RN", "Prudhoe Bay, AK"],
          ["Nurse", "Remote - US"],
          ["Fully Remote Support Engineer", "Remote"],
        ] as ReadonlyArray<readonly [string, string]>) {
          const row = build(label, title, loc)[0];
          expect(row, `${vendor} produced no posting for label "${label}"`).toBeDefined();
          expect(
            row.workMode,
            `${vendor} let the text override the employer's own "${label}" for "${title}" @ "${loc}"`,
          ).not.toBe("remote");
          expect(row.remote, `${vendor} boolean/trinary disagree under label "${label}"`)
            .toBe(row.workMode === "remote");
        }
        // …but a negated label plus text that states ONSITE still narrows to
        // onsite. Refusing "remote" is the rule; refusing everything is not.
        const narrowed = build(label, "Field Engineer (On-Site)", "Cleveland, OH")[0];
        expect(narrowed.workMode, `${vendor} refused to narrow a negated label with an onsite title`)
          .toBe("onsite");
      }
    });

    it(`${vendor}: an affirmative label is still honoured (the control)`, () => {
      const row = build("Remote", "Nurse", "Cleveland, OH")[0];
      expect(row.workMode, `${vendor} stopped believing a plain "Remote" label`).toBe("remote");
      expect(row.remote).toBe(true);
    });
  }
});

// ── THE GUARD'S BLAST RADIUS IS THE DIRECTORY, NOT ONE FILE ───────────────
//
// The source guards above read only normalize.ts, and the ARMS coverage test
// enumerates exported normalize* from that one file. A 21st vendor added as a
// new supabase/functions/job-board/vendors/*.ts file was invisible to all of
// them. That is not hypothetical: vendors/jazzhr.ts is already a real adapter
// that builds its own `remote:` field. It happens to be correct today, which
// is exactly why nothing failed and why the next vendor file could
// re-implement the ladder unseen.
describe("no vendor file anywhere grows its own work-mode ladder", () => {
  const VENDOR_DIR = resolve(__dirname, "../../supabase/functions/job-board/vendors");
  const files = readdirSync(VENDOR_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [f, resolve(VENDOR_DIR, f)] as const);

  it("there is at least one vendor file to sweep", () => {
    // If this ever reads zero the sweep below passes vacuously, which is the
    // failure mode of every guard this repo has lost.
    expect(files.length, "the vendors directory is empty — has it moved?").toBeGreaterThan(0);
  });

  for (const [name, path] of files) {
    const src = stripComments(readFileSync(path, "utf8"));

    it(`${name}: every remote: site is derived from that posting's own trinary`, () => {
      const sites = [...src.matchAll(/^\s*remote:\s*(.+?),\s*$/gm)].map((m) => m[1].trim());
      for (const site of sites) {
        expect(site, `${name} computes remote: from something other than its own trinary`)
          .toMatch(/^workMode === "remote"$/);
      }
    });

    it(`${name}: no substring or regex match on a work-mode word`, () => {
      for (const word of ["remote", "hybrid", "onsite", "office"]) {
        expect(
          src.includes(`.includes("${word}")`),
          `${name} matches "${word}" by substring — that is the shape of the defect`,
        ).toBe(false);
      }
    });

    it(`${name}: imports the shared detector rather than defining one`, () => {
      // A vendor file that mentions work modes at all must get them from
      // normalize.ts. A file that mentions none is fine.
      if (!/workMode|work_mode/.test(src)) return;
      expect(
        /from\s+"\.\.\/normalize\.ts"/.test(src),
        `${name} handles work modes without importing the shared detector`,
      ).toBe(true);
    });
  }
});

// ── THE READ SIDE MUST NOT INVERT THE SAME NEGATION ───────────────────────
//
// The third and last place "negations before positives" was missing.
// index.ts's INTENT_FILTERS lifts query phrases into filters, and its bare
// rule is /\bremote(?:ly)?\b/i — which matches INSIDE "non-remote", because
// the hyphen is a word boundary. For q="non-remote nurse" with no workMode or
// remote field in the body (so INTENT_CONFLICTS does not suppress the lift)
// the board applied workMode:"remote", deleted the word from the query, and
// DISCLOSED that it had applied a remote filter. A seeker who asked for
// non-remote work was served remote roles and told so.
//
// Note this also means B2's own proposed post-deploy probe — POST job-board
// {"q":"non-remote","workMode":"remote"} — could never have revealed it: an
// explicit workMode makes INTENT_CONFLICTS skip the lift entirely.
describe("the query-intent lift cannot turn a negation into its opposite", () => {
  const INDEX_PATH = resolve(__dirname, "../../supabase/functions/job-board/index.ts");
  const src = stripComments(readFileSync(INDEX_PATH, "utf8"));
  const block = src.slice(
    src.indexOf("const INTENT_FILTERS"),
    src.indexOf("const INTENT_CONFLICTS"),
  );

  it("INTENT_FILTERS was found and carries the bare remote rule", () => {
    expect(block.length, "INTENT_FILTERS not found in index.ts").toBeGreaterThan(100);
    expect(block).toMatch(/\\bremote\(\?:ly\)\?\\b/);
  });

  it("a negated-remote rule is consulted BEFORE any rule patching workMode remote", () => {
    const negAt = block.indexOf("NEGATED_REMOTE_SOURCE");
    expect(negAt, "no negated-remote rule in INTENT_FILTERS — a query of " +
      '"non-remote" is lifted to workMode:"remote"').toBeGreaterThanOrEqual(0);
    const firstRemotePatch = block.search(/patch:\s*\{\s*workMode:\s*"remote"\s*\}/);
    expect(firstRemotePatch, "no workMode remote patch found").toBeGreaterThanOrEqual(0);
    expect(
      negAt,
      "the negation rule sits AFTER a rule that patches workMode remote, so the " +
        "positive rule consumes the phrase first — order is the whole property",
    ).toBeLessThan(firstRemotePatch);
  });

  it("the negation rule patches nothing and is not global", () => {
    const rule = block.slice(block.indexOf("NEGATED_REMOTE_SOURCE"));
    const line = rule.slice(0, rule.indexOf("\n"));
    // Non-global: liftIntentFilters calls .test() then .replace() on the same
    // RegExp object, and a /g/ regex carries lastIndex between the two.
    expect(line, "the shared pattern must be rebuilt without the g flag")
      .toMatch(/NEGATED_REMOTE_SOURCE,\s*"i"/);
    expect(line, "the negation rule must patch nothing — the board has no " +
      "not-remote predicate to patch, and inventing one here would be a second " +
      "spelling of a filter that does not exist").toMatch(/patch:\s*\{\s*\}/);
  });

  it("the shared pattern actually consumes the phrase the bare rule would catch", () => {
    // Behavioural, so no comment can satisfy it: after the negation rule runs
    // its replace, the bare /\bremote\b/ rule must no longer match.
    const bare = /\bremote(?:ly)?\b/i;
    for (const q of ["non-remote nurse", "not remote analyst", "no remote work rn", "nurse (non remote)"]) {
      expect(bare.test(q), `precondition: the bare rule must match "${q}"`).toBe(true);
      const residual = q.replace(new RegExp(NEGATED_REMOTE_SOURCE, "gi"), " ");
      expect(bare.test(residual), `the bare remote rule still fires on "${q}" after the negation rule`)
        .toBe(false);
    }
    // And a genuinely remote query is untouched, so the lift still works.
    for (const q of ["remote nurse", "remotely managed analyst", "remote - no experience needed"]) {
      const residual = q.replace(new RegExp(NEGATED_REMOTE_SOURCE, "gi"), " ");
      expect(bare.test(residual), `the negation rule ate a genuinely remote query: "${q}"`).toBe(true);
    }
  });
});
