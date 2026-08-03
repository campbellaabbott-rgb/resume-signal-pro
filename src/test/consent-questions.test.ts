/**
 * The agent was one classifier branch away from attesting, in a candidate's
 * name, that they had read a document they had never opened.
 *
 * FOUND BY MEASUREMENT, 2026-08-03. Sampling 40 live Recruitee forms — 127 real
 * questions — turned up two labels of this shape:
 *
 *   "<p>Please confirm you've read our <a ...>Privacy Notice</a> ...</p>"
 *   "<p>Ik heb de <a ...>privacy statement</a> gelezen en ga akkoord.</p>"
 *
 * Both classified `draftable`. apply-agent then selected what to send to the
 * model with `label.length > 24`, and both are longer than that, so a language
 * model was going to write the answer.
 *
 * WHY THIS IS THE SHARPEST CASE IN THE CLASSIFIER. A drafted demographic answer
 * is inappropriate; a drafted salary expectation is a guess. A drafted consent
 * is a FALSE STATEMENT OF FACT about an act a specific person did or did not
 * perform, made to a company they want to hire them, on a question whose entire
 * purpose is that a human followed the link inside it. No amount of résumé
 * grounding can support it, because the résumé is not where the answer lives.
 *
 * Not a Recruitee problem — any vendor whose real form we read can carry one.
 * It stayed invisible because it takes real harvested questions to see it, and
 * the four generic placeholder questions the agent used to fall back on contain
 * no consent language at all. Same shape as the IDENTITY_IF_FIELD and FACTUAL
 * corrections before it: the corpus taught the classifier, not the other way
 * round.
 */
import { describe, it, expect } from "vitest";
import {
  classifyQuestion,
  cleanQuestionLabel,
  selectDraftable,
} from "../../supabase/functions/_shared/application-questions.ts";
import { buildPacket } from "../../supabase/functions/_shared/submission-packet.ts";

/** Verbatim from the live sample. Not paraphrased — that is the whole point. */
const LIVE_CONSENT = [
  `<p>Please confirm you've read our <a href="https://tbibank.bg/wp-content/uploads/2023/04/tbi-bank_Privacy-Notice.pdf" target="_blank">Privacy Notice</a> and consent to the processing of your data.</p>`,
  // VERBATIM, and it was not before. The first version of this fixture ended
  // "gelezen en ga akkoord" — a tail I completed from a truncated sample. The
  // real one says "gelezen en begrijp hoe mijn persoonsgegevens worden
  // verwerkt", which the shipped regex missed live while this test passed.
  // See consent-corpus.test.ts.
  `<p>Ik heb de <a href="https://www.jobsatpon.com/nl/nl/privacy-statement" target="_blank" rel="noopener">privacyverklaring</a> van Pon Holding B.V. gelezen en begrijp hoe mijn persoonsgegevens worden verwerkt.</p>`,
];

describe("consent and attestation are never drafted", () => {
  it("classifies the two labels that were actually going to the model", () => {
    for (const l of LIVE_CONSENT) {
      expect(classifyQuestion(l, ""), `still draftable: ${l.slice(0, 60)}`).toBe("consent");
    }
  });

  it("catches the plain-text forms too", () => {
    for (const l of [
      "I have read and agree to the privacy policy",
      "Do you consent to the processing of your personal data?",
      "I accept the terms and conditions",
      "I have reviewed and acknowledge the data protection notice",
      "Ich bin mit der Verarbeitung meiner Daten einverstanden",
      "He leído y acepto la política de privacidad",
    ]) {
      expect(classifyQuestion(l, ""), `missed: ${l}`).toBe("consent");
    }
  });

  it("does not swallow real questions that merely contain 'agree'", () => {
    // The regex needs a document, a policy, or an explicit "I have read".
    // Widening it past that would quietly stop drafting legitimate essays — the
    // exact failure mode FACTUAL's comment block warns about.
    for (const l of [
      "Do you agree that good design is invisible? Why or why not?",
      "Describe a time you had to get a team to agree on a difficult tradeoff.",
      "What terms would you use to describe your management style?",
      "Tell us about a policy you changed and the outcome.",
    ]) {
      expect(classifyQuestion(l, ""), `wrongly consent: ${l}`).toBe("draftable");
    }
  });

  it("wins over the file class, so a résumé URL is never pushed into a checkbox", () => {
    // CONSENT is tested before FILE deliberately: this label contains "CV".
    expect(classifyQuestion("I consent to my CV being stored for 12 months", "")).toBe("consent");
  });

  it("is excluded from the draftable set", () => {
    const qs = LIVE_CONSENT.map((label) => ({ label }));
    expect(selectDraftable(qs)).toEqual([]);
  });
});

describe("a label is text, not markup", () => {
  it("strips tags and keeps the words", () => {
    const out = cleanQuestionLabel(LIVE_CONSENT[0]);
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("Privacy Notice");
    expect(out).toContain("consent to the processing");
  });

  it("decodes entities after stripping, never before", () => {
    // If entities were decoded first, an escaped &lt;p&gt; in genuine question
    // text would become a tag the strip pass had already walked past.
    expect(cleanQuestionLabel("Describe a bug involving &lt;p&gt; tags &amp; nesting"))
      .toBe("Describe a bug involving <p> tags & nesting");
  });

  it("collapses the whitespace that block tags leave behind", () => {
    expect(cleanQuestionLabel("<p>Line one</p><p>Line two</p>")).toBe("Line one Line two");
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 42, {}, "<<<>>>", ""]) {
      expect(typeof cleanQuestionLabel(junk)).toBe("string");
    }
  });
});

describe("a required consent blocks the packet instead of being ticked", () => {
  const profile = {
    fullName: "A Candidate", email: "a@example.com", phone: "", resumeFileUrl: "https://x/r.pdf",
  };
  const standing = {} as Record<string, never>;

  it("blocks, and names it as the candidate's own to give", () => {
    const packet = buildPacket({
      questions: [{ label: cleanQuestionLabel(LIVE_CONSENT[0]), required: true }],
      // deno-lint-ignore no-explicit-any
      profile: profile as any, standing: standing as any,
      drafted: [], automationTier: "auto",
    });
    expect(packet.ready, "a consent the agent cannot give must not be sendable").toBe(false);
    const b = packet.blockers.find((x) => x.kind === "needs-candidate");
    expect(b, "no needs-candidate blocker").toBeTruthy();
    expect(b!.detail).toMatch(/yourself/i);
  });

  it("never invents a value for it, blocked or not", () => {
    const packet = buildPacket({
      questions: [{ label: cleanQuestionLabel(LIVE_CONSENT[1]), required: false }],
      // deno-lint-ignore no-explicit-any
      profile: profile as any, standing: standing as any,
      drafted: [], automationTier: "auto",
    });
    expect(packet.fields.map((f) => f.key)).toEqual([]);
  });

  it("an OPTIONAL consent does not block a send", () => {
    // Declining to tick an optional box is a real, honest choice. Blocking on it
    // would strand packets over a checkbox the employer marked as optional.
    const packet = buildPacket({
      questions: [
        { label: "Full name", required: true },
        { label: cleanQuestionLabel(LIVE_CONSENT[1]), required: false },
      ],
      // deno-lint-ignore no-explicit-any
      profile: profile as any, standing: standing as any,
      drafted: [], automationTier: "auto",
    });
    expect(packet.blockers.filter((b) => b.kind === "needs-candidate")).toEqual([]);
  });
});

/**
 * THE CALLER, not just the classifier. buildPacket discarded a bad draft after
 * the fact, so the packet was always safe — but apply-agent had already ASKED
 * the model to write it, using a length threshold where a classifier belonged.
 * A draft nobody uses is still a draft generated in the candidate's name.
 */
describe("apply-agent selects what to draft by class, not by label length", () => {
  it("filters on classifyQuestion", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the length heuristic is back").not.toMatch(/label\s*\?\?\s*""\)\.length\s*>\s*24/);
    expect(code).toMatch(/classifyQuestion\(x\.label \?\? "", x\.fieldType\) === "draftable"/);
  });

  it("sends the posting text to the drafting call", () => {
    // Answers used to be written from a résumé, a title and a company name while
    // the description sat one call away in the same loop iteration.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const calls = code.split('invoke("generate-application-answers"');
    expect(calls.length, "expected both the answers call and the cover-note call").toBe(3);
    for (const c of calls.slice(1)) {
      expect(c.slice(0, 600), "a generate-application-answers call with no posting text")
        .toMatch(/jobDescription: await postingText\(\)/);
    }
  });

  it("fetches that text at most once per posting", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect((code.match(/action: "detail"/g) ?? []).length,
      "more than one detail fetch — the memo is broken").toBe(1);
    expect(code).toMatch(/if \(descTried \|\| outOfTime\(\)\) return jobDescription/);
  });

  it("cleans harvested labels at the boundary", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
    expect(src).toMatch(/label: cleanQuestionLabel\(x\.label\)/);
  });
});
