import { describe, expect, it } from "vitest";
import { computeFit } from "../../supabase/functions/_shared/fit-score.ts";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/_shared/industry-detection.ts";

/**
 * A RÉSUMÉ THAT CLAIMS EVERYTHING SCORED 100% AGAINST EVERY JOB.
 *
 * The score was `matched / postingTerms` — pure recall. It asked only what
 * share of the JOB's terms appeared somewhere in the résumé, and nothing about
 * how much of the résumé was about that job. So padding was free, and a
 * document containing every term the scorer knows matched ~100% of every
 * posting, in every field.
 *
 * Measured on 25 live "software engineer" and 15 live "registered nurse"
 * postings, four résumés describing the same nine-year career:
 *
 *                        OLD (recall)   NEW (F1)
 *   prose SWE                  11.4        13.5
 *   same career, skills list   37.4        32.8
 *   the dictionary itself     100.0         1.4   <- 25/25 "strong" -> 25/25 "stretch"
 *   nurse résumé (control)      1.8         2.0
 *
 * The precision term is what closes it: a padded document answers any one job
 * with a vanishing fraction of itself.
 *
 * WHAT THIS TEST PROTECTS, in order of importance:
 *   1. Padding must never beat a real résumé. That is the exploit.
 *   2. Cross-field separation must survive. It was the thing most at risk from
 *      adding precision, and a fix that broke it would be a worse product.
 *   3. The explanation must survive. matched/missing are the actual deliverable
 *      — a bare number is what the methodology page promises not to ship.
 */
const DICTIONARY_DUMP = (() => {
  const set = new Set<string>();
  for (const data of Object.values(INDUSTRY_KEYWORDS)) {
    for (const list of [data.primary, data.secondary, data.certifications, data.titles]) {
      for (const term of list) {
        const t = String(term).toLowerCase().trim();
        if (t.length >= 3) set.add(t);
      }
    }
  }
  return [...set].join(", ");
})();

/** A real posting, condensed — enough recognized terms to score against. */
const SWE_POSTING = `
  Senior Software Engineer, Platform. You will design and operate distributed
  systems on Kubernetes, own our Terraform infrastructure as code, build backend
  services in Python and Go, and improve our continuous integration and
  automated testing. Experience with PostgreSQL, observability, monitoring and
  incident response required. You will mentor engineers and take part in code
  review and architecture decisions.`;

const SWE_PROSE = `
  Senior engineer with nine years on payment infrastructure. Led the migration of
  our settlement pipeline onto Kubernetes, cutting median latency from 400ms to
  90ms. Introduced Terraform so environments stopped drifting, and rebuilt the
  release path around continuous integration with automated testing. Four years
  writing backend services in Python and Go. Instrumented services for
  observability after an outage; ran incident response as on-call lead.`;

const NURSE = `
  Registered Nurse, nine years. Patient care, acute care, ICU, telemetry,
  medication administration, IV therapy, wound care, triage, care planning,
  electronic health records, HIPAA, infection control, BLS, ACLS, patient
  education, discharge planning, clinical documentation.`;

describe("the fit score cannot be gamed by padding", () => {
  it("scores a dictionary dump BELOW a real résumé for the same job", () => {
    const real = computeFit(SWE_POSTING, SWE_PROSE).pct ?? 0;
    const padded = computeFit(SWE_POSTING, DICTIONARY_DUMP).pct ?? 0;
    expect(
      padded < real,
      `A résumé containing every known term scored ${padded} against a real ` +
        `résumé's ${real}. Under the old recall-only formula the padded one ` +
        `scored 100 on every posting in every field. The score must include a ` +
        `term for how much of the RÉSUMÉ is about this job.`,
    ).toBe(true);
  });

  it("keeps a dictionary dump out of the strong tier", () => {
    // The board renders >=20 as "strong". Padding must not reach it.
    const padded = computeFit(SWE_POSTING, DICTIONARY_DUMP).pct ?? 0;
    expect(padded, "a padded résumé must not read as a strong match").toBeLessThan(20);
  });

  it("still separates fields — the property most at risk from this fix", () => {
    // Adding precision could have depressed genuine matches toward the noise
    // floor. Measured across 40 live postings it did not; this pins it.
    const onTopic = computeFit(SWE_POSTING, SWE_PROSE).pct ?? 0;
    const offTopic = computeFit(SWE_POSTING, NURSE).pct ?? 0;
    expect(onTopic).toBeGreaterThan(offTopic);
    expect(offTopic, "a nurse résumé must not read as a strong software match").toBeLessThan(20);
  });

  it("still explains itself", () => {
    // The number is not the product; "you're missing X, Y, Z" is.
    const r = computeFit(SWE_POSTING, SWE_PROSE);
    expect(r.matched.length, "no matched terms — the explanation is gone").toBeGreaterThan(0);
    expect(r.missing.length, "no missing terms — the gap list is gone").toBeGreaterThan(0);
    expect(r.totalRecognized).toBe(r.matched.length + r.missing.length);
  });

  it("exposes coverage and precision separately", () => {
    // Both are needed to explain a score honestly: a low number can mean "you
    // answer little of this job" or "this job is a small part of you", and
    // those deserve different copy.
    const r = computeFit(SWE_POSTING, SWE_PROSE);
    expect(r.coverage).toBeGreaterThan(0);
    expect(r.precision).toBeGreaterThan(0);
    expect(r.coverage).toBeLessThanOrEqual(1);
    expect(r.precision).toBeLessThanOrEqual(1);
  });

  it("returns null, not zero, when a posting has no recognized terms", () => {
    // Unchanged behaviour, pinned because the new early-return path touches it.
    // null means "we could not score this"; 0 would mean "you are a bad match",
    // and the board sorts and labels those differently.
    expect(computeFit("...", SWE_PROSE).pct).toBeNull();
  });
});
