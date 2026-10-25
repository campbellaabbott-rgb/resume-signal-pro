/**
 * WHO ANSWERS EACH APPLICATION QUESTION, MEASURED ON 1,536 LABELS (wave 4 fix 3).
 *
 * WHAT WAS WRONG. Two rounds of fixes to the work-done and motivation rules
 * each covered the spellings a reviewer listed, and each recheck broke them
 * with new ones: an ask joined by "&" or "/" ("Describe your experience in
 * sales & current visa status"), a paraphrase ("... and how many weeks'
 * notice is required", "... and someone we may call about it"), or a hint
 * ("Mention your notice."). apply_myself and /v1 told the person's AI to
 * draft each of them.
 *
 * THE CORPUS. fixtures/w4b-fix3-questions/corpus.json: 1,092 distinct real
 * labels from 88 employers' public application forms (Greenhouse, Lever,
 * Recruitee), every input of both rechecks, the round-1 review's labels, the
 * controls the earlier tests pin, and every S12-081 ask under each joiner.
 * Each row is labelled by hand with the answer and the reason; the fixture's
 * "about" block states the policy. Each row also records what origin/main,
 * fa66a031 and 9af3c783 did with it, measured by running their code.
 *
 * WHAT HOLDS NOW (the real modules, run over every row):
 *   - no row labelled person is drafted (9af3c783 drafted 108 of them);
 *   - every row is answered as labelled, except the rows listed in
 *     OVER_ROUTED below, all draftable work or motivation questions this rule
 *     sends to the person (the safe side), each with its reason;
 *   - so on every row where origin/main was right, this rule is right too,
 *     except those listed rows;
 *   - the worker's copy of the work-done rule gives the same verdict on every
 *     label, from the same pattern sources.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as server from "../../supabase/functions/_shared/application-questions";
import { whoAnswers } from "../../supabase/functions/_shared/self-apply";
import * as worker from "../../worker/src/questions/protected.js";

type Verdict = "draft" | "person";
type Row = {
  id: string; set: string; label: string; hint?: string; expect: Verdict; kind: string; reason?: string;
  ambiguous?: boolean; was: { main: Verdict; fa66: Verdict; r2: Verdict };
};
const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-questions/corpus.json"), "utf8")) as { rows: Row[] };
const ROWS = FIXTURE.rows;

/**
 * Draftable questions this rule still sends to the person. The AI drafts only
 * questions whose opening it recognises as a résumé prompt naming the work or
 * as a motivation question (self-apply.ts, default-deny). These are open work
 * or motivation questions in other words: "Tell us about a time ...", "How do
 * you approach ...", "Why <employer>?", "What is your core technical stack?".
 * The first shipped version of apply_myself (e21baaf4) already sent 62 of
 * them to the person, as did fa66a031 and 9af3c783. Widening the openings
 * would draft open questions the fact lists cannot fully screen ("Tell us
 * about a time you overcame a personal hardship"), so the rule keeps the safe
 * default. real-0946 is the one-ask rule: its second sentence is a question.
 */
const NOT_A_RECOGNISED_OPENING = [
  "real-0008", "real-0052", "real-0214", "real-0215", "real-0227", "real-0229", "real-0278", "real-0290", "real-0306",
  "real-0337", "real-0358", "real-0474", "real-0510", "real-0548", "real-0590", "real-0594", "real-0633", "real-0636",
  "real-0655", "real-0656", "real-0665", "real-0681", "real-0686", "real-0689", "real-0691", "real-0706", "real-0707",
  "real-0709", "real-0712", "real-0720", "real-0741", "real-0746", "real-0771", "real-0773", "real-0777", "real-0784",
  "real-0828", "real-0833", "real-0834", "real-0835", "real-0847", "real-0848", "real-0875", "real-0897", "real-0940",
  "real-0941", "real-0945", "real-0966", "real-0967", "real-0973", "real-0976", "real-0996", "real-1020", "real-1022",
  "real-1026", "real-1035", "real-1036", "real-1037", "real-1070", "real-1084",
];
/** Non-English motivation and work questions: the fact lists are English, so a model may not draft them. */
const NOT_ENGLISH = ["real-0977", "real-0982", "real-0128"];
/** A second sentence that is a question keeps the whole label with the person (the one-ask rule). */
const SECOND_QUESTION = ["real-0946"];
const OVER_ROUTED = new Set([...NOT_A_RECOGNISED_OPENING, ...NOT_ENGLISH, ...SECOND_QUESTION]);

const verdictOf = (r: Row): Verdict =>
  whoAnswers({ label: r.label, required: true, type: "textarea", ...(r.hint ? { hint: r.hint } : {}) }, 1).answeredBy === "draft_from_your_cv"
    ? "draft"
    : "person";

describe("the corpus is what it says", () => {
  it("holds at least 300 real labels and every recheck input", () => {
    expect(ROWS.filter((r) => r.set === "real").length).toBeGreaterThanOrEqual(1000);
    expect(ROWS.filter((r) => r.set === "recheck1").length).toBe(11);
    expect(ROWS.filter((r) => r.set === "recheck2").length).toBe(22);
    expect(ROWS.filter((r) => r.set === "review16").length).toBe(16);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length);
  });

  it("every listed over-routed row is a draftable work or motivation question", () => {
    for (const id of OVER_ROUTED) {
      const r = ROWS.find((x) => x.id === id);
      expect(r, id).toBeDefined();
      expect(r!.expect, id).toBe("draft");
      expect(["work", "motivation"], id).toContain(r!.kind);
    }
  });
});

describe("no question labelled the person's is drafted", () => {
  const persons = ROWS.filter((r) => r.expect === "person");
  it.each(persons.map((r) => [r.id, r.label.slice(0, 110), r] as const))("%s %s", (_id, _l, r) => {
    expect(verdictOf(r)).toBe("person");
  });
});

describe("every draftable question is drafted, except the listed over-routed rows", () => {
  const drafts = ROWS.filter((r) => r.expect === "draft");
  it.each(drafts.map((r) => [r.id, r.label.slice(0, 110), r] as const))("%s %s", (id, _l, r) => {
    expect(verdictOf(r)).toBe(OVER_ROUTED.has(id) ? "person" : "draft");
  });
});

describe("never worse than origin/main", () => {
  it("on every row origin/main answered right, this rule does too, except the listed over-routed rows", () => {
    const worse = ROWS.filter((r) => r.was.main === r.expect && verdictOf(r) !== r.expect).map((r) => r.id);
    expect(worse.filter((id) => !OVER_ROUTED.has(id))).toEqual([]);
  });

  it("better than 9af3c783 on every row 9af3c783 got wrong but one listed row, and worse on none", () => {
    expect(ROWS.filter((r) => r.was.r2 === r.expect && verdictOf(r) !== r.expect).map((r) => r.id)).toEqual([]);
    const stillWrong = ROWS.filter((r) => r.was.r2 !== r.expect && verdictOf(r) !== r.expect).map((r) => r.id);
    expect(stillWrong.every((id) => OVER_ROUTED.has(id))).toBe(true);
  });
});

describe("the worker reads every corpus label the same way", () => {
  it("from the same pattern sources", () => {
    const w = worker as unknown as Record<string, RegExp>;
    const s = server as unknown as Record<string, RegExp>;
    for (const name of ["PROTECTED_FACTUAL", "PERSONAL_HISTORY", "FACTUAL", "PERSON_ASKS", "PERSON_FACT_NOUNS", "PERSON_FACT_WORDS", "PERSON_STATE", "SECOND_ASK", "CLAUSE_BREAK", "NO_OBJECT", "QUESTION_AUX", "ASK_WORDS", "PERSON_CIRCUMSTANCE", "ADDRESSES_PERSON", "WORK_PAST", "WORK_CLAUSE", "MOTIVE_CLAUSE", "RESUME_PROMPT", "ABOUT_WORK_DONE", "OWN_STATUS", "SENTENCE_BREAK"]) {
      expect(w[name], name).toBeInstanceOf(RegExp);
      expect([w[name].source, w[name].flags], name).toEqual([s[name].source, s[name].flags]);
    }
    expect(worker.TOPICS.map(([t, re]) => [t, re.source, re.flags])).toEqual(server.TOPICS.map(([t, re]) => [t, re.source, re.flags]));
  });

  it("with the same verdict on every label", () => {
    const differ = ROWS.filter((r) => {
      const l = server.cleanQuestionLabel(r.label);
      return worker.asksAboutWorkDone(l) !== server.asksAboutWorkDone(l) || worker.topicOf(l) !== server.topicOf(l) || worker.mentionsPersonFact(l) !== server.mentionsPersonFact(l);
    }).map((r) => r.id);
    expect(differ).toEqual([]);
  });

  it("and never sends a model's draft into a label the server drafts nothing for", () => {
    // The worker refuses a drafted answer for a protected label; every label
    // apply_myself drafts must be one the worker would also fill.
    const refused = ROWS.filter((r) => verdictOf(r) === "draft" && worker.isProtectedQuestion(server.cleanQuestionLabel(r.label))).map((r) => r.id);
    expect(refused).toEqual([]);
  });
});
