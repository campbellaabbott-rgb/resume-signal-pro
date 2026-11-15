/**
 * POSTING TERMS CARRY NO EEO BOILERPLATE (connect W4, CJ-12).
 *
 * apply_myself handed the drafting AI "Terms the posting uses: ... veteran,
 * color" for a Workday posting (REQ-13889) and "ordinance" for another: the
 * fit scorer's dictionary walked the whole description, equal-opportunity
 * paragraph and benefits list included. An AI drafting from those reads them
 * as what the job asks for.
 *
 * Now the terms come from the description with its equal-opportunity, legal,
 * benefits, privacy and agency-notice SENTENCES taken out, never by dropping
 * words: a recruiter's "recruiting" and a paint lab's "color" in the duties
 * stay. They are labelled "skills and terms the posting uses (not form
 * questions)".
 *
 * Held to the corpus rule on 1,833 real postings (free-scan-wave-corpora/
 * recheck-_source; the whole comparison is in ~/.config/resumebooster/
 * seo-connect-build/corpora/posting-terms-boilerplate-2026-11-08.json):
 * every term main found that the filter drops was reviewed and sat only in
 * boilerplate. The 35 recorded here (fixtures/posting-terms-boilerplate-
 * 2026-11.json) start with the traps: duties that mention a diverse team, an
 * inclusive culture, Italian "dei", a disabilities office, GDPR as a skill,
 * the PTO (the patent office) and services "we offer".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeFit } from "../../supabase/functions/_shared/fit-score";
import { postingTermsOf, withoutBoilerplate } from "../../supabase/functions/_shared/self-apply";
import { postingTermsOf as v1TermsOf } from "../../supabase/functions/public-api/application";
import { applyMyselfAnswer, applyMyselfMarkdown } from "../../supabase/functions/agent-mcp/apply-myself";

const EEO =
  "Warehouse Associate. You will load trucks, run a forklift and keep inventory counts in our WMS. " +
  "We are an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, color, religion, sex, sexual orientation, gender identity, national origin, disability, or protected veteran status. " +
  "Pursuant to the San Francisco Fair Chance Ordinance, we will consider for employment qualified applicants with arrest and conviction records. " +
  "We are committed to diversity and inclusion. Benefits include medical, dental and vision insurance, a 401(k) and paid time off.";

describe("an equal-opportunity paragraph is not what the job asks for", () => {
  it("main read veteran, color and ordinance from it; the posting's terms do not", () => {
    const main = computeFit(EEO, "", 30).missing;
    expect(main).toEqual(expect.arrayContaining(["veteran", "color", "ordinance"]));
    const terms = postingTermsOf(EEO);
    for (const t of ["veteran", "color", "ordinance", "diversity", "inclusion", "benefits", "dental"]) expect(terms, t).not.toContain(t);
    expect(terms).toEqual(expect.arrayContaining(["forklift", "inventory"]));
  });

  it("/v1 serves the same terms", () => {
    expect(v1TermsOf(EEO)).toEqual(postingTermsOf(EEO));
  });

  it("sentences are judged, never words: a duty that says color or recruiting keeps it", () => {
    expect(postingTermsOf("Paint lab technician. Perform color matching on every batch and record results.")).toContain("color");
    expect(postingTermsOf("Recruiter. Own full-cycle recruiting for engineering roles and source candidates.")).toContain("recruiting");
    expect(withoutBoilerplate("Lead a diverse team of six engineers.")).toMatch(/diverse team/);
    expect(withoutBoilerplate("Trattamento dei dati per ETL e pipeline.")).toMatch(/ETL/);
  });

  it("an unpunctuated description is never dropped whole for one clause", () => {
    const blob = `${"python sql airflow dbt kubernetes ".repeat(40)}equal opportunity employer`;
    expect(postingTermsOf(blob).length).toBeGreaterThan(0);
  });

  it("the packet labels them as the posting's terms, not the form's questions", () => {
    const posting = { id: "workday:iko:1", title: "Driver", company: "IKO", location: null, pay: null, postedAt: null, applyUrl: "https://iko.wd3.myworkdayjobs.com/x", siteUrl: "https://resumebooster.work/jobs?job=workday:iko:1" };
    const md = applyMyselfMarkdown(applyMyselfAnswer(posting, { kind: "no-reader", vendor: "workday" }, postingTermsOf(EEO)));
    expect(md).toMatch(/Skills and terms the posting uses \(not form questions\): /);
    expect(md).not.toMatch(/Terms the posting uses:/);
    expect(md).not.toMatch(/\bveteran\b|\bcolor\b/);
  });
});

describe("never worse than main, on real postings", () => {
  type Row = { id: string; title: string; description: string; main: string[]; mayDrop: string[] };
  const FIX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/posting-terms-boilerplate-2026-11.json"), "utf8")) as { rows: Row[] };

  it("covers the traps and the heaviest boilerplate", () => {
    expect(FIX.rows.length).toBeGreaterThanOrEqual(30);
  });

  it.each(FIX.rows.map((r) => [r.id, r] as const))("%s keeps every term main found outside its boilerplate", (_id, r) => {
    const mine = postingTermsOf(`${r.title} ${r.description}`, 30);
    const dropped = r.main.filter((t) => !mine.includes(t));
    expect(dropped.filter((t) => !r.mayDrop.includes(t))).toEqual([]);
  });

  it("the traps keep their skills", () => {
    const row = (id: string) => FIX.rows.find((r) => r.id === id)!;
    const terms = (id: string) => postingTermsOf(`${row(id).title} ${row(id).description}`, 30);
    expect(terms("smartrecruiters:Extendi1:744000134420849")).toEqual(expect.arrayContaining(["etl", "pipeline"]));
    expect(terms("smartrecruiters:FORWARD:743999915522673")).toContain("prospecting");
    expect(terms("smartrecruiters:TEDConferencesLLC:744000143566026")).toContain("cross-functional");
    expect(terms("pinpoint:ksc:607590")).toContain("iso 27001");
  });
});
