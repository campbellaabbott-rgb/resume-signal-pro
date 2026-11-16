/**
 * ROLE TIPS MATCH A TITLE BY WHOLE WORDS (RC-OI-28).
 *
 * getRoleAdvice picked the free report's role tips with a substring test, so
 * a two-letter alias matched inside any word: "Area Manager" got an executive
 * assistant's tips ("ea"), "Brand Ambassador" a business analyst's ("ba"),
 * and "Head of Research" a config by a short alias inside "research". Names,
 * aliases and keywords now match as whole words, and a title that matches
 * nothing gets the generic tips (null).
 */
import { describe, expect, it } from "vitest";
import { getRoleAdvice, hasRoleWord, ROLE_CONFIGS } from "@/config/personalization";

const nameOf = (title: string) => getRoleAdvice(title)?.name ?? null;

describe("a short alias inside another word is not the role", () => {
  it("Area Manager is not an executive assistant", () => {
    expect(nameOf("Area Manager")).not.toBe(ROLE_CONFIGS.executive_assistant.name);
  });
  it("Brand Ambassador is not a business analyst", () => {
    expect(nameOf("Brand Ambassador")).not.toBe(ROLE_CONFIGS.business_analyst.name);
  });
  it("Head of Research is not matched by an alias inside 'research'", () => {
    const got = getRoleAdvice("Head of Research");
    if (got) {
      const words = "head of research".split(" ");
      const hit = [got.name.toLowerCase(), ...got.aliases.map((a) => a.toLowerCase())].some((a) => words.includes(a) || "head of research".includes(` ${a} `));
      expect(hit, `${got.name} was chosen for "Head of Research"`).toBe(true);
    }
  });
});

describe("a whole word still matches", () => {
  it("Senior RN is a nurse", () => {
    expect(nameOf("Senior RN")).toBe(ROLE_CONFIGS.nurse.name);
  });
  it("EA to the CEO is an executive assistant", () => {
    expect(nameOf("EA to the CEO")).toBe(ROLE_CONFIGS.executive_assistant.name);
  });
  it("Senior Software Engineer is a software engineer", () => {
    expect(nameOf("Senior Software Engineer")).toBe(ROLE_CONFIGS.software_engineer.name);
  });
});

describe("the word test", () => {
  it("bounds a term by non-letters, allows a plural, and refuses a substring", () => {
    expect(hasRoleWord("area manager", "ea")).toBe(false);
    expect(hasRoleWord("ea to the ceo", "ea")).toBe(true);
    expect(hasRoleWord("teachers", "teacher")).toBe(true);
    expect(hasRoleWord("fp&a lead", "fp&a")).toBe(true);
    expect(hasRoleWord("head of research", "se")).toBe(false);
  });
});
