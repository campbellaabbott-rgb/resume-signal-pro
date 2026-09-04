import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeFit, reachFactor, resumeYears, scanResume } from "../../supabase/functions/_shared/fit-score";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/_shared/industry-detection";
import { measureAll, report } from "./fixtures/cv-matching-harness";

/**
 * A JOB THAT ASKS FOR EIGHT YEARS, RANKED FIRST FOR A READER WITH TWO.
 *
 * The scorer read every word of a posting except the one that decides. Measured
 * on the offline corpus before this existed: a new graduate's CV scored the
 * Staff Software Engineer posting 37 and the Software Engineer II posting 35,
 * so the single job on the page that would not interview her came first. It is
 * not a near miss in the arithmetic — it is what deterministic keyword coverage
 * DOES, because a new graduate and a staff engineer write about the same
 * technologies and the junior document is shorter, which lifts its precision.
 *
 * Across the corpus, of every pair where one posting in the reader's own
 * occupation is within reach and another states a minimum they miss by more
 * than three years, the in-reach one ranked first 76% of the time. That is a
 * coin-flip presented as a ranking, and no amount of cross-field separation can
 * fix it, because both postings ARE the reader's field.
 *
 *                                        before   after
 *   in-reach beats out-of-reach            76%     100%
 *   R-precision over the scored page       94%      89%
 *
 * THE SECOND NUMBER MOVED THE WRONG WAY AND IT IS NOT AN ACCIDENT. Pushing an
 * unreachable job down its own occupation's list lets an unrelated job move up,
 * so the two measures pull against each other by construction. The trade was
 * chosen by sweeping the demotion curve rather than by taste — the table is in
 * fit-score.ts next to the constant — and what the residual loss looks like in
 * practice is a nurse's own Chief Nursing Officer posting, which asks fifteen
 * years of her nine, falling below a clinical row from another field. Both are
 * jobs she will not get; only one of them was ranked as though she could.
 *
 * BOTH INPUTS ARE READ, NEVER INFERRED. `min_years` is pulled from the
 * posting's own sentence by job-board/experience.ts and is null when the
 * posting does not say. The reader's side is read from employment date ranges
 * and explicit claims and is null when the document says nothing. Null on
 * either side means no adjustment at all — the honest-null rule this file has
 * always kept, applied to a second kind of missing information.
 */
const POSTING_8Y = `Staff Software Engineer, Platform. Set technical direction for our
  distributed systems: Kubernetes, Terraform, and the continuous integration and automated
  testing that gates every deploy. Write backend services in Go and Python. Own observability,
  monitoring and incident response for tier-one systems, and lead architecture and code review
  across teams. Requires a minimum of 8 years of professional software engineering experience,
  including deep PostgreSQL and API design work.`;
const POSTING_3Y = `Software Engineer, Backend. Build and operate backend services in Python
  and Go on Kubernetes. Own your services in production: observability, monitoring, on-call and
  incident response. Work with PostgreSQL, API design and distributed systems. We use Terraform
  for infrastructure as code and expect continuous integration with automated testing. Requires
  3 years of professional software engineering experience and a strong grounding in code review.`;
const NEW_GRAD = `Priya Raman — Junior Software Developer, Austin TX
Software Engineering Intern, Indeed, Summer 2025. Built an internal dashboard in React and
TypeScript. Wrote unit tests and took part in code review.
Teaching Assistant, Data Structures, 2024–2026. Office hours for 120 students.
Capstone, 2026: a URL shortener in Go backed by PostgreSQL, deployed with Docker, with
continuous integration and automated testing.
SKILLS: Python, Java, TypeScript, React, Go, PostgreSQL, Docker, unit testing, REST APIs`;
const VETERAN = `Jane Doe — Senior Software Engineer, Seattle WA
Senior Software Engineer, Stripe, 2018–2026. Payment APIs in TypeScript and Go. Led the
migration of the settlement pipeline onto Kubernetes. Introduced Terraform. Ran incident
response as on-call lead.
Software Engineer, Amazon, 2015–2018. AWS Lambda tooling in Python. Rebuilt the release path
around continuous integration with automated testing. PostgreSQL and API design.
SKILLS: TypeScript, Go, Python, PostgreSQL, Kubernetes, Terraform, observability, code review`;

describe("a job that asks for eight years and a reader with two", () => {
  it("stops the out-of-reach job outranking the one she can have", () => {
    const scan = scanResume(NEW_GRAD);
    const staff = computeFit(POSTING_8Y, scan, 40, 8).pct ?? 0;
    const mid = computeFit(POSTING_3Y, scan, 40, 3).pct ?? 0;
    expect(mid, `staff ${staff} vs mid ${mid} — before the demotion it was 37 vs 35`)
      .toBeGreaterThan(staff);
  });

  it("leaves the same two postings alone for someone who clears the bar", () => {
    // The demotion is about the reader, not the posting. An eleven-year
    // engineer sees both jobs exactly as the keyword score ranked them.
    const scan = scanResume(VETERAN);
    expect(scan.years).toBeGreaterThanOrEqual(8);
    expect(computeFit(POSTING_8Y, scan, 40, 8).pct).toBe(computeFit(POSTING_8Y, scan, 40, null).pct);
    expect(computeFit(POSTING_8Y, scan, 40, 8).reach).toBe(1);
  });

  it("treats a near miss as a stretch, not a mismatch", () => {
    // Three years short of the stated minimum is within reach and untouched:
    // people clear that bar every week and the board's own copy calls the
    // bottom tier "stretch" for exactly this.
    expect(reachFactor(8, 5)).toBe(1);
    expect(reachFactor(8, 4)).toBeLessThan(1);
    expect(reachFactor(20, 0)).toBeGreaterThanOrEqual(0.4);
  });

  it("does nothing at all when either side is silent", () => {
    // A posting that states no minimum and a résumé with no readable history
    // are both ordinary, and neither is evidence about the match.
    expect(reachFactor(null, 3)).toBe(1);
    expect(reachFactor(8, null)).toBe(1);
    const scan = scanResume(NEW_GRAD);
    expect(computeFit(POSTING_8Y, scan, 40, null).pct).toBe(computeFit(POSTING_8Y, scan, 40).pct);
  });

  it("keeps the honest null a null", () => {
    // The oldest rule in this file. A posting with no recognized terms is "we
    // could not read this", never "you are a bad match", and the new multiplier
    // must not be the thing that finally turns one into the other.
    const r = computeFit("...", scanResume(NEW_GRAD), 40, 8);
    expect(r.pct).toBeNull();
    expect(r.reach, "there is nothing to demote when there is nothing to score").toBe(1);
  });

  it("never demotes a real overlap all the way to zero", () => {
    // Rounding a genuine match down to 0 would print the one number this file
    // refuses to print without meaning it — the board renders 0 and null
    // differently, sorts them differently and captions them differently.
    //
    // THE FIXTURE HAS TO SCORE 1, or the assertion is free. The first draft used
    // the new graduate against the staff posting, whose demoted score is in the
    // twenties; deleting the floor left it passing. This is the padded-résumé
    // exploit document from fit-score-cannot-be-padded, which scores exactly 1
    // against a real posting, so a 0.4 multiplier is the difference between 1
    // and 0 and the floor is the only thing standing there.
    const dump = [...new Set(Object.values(INDUSTRY_KEYWORDS).flatMap((d) =>
      [d.primary, d.secondary, d.certifications, d.titles].flat().map((t) => String(t).toLowerCase().trim())
    ))].join(", ") + "\nWorked 2024-2026.";
    const scan = scanResume(dump);
    const posting = POSTING_8Y.replace("minimum of 8 years", "minimum of 20 years");
    expect(computeFit(posting, scan, 40, null).pct, "the fixture must sit at the rounding edge").toBe(1);
    expect(computeFit(posting, scan, 40, 20).pct, "a demoted 1 must not become a 0").toBe(1);
  });

  it("reads the reader's years, and reads them high rather than low", () => {
    // Every way this number can be wrong should make the reader look MORE
    // senior: an inflated estimate leaves a posting where the keyword score put
    // it, a deflated one buries a job they could have had.
    expect(resumeYears("Engineer, Acme 2015-2020. Engineer, Beta 2020-2026.")).toBe(11);
    expect(resumeYears("Twelve roles. I have 14 years of professional experience in logistics."))
      .toBe(14);
    // The larger of the two readings wins.
    expect(resumeYears("Analyst, Acme 2022-2024. I have 9 years of industry experience.")).toBe(9);
    expect(resumeYears("No dates here at all, just prose about the work."), "unreadable is null")
      .toBeNull();
  });

  it("the whole corpus, measured — this is the number the change is FOR", () => {
    const rows = measureAll();
    const ok = rows.reduce((a, m) => a + m.seniorityPairsOk, 0);
    const total = rows.reduce((a, m) => a + m.seniorityPairsTotal, 0);
    expect(total, "the corpus must still contain out-of-reach pairs to measure").toBeGreaterThan(8);
    expect(ok / total, `76% before this change\n${report(rows)}`).toBeGreaterThanOrEqual(1);
    // The measure that moved the other way is pinned too, so a later change
    // cannot quietly trade more of it away for seniority.
    const rp = rows.reduce((a, m) => a + m.rprecOk, 0) / rows.reduce((a, m) => a + m.rprecTotal, 0);
    expect(rp, `R-precision was 94% before, 89% after — no further\n${report(rows)}`)
      .toBeGreaterThanOrEqual(0.88);
  }, 30_000);

  it("the scorer is actually given the column", () => {
    // An adjustment that works in a unit test while fit-batch never reads
    // min_years is the ranking-is-not-finding bug in a new costume.
    const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-fit/index.ts"), "utf8");
    const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(CODE, "fit-batch must select the column").toMatch(/select\("id, description, min_years"\)/);
    expect(CODE, "and hand it to the scorer").toMatch(/computeFit\([^;]*, 40, minYears\)/);
    expect(CODE, "a non-number stays null rather than becoming 0")
      .toMatch(/typeof r\.min_years === "number" \? r\.min_years : null/);
    expect(CODE, "a row with no description still scores null").toMatch(/fits\[r\.id\] = null;/);
    // Why min_years and not experience_band, in the file that chose.
    expect(RAW, "the reason for reading years rather than the band must survive")
      .toMatch(/Deliberately NOT experience_band/);
  });

  it("keeps the swept table in the file that acts on it", () => {
    const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/fit-score.ts"), "utf8");
    expect(RAW, "the curve sweep is the argument for the constant").toMatch(/THE FLOOR WAS CHOSEN BY SWEEPING IT/);
    expect(RAW).toMatch(/floor 0\.40 base 0\.60\s+100\.0\s+88\.9/);
    const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(CODE, "the swept floor must be the one the code uses").toMatch(/Math\.max\(0\.4, 0\.6 - 0\.02 \* short\)/);
  });
});
