/**
 * A FACT JOINED TO A WORK OR MOTIVATION QUESTION IN ANY WAY IS THE PERSON'S
 * (wave 4 fix rounds 3 and 4, property-style).
 *
 * The corpus test (w4b-fix3-questions-corpus) replays real labels. This one
 * generates every combination of a work-done or motivation opening, a joiner
 * (the ones the rechecks used and the ones they did not: "and", ",", "&",
 * "/", "+", " - ", an en and an em dash, ";", "plus", "as well as", "along
 * with", "including", a colon, a bracket, a second sentence, and nothing at
 * all) and a factual ask from each family the rule names, in three casings,
 * and holds that none of them is drafted, while the same openings joined to
 * plain work or motivation stay drafted, a protected word that is only the
 * work's object stays drafted, and the worker agrees on every label.
 * Round 4 adds what recheck 3 broke round 3 with: facts in words no list
 * holds, with or without "you", after every joiner, on a new line and in the
 * hint; a fact after "without", "on a", "as a", "since" or "during" in a years
 * question; a status inside the years opening; and, the other way, the words
 * that name a job ("full-time", "eligibility", "visa") in the opening ask,
 * which stay drafted and stay draftable at the classifier.
 */
import { describe, expect, it } from "vitest";
import * as server from "../../supabase/functions/_shared/application-questions";
import { whoAnswers } from "../../supabase/functions/_shared/self-apply";
import * as worker from "../../worker/src/questions/protected.js";

const WORK = [
  "Describe your experience in sales",
  "Tell us about your experience managing teams",
  "What experience do you have with Salesforce",
  "How many years of experience do you have in retail",
  "Describe your background in nursing",
  "Walk us through your experience handling escalations",
  "Please describe your experience working with enterprise clients",
  "Explain your experience leading data migrations",
];
const MOTIVATION = [
  "Why do you want to work here",
  "Why are you interested in this role",
  "What excites you about this position",
  "In 2-3 sentences, why are you interested in this role",
  "Why would you like to join our team",
  "Cover letter",
];
const JOINERS = [" and ", ", ", " & ", " / ", " + ", " - ", " – ", " — ", "; ", " plus ", " as well as ", " along with ", " including ", ": ", " (", ". Also, ", " "];
/** One or more asks from every family the rule names: status, pay, start, notice, references, place, schedule, health, history, legal. */
const ASKS = [
  "current visa status", "your visa", "whether you need sponsorship", "your right to work in the UK", "your work authorization",
  "expected hourly rate", "your salary expectations", "the pay you expect", "what you earned last year", "what you were earning before",
  "how much you were paid", "your take-home pay", "your current wage", "OTE expectations", "your desired day rate",
  "how soon you could start", "your earliest start date", "when we could expect you to begin", "your timeline for joining", "the date you can join us",
  "your notice period", "how many weeks' notice you need", "your notice",
  "two references we can contact", "someone we may call about it", "your references",
  "where you currently live", "where you are based", "your time zone", "whether you are willing to relocate", "whether you are willing to travel",
  "how many hours per week you can work", "your weekend availability", "which shifts you can work",
  "any accommodations needed for the interview", "any medical conditions", "your vaccination status",
  "any gaps in your employment", "why you are leaving your current job", "whether you have worked for us before", "any criminal convictions",
  "any restrictive covenants", "any conflicts of interest", "whether you are over 18", "how you heard about us",
];
const PLAIN_WORK = ["the tools you used", "key accounts and pipeline", "the results you achieved", "the size of the teams you led", "what you learned from it"];
const PLAIN_MOTIVATION = ["what excites you about our mission", "what you hope to learn here", "what drew you to our product"];

const drafted = (label: string, hint?: string) =>
  whoAnswers({ label, required: true, type: "textarea", ...(hint ? { hint } : {}) }, 1).answeredBy === "draft_from_your_cv";
const CASES = [(s: string) => s, (s: string) => s.toUpperCase(), (s: string) => s.toLowerCase()];
const close = (j: string) => (j === " (" ? ")" : "");

describe("a factual ask joined to a work or motivation question in any way goes to the person", () => {
  for (const opening of [...WORK, ...MOTIVATION]) {
    it(`${opening} + every joiner + every ask, in three casings`, () => {
      const leaked: string[] = [];
      for (const j of JOINERS) for (const ask of ASKS) for (const c of CASES) {
        const label = c(`${opening}${j}${ask}${close(j)}`);
        if (drafted(label)) leaked.push(label);
        if (drafted(c(`${opening}${j}${ask}${close(j)}?`))) leaked.push(label + "?");
      }
      expect(leaked).toEqual([]);
    });
  }

  it("the same ask in the employer's hint keeps a work question with the person", () => {
    const leaked = ASKS.flatMap((ask) => ["Please include " + ask + ".", "Mention " + ask + ".", ask.charAt(0).toUpperCase() + ask.slice(1) + "?"])
      .filter((hint) => WORK.some((w) => drafted(w, hint)));
    expect(leaked).toEqual([]);
  });

  it("the same ask as a second sentence keeps it with the person", () => {
    const leaked: string[] = [];
    for (const opening of [...WORK, ...MOTIVATION]) for (const ask of ASKS) {
      for (const label of [`${opening}. Please include ${ask}.`, `${opening}. Also tell us ${ask}.`, `${opening}? And ${ask}?`]) if (drafted(label)) leaked.push(label);
    }
    expect(leaked).toEqual([]);
  });
});

describe("the same openings joined to plain work or motivation are still drafted", () => {
  it("every work opening, every joiner, every plain continuation", () => {
    const refused: string[] = [];
    for (const opening of WORK) for (const j of JOINERS) for (const more of PLAIN_WORK) {
      const label = `${opening}${j}${more}${close(j)}`;
      if (!drafted(label)) refused.push(label);
    }
    expect(refused).toEqual([]);
  });

  it("every motivation opening with a plain second clause", () => {
    const refused: string[] = [];
    // A cover-letter box is the person's whatever follows (next test).
    for (const opening of MOTIVATION.filter((o) => o !== "Cover letter")) for (const j of [" and ", ", ", " & ", " / ", " + ", " - ", " plus "]) for (const more of PLAIN_MOTIVATION) {
      const label = `${opening}${j}${more}`;
      if (!drafted(label)) refused.push(label);
    }
    expect(refused).toEqual([]);
  });

  it("a cover-letter box the classifier files is never drafted, whatever plain clause follows (the answers panel's answer)", () => {
    const drafts: string[] = [];
    let filed = 0;
    for (const j of [" and ", ", ", " & ", " / ", " + ", " - ", " plus "]) for (const more of ["", ...PLAIN_MOTIVATION]) {
      const label = more ? `Cover letter${j}${more}` : "Cover letter";
      if (server.classifyQuestion(label, "textarea") !== "file") continue;
      filed++;
      if (drafted(label)) drafts.push(label);
    }
    expect(filed).toBeGreaterThan(PLAIN_MOTIVATION.length);
    expect(drafts).toEqual([]);
  });

  it("a protected word that is only the work's object is drafted, and pointing it at the person is not", () => {
    // Words a fact list names: drafted as the work's object, the person's once anything after the work words points at them.
    const FACT_OBJECTS = ["immigration law", "payroll and wages", "visa petitions", "drug screening assays", "reasonable accommodation requests for employees", "vaccination clinics", "restrictive covenants and non-solicitation agreements"];
    // Words only a topic names: drafted either way, unless a fact is asked.
    const TOPIC_OBJECTS = ["employee terminations and exit interviews", "clients across different time zones"];
    for (const opening of ["Describe your experience with", "Tell us about your experience handling", "What experience do you have with"]) {
      for (const o of [...FACT_OBJECTS, ...TOPIC_OBJECTS]) {
        expect(drafted(`${opening} ${o}`), `${opening} ${o}`).toBe(true);
        expect(drafted(`${opening} ${o} and your current status`), `${opening} ${o} + your status`).toBe(false);
      }
      for (const o of FACT_OBJECTS) {
        expect(drafted(`${opening} ${o} and the ones you would need`), `${opening} ${o} + you`).toBe(false);
        expect(drafted(`${opening} ${o} & any of yours`), `${opening} ${o} + any`).toBe(false);
        expect(drafted(`${opening} ${o} / required`), `${opening} ${o} + state`).toBe(false);
      }
    }
  });
});

describe("the worker agrees on every generated label", () => {
  it("asksAboutWorkDone, topicOf and mentionsPersonFact give the same answer in both runtimes", () => {
    const differ: string[] = [];
    for (const opening of [...WORK, ...MOTIVATION]) for (const j of JOINERS) for (const tail of [...ASKS, ...PLAIN_WORK]) {
      const label = `${opening}${j}${tail}`;
      if (worker.asksAboutWorkDone(label) !== server.asksAboutWorkDone(label) || worker.topicOf(label) !== server.topicOf(label) || worker.mentionsPersonFact(label) !== server.mentionsPersonFact(label)) differ.push(label);
    }
    expect(differ).toEqual([]);
  });
});

/** Round 4: facts in words no list holds (recheck 3), each a second ask. */
const UNLISTED = [
  "any DUIs", "any disciplinary actions you faced", "why it ended", "why you moved on", "how that role came to an end", "time away from the workforce",
  "a former manager who can vouch for it", "the name of a manager we could reach to confirm it", "total earnings", "W-2 earnings for the last two years",
  "the OTE attached", "any injuries that limit your work", "any union affiliations", "any party memberships", "your union membership",
  "your hourly expectations", "the languages spoken at home", "the days off required", "any liens or judgments", "the city you grew up in",
  "customers you are restricted from soliciting", "the accounts that would follow you here", "your political views", "the commission plan at the last company",
];
const WORK_OPENINGS = ["Describe your experience in sales", "Tell us about your experience managing teams", "What experience do you have with Salesforce", "Describe your background in nursing"];

describe("round 4: a fact in words no list holds is the person's, wherever it sits", () => {
  it("after every joiner, as a second sentence, on a new line, and in the hint", () => {
    const leaked: string[] = [];
    for (const opening of [...WORK_OPENINGS, ...MOTIVATION]) for (const ask of UNLISTED) {
      for (const j of [" and ", ", ", " & ", " / ", " + ", " - ", "; ", " plus ", " including ", ": ", " (", "\n"]) {
        const label = `${opening}${j}${ask}${close(j)}`;
        if (drafted(label)) leaked.push(label);
      }
      if (drafted(`${opening}. Include ${ask}.`)) leaked.push(`${opening}. Include ${ask}.`);
      if (drafted(opening, `Please also mention ${ask}.`)) leaked.push(`${opening} | hint: Please also mention ${ask}.`);
    }
    expect(leaked).toEqual([]);
  });

  it("a fact after 'without', 'on a', 'as a', 'since' or 'during' in a years question, and a status inside the years opening", () => {
    const leaked: string[] = [];
    const TAILS = ["without a DUI conviction", "without a positive drug test", "without a criminal charge", "without a medical leave", "with no felony convictions",
      "on an H-1B visa", "on OPT", "on STEM OPT", "on a work permit", "on a tourist visa", "as a green card holder", "as a US citizen", "as an EU citizen",
      "as a permanent resident", "since becoming a US citizen", "since you were 18", "during a pregnancy", "during a medical leave", "at a wage of $20/hour", "with OTE above $200k"];
    for (const kind of ["", "CDL driving ", "nursing ", "total ", "warehouse "]) for (const t of TAILS) {
      for (const label of [`How many years of ${kind}experience ${t}?`, `How many years of ${kind}experience do you have ${t}?`]) if (drafted(label)) leaked.push(label);
    }
    for (const gap of ["US citizen-only program", "green card holder", "permanent resident work", "cleared", "TS/SCI", "Secret-cleared", "active-duty military", "union", "OPT"]) {
      const label = `How many years of ${gap} experience do you have?`;
      if (drafted(label)) leaked.push(label);
      if (server.classifyQuestion(label, "textarea") === "draftable" && /citizen|green card|resident/i.test(gap)) leaked.push(`classifier: ${label}`);
    }
    expect(leaked).toEqual([]);
  });

  it("the same openings joined to plain work are drafted, told with a verb of work", () => {
    const refused: string[] = [];
    for (const opening of WORK_OPENINGS) for (const j of [" and ", ", ", " including "]) for (const more of ["the grade levels you've taught", "the night shifts you worked", "the conversion rate you achieved", "the charges you reconciled", "the travel you arranged", "the quotas you exceeded", "the industries you sold into", "your biggest win", "your sales methodology"]) {
      const label = `${opening}${j}${more}`;
      if (!drafted(label)) refused.push(label);
    }
    expect(refused).toEqual([]);
  });

  it("a word that names a job in the opening ask is drafted and stays draftable at the classifier", () => {
    const refused: string[] = [];
    for (const label of ["Why are you interested in this full-time position at Acme?", "What excites you about this part-time opportunity?", "Why do you want to join our full-time engineering team?",
      "How many years of full-time experience do you have?", "Tell us about your experience with benefits eligibility audits.", "How many years of visa processing experience do you have?",
      "Tell us about a time you had to give a client bad news at short notice.", "How do you plan business trips for an executive team?"]) {
      if (server.classifyQuestion(label, "textarea") !== "draftable") refused.push(`classifier: ${label}`);
    }
    for (const label of ["Why are you interested in this full-time position at Acme?", "What excites you about this part-time opportunity?", "How many years of full-time experience do you have?", "Tell us about your experience with benefits eligibility audits."]) {
      if (!drafted(label)) refused.push(label);
    }
    expect(refused).toEqual([]);
  });

  it("the worker agrees on every round-4 label", () => {
    const differ: string[] = [];
    for (const opening of [...WORK_OPENINGS, ...MOTIVATION]) for (const ask of UNLISTED) for (const j of [" and ", ", ", " / ", ": "]) {
      const label = `${opening}${j}${ask}`;
      if (worker.asksAboutWorkDone(label) !== server.asksAboutWorkDone(label) || worker.mentionsPersonFact(label) !== server.mentionsPersonFact(label)) differ.push(label);
    }
    expect(differ).toEqual([]);
  });
});
