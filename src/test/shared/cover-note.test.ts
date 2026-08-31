/**
 * The cover-note gate, tested in BOTH directions.
 *
 * The rejection tests are the obvious half. The acceptance tests matter more:
 * a gate that fails every honest note would send the candidate's generic note
 * every single time, the feature would silently do nothing, and the only
 * symptom would be an absence. Nobody files a bug against an absence.
 */
import { describe, it, expect } from "vitest";
import { validateCoverNote, coverNotePrompt, gateCanCheck, MIN_CHARS, MAX_CHARS } from "../../../supabase/functions/_shared/cover-note";

const RESUME = `Jane Okafor
Senior Backend Engineer

Experience
Meridian Health — Senior Backend Engineer, 2021 to present
- Led the migration of the billing service to Postgres, cutting query latency by 40%
- Mentored 3 junior engineers on the platform team

Fintouch — Backend Engineer, 2018 to 2021
- Built payment reconciliation in Python and Go

Education
BSc Computer Science, University of Leeds

Skills: Python, Go, Postgres, Kubernetes, Terraform`;

const POSTING = `Staff Backend Engineer at Northwind Robotics.
You will own our payments platform, which runs on Go and Postgres.
Experience with Kubernetes is a plus. We ship to 12 markets.`;

const ctx = {
  resumeText: RESUME,
  jobDescription: POSTING,
  jobTitle: "Staff Backend Engineer",
  company: "Northwind Robotics",
  candidateName: "Jane Okafor",
  baseNote: "I care about systems where correctness matters more than speed of delivery.",
};

/** Grounded in the résumé, the posting and the candidate's own note. */
const HONEST = `I care about backend systems where correctness matters more than speed of delivery, which is why this role caught my attention.

At Meridian Health I led the migration of the billing service to Postgres and cut query latency by 40%, and before that I built payment reconciliation at Fintouch in Python and Go. Mentoring the junior engineers on that platform team was the part I enjoyed most.

The payments platform you describe is the closest thing to that work I have seen advertised. I would bring direct Go and Postgres experience, plus the Kubernetes familiarity from running our own clusters.`;

describe("validateCoverNote — accepts honest notes", () => {
  it("accepts a note grounded in the résumé, the posting and the base note", () => {
    const v = validateCoverNote({ ...ctx, note: HONEST });
    if (!v.ok) console.error("unexpected issues:", v.issues);
    expect(v.ok).toBe(true);
  });

  it("allows a figure that comes from the JOB POSTING rather than the résumé", () => {
    // Honest letters cite the employer's own numbers constantly.
    const note = HONEST.replace("caught my attention.", "caught my attention, especially shipping to 12 markets.");
    expect(validateCoverNote({ ...ctx, note }).ok).toBe(true);
  });

  it("allows a name the candidate used in their OWN note", () => {
    const note = HONEST.replace("this role caught my attention", "Rust is where I learned that");
    const v = validateCoverNote({
      ...ctx,
      baseNote: "I care about correctness. Rust taught me that.",
      note,
    });
    expect(v.ok).toBe(true);
  });

  it("does not flag ordinary sentence-initial capitals", () => {
    const note = `Having spent several years on billing systems, I know how quickly correctness debt compounds.

Working at Meridian Health taught me that. Before that, Python and Go were my daily tools at Fintouch, and Postgres has been a constant throughout.

Should the team want someone who has already carried a payments migration end to end, I would be glad to talk. Mentoring is something I would want to keep doing.`;
    const v = validateCoverNote({ ...ctx, note });
    if (!v.ok) console.error("unexpected issues:", v.issues);
    expect(v.ok).toBe(true);
  });

  it("grounds a multi-word name when each word is grounded separately", () => {
    // "Meridian Health" in the résumé + "Robotics" in the posting.
    const note = HONEST.replace("Northwind Robotics", "Northwind Robotics").replace(
      "The payments platform", "The Northwind Robotics payments platform");
    expect(validateCoverNote({ ...ctx, note }).ok).toBe(true);
  });
});

describe("validateCoverNote — rejects fabrication", () => {
  it("rejects an employer that appears nowhere", () => {
    const note = HONEST.replace("At Meridian Health", "At Google");
    const v = validateCoverNote({ ...ctx, note });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ")).toContain("Google");
  });

  it("rejects a school that appears nowhere", () => {
    const note = HONEST + "\n\nMy MIT coursework covered distributed systems.";
    const v = validateCoverNote({ ...ctx, note });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ")).toContain("MIT");
  });

  it("rejects a technology the candidate never listed", () => {
    const note = HONEST.replace("plus the Kubernetes familiarity", "plus deep Haskell experience");
    const v = validateCoverNote({ ...ctx, note });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ")).toContain("Haskell");
  });

  it("rejects an invented figure", () => {
    const note = HONEST.replace("cut query latency by 40%", "cut query latency by 92%");
    const v = validateCoverNote({ ...ctx, note });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ")).toMatch(/92/);
  });

  it("rejects an unfilled placeholder", () => {
    const note = HONEST.replace("this role", "the [Job Title] role");
    const v = validateCoverNote({ ...ctx, note });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ")).toContain("placeholder");
  });

  it.each([
    ["I am authorised to work in the UK and need no support.", "work authorisation"],
    ["I do not require sponsorship for this position.", "sponsorship"],
    ["I can start immediately if that helps.", "start date"],
  ])("refuses to volunteer a standing answer: %s", (sentence, expected) => {
    const v = validateCoverNote({ ...ctx, note: `${HONEST}\n\n${sentence}` });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ").toLowerCase()).toContain(expected);
  });

  it("rejects a note that is too short to be one", () => {
    const v = validateCoverNote({ ...ctx, note: "I would like the job." });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ")).toContain("Too short");
  });

  it("rejects a note past the ceiling", () => {
    const v = validateCoverNote({ ...ctx, note: "Correctness matters. ".repeat(120) });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ")).toContain("Too long");
  });

  it("rejects an empty note without throwing", () => {
    expect(validateCoverNote({ ...ctx, note: "   " }).ok).toBe(false);
  });

  it("checks an acronym even when it opens a sentence", () => {
    const note = HONEST + "\n\nAWS is where I spent four of those years.";
    const v = validateCoverNote({ ...ctx, note });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join(" ")).toContain("AWS");
  });
});

describe("the gate knows which languages it can actually check", () => {
  // THIS IS THE TEST THAT WAS MISSING. Every acceptance test above is in
  // English, so nothing noticed that the whole heuristic is a property of the
  // language. Production found it: a clean German note came back rejected over
  // "Liefergeschwindigkeit", "Beitrag" and "Ihrem".
  it.each(["en", "en-GB", "es", "fr", "pt", "nl", "tl", undefined, ""])(
    "runs for %s, where a mid-sentence capital means a name", (lang) => {
      expect(gateCanCheck(lang)).toBe(true);
    });

  it("declines German, which capitalises every noun", () => {
    expect(gateCanCheck("de")).toBe(false);
    expect(gateCanCheck("de-AT")).toBe(false);
  });

  it("declines Hindi, where Devanagari has no case for the check to read", () => {
    expect(gateCanCheck("hi")).toBe(false);
  });

  it("demonstrates the German failure the check would otherwise produce", () => {
    // Ordinary German prose, nothing invented — every flagged word is a common
    // noun or a pronoun. Kept as the concrete reason gateCanCheck exists.
    const v = validateCoverNote({
      ...ctx,
      note: "Ich leitete die Migration des Abrechnungsdienstes und brachte Erfahrung mit Postgres ein. "
        + "Mir ist Korrektheit wichtiger als Geschwindigkeit, und ich möchte diesen Beitrag in Ihrem Team leisten. "
        + "Meine Kenntnisse umfassen Python und Go, sowie die Betreuung jüngerer Kollegen im Alltag.",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const joined = v.issues.join(" ");
      expect(joined).toMatch(/Erfahrung|Beitrag|Ihrem|Kenntnisse/);
    }
  });
});

describe("coverNotePrompt", () => {
  it("states the rules the gate actually enforces", () => {
    const { system } = coverNotePrompt({
      jobTitle: "Staff Backend Engineer", company: "Northwind Robotics",
      jobDescription: POSTING, baseNote: "hello", resumeText: RESUME,
    });
    expect(system).toMatch(/sponsorship/i);
    expect(system).toMatch(/placeholder/i);
    expect(system).toContain(String(MIN_CHARS));
    expect(system).toContain(String(MAX_CHARS));
  });

  it("carries the candidate's own note into the prompt", () => {
    const { user } = coverNotePrompt({
      jobTitle: "X", company: "Y", baseNote: "MY OWN WORDS", resumeText: RESUME,
    });
    expect(user).toContain("MY OWN WORDS");
  });
});
