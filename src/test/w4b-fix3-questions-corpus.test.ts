/**
 * WHO ANSWERS EACH APPLICATION QUESTION, MEASURED ON 2,385 LABELS (wave 4 fix rounds 3 and 4).
 *
 * WHAT WAS WRONG. Round 3 made a later clause addressed to the person theirs
 * and measured 0 person questions drafted on its 1,536 rows. Its recheck then
 * drafted facts in words no list held, in clauses that did not say "you"
 * ("... and any DUIs", "... and why it ended", "... including total
 * earnings"), facts in hints, a second ask on a new line, and "How many years
 * of X experience without a DUI conviction?" (a regression from origin/main:
 * the widened years opening let the fact through). At the classifier it
 * refused motivation questions that named "full-time" (another regression).
 *
 * THE RULE NOW. Every later clause, later sentence and hint sentence is
 * default-deny: it is drafted only when it is visibly work (told with a verb
 * of work, or made of work words) or motivation; "any <noun that is not
 * work>" is an ask; a fact is the work's object only when a work verb or work
 * noun governs it, never after "as a", "on a", "without", "since" or
 * "during". A line break, a colon, a bracket and a second "your" start new
 * parts. Words that also name a job ("full-time", "eligibility", "visa") count
 * only after the opening ask and never at the classifier.
 *
 * THE CORPUS (fixtures/w4b-fix3-questions/corpus.json): round 3's 1,536 rows,
 * the round-3 rechecker's 643 rows and 51 follow-up probes, round 3's 200
 * self-break inputs and the recheck-3 findings' labels, each labelled by hand.
 * Measured (each version's verdict is in the fixture):
 *   whoAnswers: origin/main 1,163 right, 237bf2e8 2,060 (95 person rows
 *   drafted), this rule 2,195 (0 person rows drafted, 190 draftable rows sent
 *   to the person: the safe side, each marked overRoute);
 *   classifier: origin/main 913 of 1,626, 237bf2e8 1,254 (worse than main on
 *   40), this rule 1,307 (worse than main on 0).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as server from "../../supabase/functions/_shared/application-questions";
import { whoAnswers } from "../../supabase/functions/_shared/self-apply";
import * as worker from "../../worker/src/questions/protected.js";

type Verdict = "draft" | "person";
type Row = {
  id: string; set: string; label: string; hint?: string; expect: Verdict; textExpect: Verdict; expectCls: "draftable" | "refuse" | "identity" | null;
  kind: string; reason: string; ambiguous?: boolean; overRoute?: string;
  was: Record<"main" | "fa66a031" | "9af3c783" | "237bf2e8", Verdict>; wasCls: Record<"main" | "237bf2e8", string>;
};
const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-questions/corpus.json"), "utf8")) as { rows: Row[] };
const ROWS = FIXTURE.rows;

const verdictOf = (r: Row): Verdict =>
  whoAnswers({ label: r.label, required: true, type: "textarea", ...(r.hint ? { hint: r.hint } : {}) }, 1).answeredBy === "draft_from_your_cv"
    ? "draft"
    : "person";
const clsOk = (r: Row, cls: string) => (r.expectCls === "draftable" ? cls === "draftable" : r.expectCls === "identity" ? cls === "identity" : cls !== "draftable");

describe("the corpus is what it says", () => {
  it("holds at least 300 real labels, every recheck input and both self-break sets", () => {
    expect(ROWS.filter((r) => r.set === "r3-builder:real").length).toBeGreaterThanOrEqual(1000);
    expect(ROWS.filter((r) => r.set === "r3-builder:recheck1").length).toBe(11);
    expect(ROWS.filter((r) => r.set === "r3-builder:recheck2").length).toBe(22);
    expect(ROWS.filter((r) => r.set.startsWith("r3-recheck")).length).toBeGreaterThanOrEqual(500);
    expect(ROWS.filter((r) => r.set === "r3-selfbreak").length).toBeGreaterThanOrEqual(190);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length);
  });

  it("every over-routed row is a draftable question, and there are no more of them than measured", () => {
    const over = ROWS.filter((r) => r.overRoute);
    expect(over.length).toBeLessThanOrEqual(190);
    for (const r of over) expect(r.expect, r.id).toBe("draft");
  });
});

describe("no question labelled the person's is drafted", () => {
  const persons = ROWS.filter((r) => r.expect === "person");
  it.each(persons.map((r) => [r.id, r.label.slice(0, 110), r] as const))("%s %s", (_id, _l, r) => {
    expect(verdictOf(r), r.reason).toBe("person");
  });
});

describe("every draftable question is drafted, except the rows marked overRoute", () => {
  const drafts = ROWS.filter((r) => r.expect === "draft");
  it.each(drafts.map((r) => [r.id, r.label.slice(0, 110), r] as const))("%s %s", (_id, _l, r) => {
    expect(verdictOf(r), r.overRoute ?? r.reason).toBe(r.overRoute ? "person" : "draft");
  });
});

describe("never worse than origin/main", () => {
  it("drafts no person row origin/main kept with the person, and is wrong where main was right only on over-routed rows", () => {
    expect(ROWS.filter((r) => r.expect === "person" && r.was.main === "person" && verdictOf(r) === "draft").map((r) => r.id)).toEqual([]);
    expect(ROWS.filter((r) => r.was.main === r.expect && verdictOf(r) !== r.expect && !r.overRoute).map((r) => r.id)).toEqual([]);
  });

  it("the classifier is never worse than origin/main's, on any row with a classifier label", () => {
    const worse = ROWS.filter((r) => r.expectCls && clsOk(r, r.wasCls.main) && !clsOk(r, server.classifyQuestion(r.label, "textarea")));
    expect(worse.map((r) => `${r.id} ${r.label}`)).toEqual([]);
  });

  it("the recheck-3 leaks fail on 237bf2e8 and pass here", () => {
    const fixed = ROWS.filter((r) => r.expect === "person" && r.was["237bf2e8"] === "draft");
    expect(fixed.length).toBeGreaterThanOrEqual(90);
    for (const r of fixed) expect(verdictOf(r), r.id).toBe("person");
    const clsFixed = ROWS.filter((r) => r.expectCls && clsOk(r, r.wasCls.main) && !clsOk(r, r.wasCls["237bf2e8"]));
    expect(clsFixed.length).toBeGreaterThanOrEqual(30);
    for (const r of clsFixed) expect(clsOk(r, server.classifyQuestion(r.label, "textarea")), r.id).toBe(true);
  });
});

describe("the worker reads every corpus label the same way", () => {
  it("from the same pattern sources", () => {
    const w = worker as unknown as Record<string, RegExp>;
    const s = server as unknown as Record<string, RegExp>;
    for (const name of ["PROTECTED_FACTUAL", "PERSONAL_HISTORY", "FACTUAL", "PERSON_ASKS", "PERSON_FACT_NOUNS", "PERSON_FACT_WORDS", "PERSON_LATER_WORDS", "PERSON_STATE",
      "SECOND_ASK", "CLAUSE_BREAK", "NO_OBJECT", "QUESTION_AUX", "ASK_WORDS", "PERSON_CIRCUMSTANCE", "ADDRESSES_PERSON", "WORK_PAST", "WORK_CLAUSE", "MOTIVE_CLAUSE",
      "RESUME_PROMPT", "ABOUT_WORK_DONE", "OWN_STATUS", "SENTENCE_BREAK", "WORK_NOUN", "TOOL_NOUN", "PLAIN_WORD", "PERSONAL_NOUN", "ANY_PHRASE", "GOVERNOR",
      "WORK_OBJECT_AFTER", "PREP_PERSON", "YEARS_GAP", "GAP_PERSON", "ENDED"]) {
      expect(w[name], name).toBeInstanceOf(RegExp);
      expect([w[name].source, w[name].flags], name).toEqual([s[name].source, s[name].flags]);
    }
    expect(worker.TOPICS.map(([t, re]) => [t, re.source, re.flags])).toEqual(server.TOPICS.map(([t, re]) => [t, re.source, re.flags]));
    for (const fn of ["madeOfWork", "anyAsk", "factIsTheWork", "workClause", "asksAboutWorkDone", "mentionsPersonFact", "mentionsLaterFact", "pointsAtPerson"]) {
      expect(String((worker as unknown as Record<string, () => void>)[fn]), fn).toBe(String((server as unknown as Record<string, () => void>)[fn]));
    }
  });

  it("with the same verdict on every label", () => {
    const differ = ROWS.filter((r) => {
      const l = server.cleanQuestionLabel(r.label);
      return worker.asksAboutWorkDone(l) !== server.asksAboutWorkDone(l) || worker.topicOf(l) !== server.topicOf(l) || worker.mentionsPersonFact(l) !== server.mentionsPersonFact(l);
    }).map((r) => r.id);
    expect(differ).toEqual([]);
  });

  it("never sends a model's draft into a label the server drafts nothing for", () => {
    const refused = ROWS.filter((r) => verdictOf(r) === "draft" && worker.isProtectedQuestion(r.label)).map((r) => r.id);
    expect(refused).toEqual([]);
  });

  it("protects a label wherever the classifier refuses it for a protected fact", () => {
    const differ = ROWS.filter((r) => {
      const prot = worker.isProtectedQuestion(r.label);
      const l = server.askedText(r.label);
      const serverProt = ((server.PROTECTED_FACTUAL.test(l) || server.PERSONAL_HISTORY.test(l) || server.PERSON_ASKS.test(l) || server.PERSON_FACT_NOUNS.test(l) || server.PERSON_FACT_WORDS.test(l)) && !server.asksAboutWorkDone(l)) || server.PROTECTED_DEMOGRAPHIC.test(l);
      return prot !== serverProt;
    }).map((r) => r.id);
    expect(differ).toEqual([]);
  });
});
