import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeFit, reachFactor, resumeRoleTerms, resumeYears, scanResume, REACH_MARGIN_YEARS,
} from "../../supabase/functions/_shared/fit-score.ts";
import {
  CHIEF_OF_STAFF, COURT_REPORTER, COURT_REPORTER_EXPECTED,
  TWO_YEAR_ENGINEER, SIXTEEN_YEAR_ENGINEER, SENIOR_RANGE_LINE, REACH_MIN_YEARS,
} from "../../scripts/fit-path-fixtures.mjs";

/**
 * THE PROBE MEASURED A CODE PATH NO VISITOR WAS ON.
 *
 * fit-terms and fit-batch left job-board for their own isolate, job-fit, on
 * 2026-09-03, and Jobs.tsx has invoked job-fit since. scripts/fit-path-probe.mjs
 * — the only live harness on the résumé drop — went on posting both actions to
 * job-board, the legacy copy kept for older bundles. Every "PASS" it printed
 * for a week was about the copy the site had stopped calling; a job-fit
 * deployed from a stale fit-score.ts, or answering 546 under load, would have
 * shown nothing.
 *
 * Three things are held here, and the first is a PROPERTY of the probe's
 * source with the comments stripped, because a guard that greps for a spelling
 * passes while the code is dead and fails when a comment quotes the old line:
 *
 *   1. Every fit-terms / fit-batch request in the probe goes through the
 *      helper bound to `${FNS}job-fit`, and none goes through the board helper.
 *      Proved to have teeth against the two lines that shipped before the fix.
 *   2. The probe's résumé fixtures give the LOCAL extractor the exact answers
 *      the probe demands of the DEPLOYED one, so a live failure means the
 *      bundle differs from the repo and not that the fixture was wrong.
 *   3. The reach fixture is a demotion the scorer can show from outside: the
 *      two copies differ in years and in nothing else the score reads.
 */

const PROBE = resolve(__dirname, "../../scripts/fit-path-probe.mjs");

/** Comments out, strings and code in. `//` after a colon is a URL, not a comment. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * The property, as a function, so the same predicate is run against the
 * shipped file and against the pre-fix excerpt. It reads REQUEST SITES: every
 * line that names one of the two actions must call the scorer helper, and no
 * such line may call the board helper.
 */
function fitRequestsGoToJobFit(src: string): { ok: boolean; sites: string[]; offenders: string[] } {
  const code = stripComments(src);
  const sites = code.split("\n").filter((l) => /action:\s*"fit-(terms|batch)"/.test(l));
  const offenders = sites.filter((l) => !/\bfit\(\s*\{/.test(l) || /\bboard\(\s*\{/.test(l));
  return { ok: sites.length >= 2 && offenders.length === 0, sites, offenders };
}

// ── The two request lines exactly as they shipped in the pre-fix probe, so
//    "the guard has teeth" is a measurement. Both went to `board`.
const PRE_FIX_EXCERPT = `
const scoreRows = async (cv, ids) => {
  const fb = await board({ action: "fit-batch", resumeText: cv, ids });
  const f = fb?.fits ?? {};
};
    terms = (await board({ action: "fit-terms", resumeText: spec.cv }))?.terms ?? [];
`;

describe("the probe points at the isolate the site uses", () => {
  const src = readFileSync(PROBE, "utf8");
  const code = stripComments(src);

  it("binds the scorer helper to job-fit, not job-board", () => {
    expect(code).toMatch(/const FIT = `\$\{FNS\}job-fit`/);
    expect(code).toMatch(/const fit = \(body, ms\) => post\(FIT, body, ms\)/);
    expect(code).toMatch(/const board = \(body, ms\) => post\(BOARD, body, ms\)/);
  });

  it("sends every fit-terms and fit-batch request through that helper", () => {
    const r = fitRequestsGoToJobFit(src);
    expect(r.offenders).toEqual([]);
    expect(r.ok).toBe(true);
    // Both actions are exercised, not just one.
    expect(r.sites.some((l) => l.includes('"fit-terms"'))).toBe(true);
    expect(r.sites.some((l) => l.includes('"fit-batch"'))).toBe(true);
  });

  it("has teeth: the pre-fix request lines fail the same property", () => {
    const r = fitRequestsGoToJobFit(PRE_FIX_EXCERPT);
    expect(r.ok).toBe(false);
    expect(r.offenders).toHaveLength(2);
  });

  it("is not satisfied by a comment that quotes the fix", () => {
    // A file whose only job-fit call sits in a comment is still on job-board.
    const decoy = `// const fb = await fit({ action: "fit-batch" });\n` + PRE_FIX_EXCERPT;
    expect(fitRequestsGoToJobFit(decoy).ok).toBe(false);
  });

  it("reads its résumés from the shared fixtures module, so the offline and live checks share bytes", () => {
    expect(code).toMatch(/from "\.\/fit-path-fixtures\.mjs"/);
    // Imported AND sent, not merely imported: the extractor fixtures go out
    // as fit-terms bodies, the reach fixtures through the fit-batch helper.
    for (const name of ["CHIEF_OF_STAFF", "COURT_REPORTER"]) {
      expect(code).toMatch(new RegExp(`resumeText: ${name}\\b`));
    }
    for (const name of ["TWO_YEAR_ENGINEER", "SIXTEEN_YEAR_ENGINEER"]) {
      expect(code).toMatch(new RegExp(`scoreRows\\(${name},`));
    }
  });

  it("counts every live call, so 'bounded' is a printed number", () => {
    expect(code).toMatch(/let calls = 0/);
    expect(code).toMatch(/calls\+\+/);
    expect(code).toMatch(/live calls: \$\{calls\}/);
  });
});

describe("the extractor fixtures have the answers the probe demands, locally", () => {
  it("are long enough that the headline window is a window and not the whole document", () => {
    expect(CHIEF_OF_STAFF.length).toBeGreaterThanOrEqual(300);
    expect(COURT_REPORTER.length).toBeGreaterThanOrEqual(300);
    expect(TWO_YEAR_ENGINEER.length).toBeGreaterThanOrEqual(300);
  });

  it("chief of staff: two headline lines, the title stated once more, and it leads", () => {
    const lines = CHIEF_OF_STAFF.split("\n");
    expect(lines[0]).toBe("Sam Rivera");
    expect(lines[1]).toBe("Chief of Staff");
    expect(CHIEF_OF_STAFF.toLowerCase().split("chief of staff").length - 1).toBe(2);
    expect(resumeRoleTerms(CHIEF_OF_STAFF, 4)[0]).toBe("chief of staff");
  });

  it("court reporter: the coined compound leads and the bare vocabulary word follows", () => {
    expect(COURT_REPORTER.split("\n")[0]).toBe("Helen Marsh, RPR — Court Reporter");
    expect(COURT_REPORTER).toContain("Court Reporter, Freelance 2014-2026");
    expect(resumeRoleTerms(COURT_REPORTER, 4).slice(0, 2)).toEqual(COURT_REPORTER_EXPECTED);
    expect(COURT_REPORTER_EXPECTED).toEqual(["court reporter", "reporter"]);
  });
});

describe("the reach fixture is a demotion the scorer can show from outside", () => {
  it("differs in years and in nothing else the score reads", () => {
    expect(SIXTEEN_YEAR_ENGINEER).toBe(TWO_YEAR_ENGINEER + SENIOR_RANGE_LINE);
    expect(SENIOR_RANGE_LINE).toContain("2010-2026");
    expect(resumeYears(TWO_YEAR_ENGINEER)).toBe(2);
    expect(resumeYears(SIXTEEN_YEAR_ENGINEER)).toBe(16);
    // The added line contributes no dictionary term: the résumé's breadth —
    // the precision denominator — is byte-identical either side.
    expect(scanResume(SIXTEEN_YEAR_ENGINEER).terms).toEqual(scanResume(TWO_YEAR_ENGINEER).terms);
  });

  it("an 8+-year row is past the margin for two years and inside it for sixteen", () => {
    expect(REACH_MIN_YEARS - 2 - REACH_MARGIN_YEARS).toBeGreaterThan(0);
    expect(reachFactor(REACH_MIN_YEARS, 2)).toBeLessThan(1);
    expect(reachFactor(REACH_MIN_YEARS, 16)).toBe(1);
  });

  it("scores the two-year copy strictly lower against a posting stating eight years", () => {
    const posting = "Senior Software Engineer. Minimum of 8 years of experience building backend " +
      "services in TypeScript or Go on Kubernetes and AWS. PostgreSQL, distributed systems, API design, " +
      "CI/CD, code review, mentoring junior engineers.";
    const two = computeFit(posting, scanResume(TWO_YEAR_ENGINEER), 40, REACH_MIN_YEARS).pct;
    const sixteen = computeFit(posting, scanResume(SIXTEEN_YEAR_ENGINEER), 40, REACH_MIN_YEARS).pct;
    expect(typeof sixteen).toBe("number");
    expect(sixteen as number).toBeGreaterThanOrEqual(2);
    expect(two as number).toBeLessThan(sixteen as number);
    // And without a stated minimum the two copies are the same score — the
    // demotion is the ONLY thing the added line changes.
    expect(computeFit(posting, scanResume(TWO_YEAR_ENGINEER), 40, null).pct)
      .toBe(computeFit(posting, scanResume(SIXTEEN_YEAR_ENGINEER), 40, null).pct);
  });
});
