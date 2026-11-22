/**
 * A MARKETING SPECIALIST IS NOT GIVEN A PHYSICIAN'S TIPS (OI-28).
 *
 * The free report's role tips come from getRoleAdvice(currentRole). Whole-word
 * matching fixed the short substrings, but a few aliases were too wide for
 * any title: every "<anything> Specialist" got the Physician card through
 * its bare alias "specialist" (patient-care must-have keywords for a
 * Marketing, HR or Payroll Specialist), "Business Development Manager" and
 * any "Team Lead" got the Engineering Manager card, "Chief of Staff" and
 * "Office Manager" the Executive Assistant card, and "VP of Sales" a sales
 * representative's tips through the keyword rule. A word that alone names
 * a relation, a shift or another language's preposition ("partner", "pt",
 * "pm", Portuguese "em") picked a card by accident too.
 *
 * Corpus first: src/test/fixtures/role-title-corpus-2026-11-21.json holds 424
 * real posting titles with origin/main's card and the card that fits, read
 * by hand. Every title main got right stays right, and the build gets more
 * of them right than main did. A director's, a head's or a VP's title gets
 * no individual seller's card however it is written ("Sales Director" and
 * "Director of Sales" alike).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRoleAdvice, ROLE_CONFIGS } from "@/config/personalization";

type Row = { title: string; from: string; main: string | null; expected: string | null };
const corpus = JSON.parse(readFileSync(resolve(__dirname, "fixtures/role-title-corpus-2026-11-21.json"), "utf8")) as { rows: Row[] };

const keyOf = (title: string): string | null => {
  const card = getRoleAdvice(title);
  if (!card) return null;
  return Object.entries(ROLE_CONFIGS).find(([, c]) => c === card)?.[0] ?? "?";
};

describe("the register's own examples", () => {
  it("a Marketing Specialist, an HR Specialist and a Payroll Specialist get no physician's tips", () => {
    for (const title of ["Marketing Specialist", "HR Specialist", "Payroll Specialist", "IT Support Specialist"]) {
      expect(keyOf(title), title).not.toBe("physician");
    }
    expect(keyOf("Marketing Specialist")).toBe("marketing_manager");
    expect(keyOf("IT Support Specialist")).toBe("it_support_specialist");
  });

  it("a Chief of Staff is no executive assistant, and an Office Manager is not one either", () => {
    expect(keyOf("Chief of Staff")).toBeNull();
    expect(keyOf("Office Manager")).toBeNull();
  });

  it("VP of Sales gets no sales representative's tips; a sales rep still does", () => {
    expect(keyOf("VP of Sales")).toBeNull();
    expect(keyOf("Head of DACH Sales")).toBeNull();
    expect(keyOf("Inside Sales Representative")).toBe("sales_representative");
  });

  it("a Sales Director and a Director of Sales get the same tips, whichever way the title is written", () => {
    for (const title of ["Sales Director", "Regional Sales Director", "Enterprise Sales Director", "AI Sales Director", "Director of Sales", "Director of Business Development", "Head of Business Development"]) {
      expect(keyOf(title), title).toBeNull();
    }
    // The company's name is no job: a head of business development at an
    // insurance broker is no insurance agent.
    expect(keyOf("Head, Business Development, Stanbic IBTC Insurance Brokers Limited")).toBeNull();
    // A sales manager carries a number and keeps the seller's card.
    expect(keyOf("Regional Sales Manager")).toBe("sales_representative");
    expect(keyOf("Senior Account Executive")).toBe("sales_representative");
  });

  it("a Business Development Manager is in sales, not an engineering manager", () => {
    expect(keyOf("Business Development Manager")).toBe("sales_representative");
    expect(keyOf("Team Lead, Customer Service")).toBeNull();
    expect(keyOf("Team Lead Software Engineering")).toBe("engineering_manager");
    // A software development manager leads engineers: no individual
    // contributor's tips for the title that lost its generic alias.
    expect(keyOf("Software Development Manager")).toBe("engineering_manager");
    expect(keyOf("Sr. Software Development Manager")).toBe("engineering_manager");
  });

  it("a real physician, a nurse and an executive assistant keep their cards", () => {
    expect(keyOf("Primary Care Physician")).toBe("physician");
    expect(keyOf("General Surgeon")).toBe("physician");
    expect(keyOf("Senior RN")).toBe("nurse");
    expect(keyOf("EA to the CEO")).toBe("executive_assistant");
  });
});

describe("over the corpus of real titles", () => {
  it("holds at least 300 public titles, each with its source and both readings", () => {
    expect(corpus.rows.length).toBeGreaterThanOrEqual(300);
    for (const r of corpus.rows) {
      expect(r.title.trim(), JSON.stringify(r)).not.toBe("");
      expect(r.from, r.title).toMatch(/\.json$|^shouted-mixed$/);
      expect(r.main === null || r.main in ROLE_CONFIGS, r.title).toBe(true);
      expect(r.expected === null || r.expected in ROLE_CONFIGS, r.title).toBe(true);
    }
  });

  it("every title main got right stays right", () => {
    const lost = corpus.rows.filter((r) => r.main === r.expected && keyOf(r.title) !== r.expected).map((r) => `${r.title}: ${keyOf(r.title)} (was ${r.main})`);
    expect(lost).toEqual([]);
  });

  it("no corpus title gets the physician's card unless it names a physician's job", () => {
    const wrong = corpus.rows.filter((r) => keyOf(r.title) === "physician" && r.expected !== "physician").map((r) => r.title);
    expect(wrong).toEqual([]);
  });

  it("gets more titles right than main did", () => {
    const right = corpus.rows.filter((r) => keyOf(r.title) === r.expected).length;
    const mainRight = corpus.rows.filter((r) => r.main === r.expected).length;
    expect(right).toBeGreaterThan(mainRight + 200);
  });
});
