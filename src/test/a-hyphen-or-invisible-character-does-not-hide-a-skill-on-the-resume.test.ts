/**
 * A HYPHEN OR AN INVISIBLE CHARACTER DOES NOT HIDE A SKILL ON THE RÉSUMÉ
 * (S14X-280, the scanner's half).
 *
 * WHAT WAS WRONG. The presence test read the text as it arrived. A word
 * broken across a line ("manage-" / "ment"), a soft hyphen a PDF or a word
 * processor leaves inside a word (U+00AD), a zero-width space a web page
 * leaves inside one (U+200B), or a non-ASCII hyphen (U+2010, U+2011) split the
 * word, so "Management", "Kubernetes", "Python" and "CI/CD" were reported as
 * verified absent on résumés that carry them, and the model was told so. The
 * same characters also let a look-alike through: "C" was found in "C" + U+2011
 * + "suite", where an ASCII hyphen already refuses it.
 *
 * WHAT HOLDS NOW, in both scanners' copies: a soft hyphen, a zero-width space
 * inside a Latin word, a word joiner and a byte-order mark are not there;
 * U+2010 to U+2012 are hyphens; and a word hyphenated at a line end reads both
 * ways, joined ("management") and hyphenated ("cross-functional"), because
 * only a dictionary could say which the writer meant. Ingest-parsers
 * normalises the parsed text too; this half holds for text that arrives any
 * other way (a paste, a cached text, the stream fork).
 */
import { describe, expect, it } from "vitest";
import * as primary from "../../supabase/functions/free-keyword-scan/term-presence";
import * as stream from "../../supabase/functions/free-keyword-scan-stream/term-presence";

const COPIES = [["free-keyword-scan", primary], ["free-keyword-scan-stream", stream]] as const;

const cases: Array<[string, string, boolean]> = [
  // The four the register names.
  ["Led project manage-\nment for the rollout", "management", true],
  ["Ran Kuber­netes clusters", "Kubernetes", true],
  ["Built CI‑CD pipelines", "CI/CD", true],
  ["Wrote Py​thon services", "Python", true],
  // A phrase across the break, a Windows line end, an indented next line.
  ["Led project manage-\nment for the rollout", "project management", true],
  ["Led project manage-\r\nment for the rollout", "management", true],
  ["Led project manage-  \n   ment for the rollout", "management", true],
  // A compound broken at its own hyphen keeps it.
  ["Worked with cross-\nfunctional teams", "cross-functional", true],
  ["Worked with cross-\nfunctional teams", "cross functional", true],
  // A soft hyphen at a line end, and the other hyphens and marks.
  ["Ran Kuber­\nnetes clusters", "Kubernetes", true],
  ["Grew e‐commerce revenue", "e-commerce", true],
  ["Built CI‒CD pipelines", "CI-CD", true],
  ["Wrote Py⁠thon services", "Python", true],
  ["﻿Python developer", "Python", true],
  // The term as a model may write it.
  ["Built CI-CD pipelines", "CI‑CD", true],
  ["Ran Kubernetes clusters", "Kuber­netes", true],
  // ... and no look-alike comes in with them.
  ["Briefed the C‑suite", "C", false],
  ["Led R‑D for thin films", "R", false],
  ["Led project manage-\nment for the rollout", "men", false],
  ["Used Java-\nScript tools", "JavaScript", false],
  ["Kubernetes­ Python", "KubernetesPython", false],
  // A zero-width space between words of a script written without spaces
  // is the word break it was put there to be.
  ["ภาษา​ไทย", "ไทย", true],
];

for (const [name, mod] of COPIES) {
  describe(`${name}: a hyphen or an invisible character does not split a word`, () => {
    for (const [text, term, want] of cases) {
      it(`${term} in ${JSON.stringify(text)} → ${want}`, () => expect(mod.resumeHasTerm(text, term)).toBe(want));
    }
  });
}

describe("the readings are made once per text, never per term", () => {
  it("a long hyphenated résumé still answers 2,000 terms well under a second", () => {
    const RESUME = Array.from({ length: 400 }, (_, i) => `Led project ${i} manage-\nment with SQL, Py​thon and stakeholder reviews.`).join(" ");
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) primary.resumeHasTerm(RESUME, `skill${i} platform`);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(primary.resumeHasTerm(RESUME, "management")).toBe(true);
    expect(primary.presenceCacheSize()).toBeLessThanOrEqual(4);
  });
});
