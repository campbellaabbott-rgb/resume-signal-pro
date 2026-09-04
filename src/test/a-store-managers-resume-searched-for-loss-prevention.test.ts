import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resumeRoleTerms } from "../../supabase/functions/_shared/fit-score";
import { measureAll, report } from "./fixtures/cv-matching-harness";

/**
 * A STORE MANAGER'S RÉSUMÉ SEARCHED THE BOARD FOR "LOSS PREVENTION".
 *
 * The go-to-market bug again, with a different word. Found by measurement
 * rather than by report: sixteen hand-labelled résumés spanning the
 * occupations the board actually serves (src/test/fixtures/cv-matching-corpus)
 * were run through the extractor, and two of them came back with a confident
 * wrong answer.
 *
 *   Dana Whitfield — Store Manager, Target        ->  q=loss prevention
 *   Helen Marsh, RPR — Freelance Court Reporter   ->  q=reporter
 *
 * The first is her department, not her job. The second is journalism, run on
 * behalf of a stenographer. Both are REAL queries returning REAL postings, so
 * nothing anywhere in the chain reads as broken — the reader sees a full board
 * of somebody else's career under a header saying it is theirs. That is why
 * `harmful` is counted apart from `top1` in the harness: an empty answer costs
 * a reader the upgrade, and a wrong one costs them the board.
 *
 * TWO CAUSES SURVIVED MEASUREMENT — a third fix was built, shown to change
 * nothing, and deleted rather than shipped on plausibility.
 *
 * 1. HER OWN TITLE WAS DELETED BEFORE THE RANKING RAN. "engineer" inside
 *    "software engineer" is the same claim less precisely, so anything
 *    contained in a longer match is dropped. But "store manager" is inside
 *    "assistant store manager" — a junior job she left in 2021 — and the rule
 *    deleted the title she has now in favour of the one she was promoted out
 *    of. With her own title gone, the best remaining candidate was a skill.
 *    "assistant" and "associate" join GRADE_PREFIXES, so the pair collapses to
 *    the broader real occupation the way "journeyman electrician" already did.
 *
 * 2. THE VOCABULARY HAD NO WORD FOR HER, SO IT USED SOMEBODY ELSE'S. Three of
 *    the sixteen résumés name an occupation the frozen dictionary does not
 *    carry. Two resolved to nothing, which is correct. The court reporter
 *    resolved to "reporter". The compound is now read out of the headline when
 *    the dictionary's own counts say the bare word cannot stand for it — and
 *    the bare word is KEPT as the runner-up chip, because a coined term is a
 *    guess and the reader must be able to undo it in one click.
 *
 * MEASURED, before and after, over the whole corpus:
 *
 *                       before   after
 *   terms[0] correct     11/16   15/16
 *   correct anywhere     12/16   15/16
 *   terms[0] harmful      2/16    0/16
 *
 * The dictionary is frozen at v9 and feeds industry detection, so it is not
 * edited: every rule here lives in fit-score.ts, the one place that turns that
 * dictionary into search queries, and every one of them is derived from the
 * dictionary's own counts rather than from a list somebody typed.
 */
const PAD = `
EXPERIENCE
Led the team, owned the plan and the budget, hired and coached staff, and reported weekly.
Built the process from nothing and ran it across three sites over four years.
SKILLS: leadership, scheduling, budgeting, communication, training
EDUCATION: BS, State University 2012`;

describe("a store manager's résumé searched for loss prevention", () => {
  it("returns the job she has, not the department she owns", () => {
    const t = resumeRoleTerms(`Dana Whitfield — Store Manager, Columbus OH
dana.whitfield@example.com

Store Manager, Target, 2021–2026
Own sales, staffing, scheduling, merchandising, inventory and loss prevention. Cut shrink
from 1.8% to 0.9%. Hired and developed four team leads into supervisory roles.

Assistant Store Manager, Old Navy, 2019–2021
Point of sale operations, visual merchandising, returns and inventory counts.

SKILLS: retail operations, point of sale, merchandising, inventory, loss prevention, shrink`);
    expect(t[0], "the query the client runs is the headline role").toBe("store manager");
    expect(t[0]).not.toBe("loss prevention");
  });

  it("a junior title from the history does not delete the current one", () => {
    // The containment rule read "store manager" as the vague way of saying
    // "assistant store manager". It is the other way round: she was promoted.
    const promoted = resumeRoleTerms(`Dana Whitfield — Store Manager, Columbus OH
Store Manager, Target, 2021–2026. Sales, staffing and scheduling for a 90-person store.
Assistant Store Manager, Old Navy, 2019–2021. Point of sale and visual merchandising.
SKILLS: retail operations, merchandising, inventory, scheduling, payroll, hiring`);
    expect(promoted).toContain("store manager");
    expect(promoted).not.toContain("assistant store manager");
  });

  it("and a reader who has only ever been the assistant is widened, like every other grade", () => {
    // The first draft of this test asserted the opposite, on the strength of
    // the GRADE_PREFIXES comment claiming the strip "fires only where the
    // remainder is ITSELF a title this résumé claimed". For a SUFFIX that
    // condition is free: a document containing "assistant store manager"
    // contains "store manager", exactly as one containing "journeyman
    // electrician" contains "electrician". So the strip always widens, which is
    // what the live pool counts in that same comment argue for — 1,181
    // electrician openings against 139 journeyman ones — and what every grade
    // already did before "assistant" was added to the list.
    const t = resumeRoleTerms(`Rae Lindqvist — Assistant Store Manager, Boise ID
Assistant Store Manager, Old Navy, 2019–2026. Point of sale, visual merchandising, returns,
inventory counts, opening and closing. Coached six sales associates through their first year.
SKILLS: point of sale, merchandising, inventory, scheduling, customer service` + PAD);
    expect(t[0]).toBe("store manager");
    expect(t, "the narrower query would show her a fraction of her own market").not.toContain("assistant store manager");
  });

  it("survives a headline whose skill words are pushed in front of the title", () => {
    // A SECOND FIX WAS BUILT FOR THIS CASE AND THEN DELETED. Inside the
    // 400-character headline window a bullet competes with the name line on
    // equal terms, so a tier for the first two lines is the obvious next move.
    // It was written, and mutation-testing it showed it changed NOTHING: the
    // term list for all sixteen labelled résumés was byte-identical with the
    // tier and without it, because the grade strip already rescues the case.
    // The tier is gone; this fixture stays, because it is the shape the tier
    // was for and it has to keep working without it.
    const t = resumeRoleTerms(`Priya Raman — Store Manager, Austin TX
priya.raman@example.com

Ran loss prevention, loss prevention audits and loss prevention training for the district.
Store Manager, H-E-B, 2020–2026. Sales, staffing, merchandising and inventory.
SKILLS: loss prevention, shrink, merchandising, inventory, scheduling` + PAD);
    expect(t[0]).toBe("store manager");
  });

  it("a court reporter is not a reporter", () => {
    const t = resumeRoleTerms(`Helen Marsh, RPR — Freelance Court Reporter, Sacramento CA
helen.marsh@example.com

Freelance Court Reporter, 2016–2026
Verbatim stenographic records of depositions, arbitrations and hearings. Realtime translation
at 240 words per minute. Certified transcripts on a 48-hour turnaround.

Official Reporter, Sacramento County Superior Court, 2014–2016
SKILLS: stenotype, realtime translation, transcript production, exhibit handling`);
    expect(t[0], "her headline said it and the vocabulary did not").toBe("court reporter");
    expect(t, "the vocabulary word stays as the runner-up chip, one click away").toContain("reporter");
    expect(t.indexOf("court reporter")).toBeLessThan(t.indexOf("reporter"));
  });

  it("a coined compound never deletes the word it was built from", () => {
    // This is the whole reason coining is safe. "mig welder" is a guess about
    // an occupation the dictionary does not model; "welder" is the fallback,
    // and the client renders it as a chip the reader can press.
    const t = resumeRoleTerms(`Tomas Vega — MIG Welder and Fabricator, Toledo OH
MIG Welder, Libbey Manufacturing, 2019–2026. Short-run production and custom fabrication in
mild steel, stainless and aluminium. Weld symbols, fit-up, AWS D1.1, plasma cutting.
SKILLS: MIG, TIG, flux core, stick, blueprint reading, grinding, press brake, OSHA` + PAD);
    expect(t[0]).toBe("mig welder");
    expect(t).toContain("welder");
  });

  it("leaves a bare word alone when the dictionary builds titles on it", () => {
    // "teacher" heads eleven titles in the vocabulary, so it is an occupational
    // category and "school teacher" would only narrow the board. "reporter"
    // heads none, which is the difference the counts are read for.
    const t = resumeRoleTerms(`Amanda Cho — Elementary School Teacher, Portland OR
3rd Grade Teacher, Portland Public Schools, 2018–2026. Standards-aligned instruction in
literacy and math. Elementary school teacher of the year, 2024.
SKILLS: lesson planning, classroom management, differentiated instruction, IEPs` + PAD);
    expect(t[0]).toBe("teacher");
    expect(t).not.toContain("school teacher");
  });

  it("refuses to coin an occupation out of a rank or a state", () => {
    // "veteran" heads zero titles, which is exactly why the stoplist carries
    // it, and the same count refuses to build "army veteran" out of it. The
    // original stoplist and this rule agree because they read the same table.
    const t = resumeRoleTerms(`Sam Ortiz
U.S. Army veteran — Army veteran, Fort Bragg
SUMMARY
Fifteen years leading teams and budgets across three sites. Managed logistics for a
200-person unit, oversaw vendor contracts, and directed daily operations end to end.`);
    expect(t).not.toContain("army veteran");
    expect(t).not.toContain("veteran");
  });

  it("refuses to coin an occupation out of a name that happened to sit there", () => {
    // A parsed PDF loses its punctuation, so "Campbell Abbott Manager" is a
    // real shape. A real résumé states its occupation in the headline AND in
    // the employment history; a chance adjacency appears once.
    const t = resumeRoleTerms(`Campbell Abbott Manager Seattle WA
campbell@example.com
Ran the operations function from three people to nineteen. Owned forecasting, budgeting
and vendor management across support, billing and trust and safety.` + PAD);
    expect(t).not.toContain("abbott manager");
  });

  it("gives an occupation the vocabulary only carries as somebody else's compound", () => {
    // Bare "manager" is stoplisted and "project manager" is in the dictionary
    // only as "project manager construction" and "telecom project manager", so
    // this reader used to resolve to nothing at all.
    const t = resumeRoleTerms(`Elena Petrov — Project Manager, Boston MA
Project Manager, Iron Mountain, 2021–2026. Scope, schedule, budget, risk and stakeholder
communication for eleven client implementations. Weekly status reporting to executives.
SKILLS: project planning, risk register, Jira, Smartsheet, MS Project, Scrum` + PAD);
    expect(t[0]).toBe("project manager");
  });

  it("still says nothing rather than guessing", () => {
    // The honest empty answer is not collateral damage of the new rules — it is
    // still the answer for a document with no occupation the engine can read.
    // A clinical dietitian gets nothing, and nothing is correct: the client
    // then ranks what is on screen and says so.
    expect(resumeRoleTerms("")).toEqual([]);
    expect(resumeRoleTerms("too short")).toEqual([]);
    const dietitian = resumeRoleTerms(`Robin Achebe, RD, LD — Clinical Dietitian, Minneapolis MN
Clinical Dietitian, Hennepin Healthcare, 2018–2026. Nutrition assessments for inpatients on
the renal and diabetes services. Enteral and parenteral nutrition recommendations.
SKILLS: medical nutrition therapy, therapeutic diets, malnutrition criteria` + PAD);
    expect(dietitian).toEqual([]);
  });

  it("the whole corpus, measured — this is the number the change is FOR", () => {
    // A rule that fixes its own fixture is worth nothing. The floors here are
    // the measured after-numbers; the before-numbers were 11, 12 and 2.
    const rows = measureAll();
    const top1 = rows.filter((m) => m.top1Ok).length;
    const any = rows.filter((m) => m.anyOk).length;
    const harmful = rows.filter((m) => m.harmful).length;
    expect(harmful, `a wrong occupation is worse than no occupation\n${report(rows)}`).toBe(0);
    expect(top1, `terms[0] was correct 11/16 before this change\n${report(rows)}`).toBeGreaterThanOrEqual(15);
    expect(any).toBeGreaterThanOrEqual(15);
  }, 30_000);

  it("keeps the evidence in the file that acts on it", () => {
    // The head-noun counts are the reason a bare word is trusted or refused,
    // and they are derived rather than authored. If the table goes, the next
    // reader has a threshold with no argument behind it.
    const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/fit-score.ts"), "utf8");
    expect(RAW, "the derived head-noun counts must stay next to the rule").toMatch(/manager 175\s+engineer 140/);
    expect(RAW).toMatch(/veteran 0\s+server 0\s+doctor 0/);
    const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    // Pinning the exemption in CODE, because writing it in a comment is how
    // this repository has failed a guard four times.
    expect(CODE, "a coined compound must not delete its own fallback").toMatch(/!b\.coined/);
    expect(CODE, "the compound rule must read the counts, not a hand-written list").toMatch(/HEAD_COUNTS\.get\(head\)/);
  });
});
