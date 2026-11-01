// @vitest-environment node
/**
 * THE FULL ANALYSIS'S OUTPUT CAPS ARE MEASURED FROM ITS SCHEMA (S13-001).
 *
 * analyze-resume sent its one big call with no max_tokens. Its parts now each
 * name a cap, and a cap below the largest reply the schema legitimately asks
 * for truncates a paid analysis (S12-055: a 3,000-token cap, thinking
 * included, cut a paid Freelance Boost reply in half). So the caps are not
 * typed from a feeling: this file builds the largest legitimate reply for each
 * part from the schema itself, by the rules analysis-parts.ts states, and
 * holds each constant at or above it (and within 10% of it, so a cap that
 * stops meaning anything is caught too). Change the schema and this fails
 * until the cap is measured again.
 *
 * It also holds the split itself: the schema is the old one, field for field
 * (fixtures/full-analysis-tool-schema.before-s13-001.json, main f8d72a9b),
 * the parts cover its keys exactly once, and the merge is the old object.
 */
import { describe, expect, it } from "vitest";
import OLD from "./fixtures/full-analysis-tool-schema.before-s13-001.json";
import {
  CORE_OUTPUT_TOKENS,
  LINKEDIN_OUTPUT_TOKENS,
  POSTING_OUTPUT_TOKENS,
  THINKING_TOKENS,
  ANALYSIS_BUDGET_MS,
  PRO_ATTEMPT_MS,
  analysisParts,
  getAnalysisTools,
  mergeParts,
  readToolReply,
  usablePart,
} from "../../supabase/functions/analyze-resume/analysis-parts";

type Schema = { type: string; description?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[]; enum?: string[] };

const CHARS_PER_TOKEN = 3;

/** The largest count an array's description allows; with none stated, ten for a list of short names, six otherwise. */
function itemCount(s: Schema, key: string): number {
  const d = s.description ?? "";
  const range = d.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return Number(range[2]);
  const one = d.match(/^(?:Top\s+)?(\d+)\s/i) ?? d.match(/\b(\d+)\s+(?:easy|specific|strategic)/i);
  if (one) return Number(one[1]);
  return /keyword|skill|hashtag|section|signal|value|connection|group/i.test(key) ? 10 : 6;
}

/** The longest a string legitimately runs, from what its description asks for. */
function stringLength(s: Schema, key: string): number {
  const d = s.description ?? "";
  if (s.enum) return Math.max(...s.enum.map((e) => e.length));
  if (/paragraph/i.test(d)) return 2000;
  const under = d.match(/under (\d+) chars/i);
  if (under) return Number(under[1]);
  if (/2-3 sentence/i.test(d)) return 450;
  if (/template/i.test(key + d)) return 300;
  if (/^(role|category|metricName|exampleRange|companyName|weak|strong|topic|value|roleType)$/.test(key)) return 60;
  if (/keyword|skill|hashtag|Signals|Keywords|sectionOrder|targetConnections|groups/i.test(key)) return 40;
  if (/^(original|improved|bulletExample|suggestedText|currentText|example|hook|suggested|resumeLanguage)$/.test(key)) return 260;
  return 220;
}

function largest(s: Schema, key = ""): unknown {
  if (s.type === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, largest(v, k)]));
  if (s.type === "array") return Array.from({ length: itemCount(s, key) }, () => largest(s.items as Schema, key));
  if (s.type === "number") return 100;
  if (s.type === "boolean") return false;
  return "x".repeat(stringLength(s, key));
}

/** The largest legitimate reply to the given top-level keys of a schema, in characters of JSON. */
const largestReplyChars = (params: Schema, keys: string[]) =>
  JSON.stringify(Object.fromEntries(keys.map((k) => [k, largest((params.properties ?? {})[k], k)]))).length;

const old = OLD as unknown as Record<"none" | "linkedin" | "posting" | "both", Array<{ function: { parameters: Schema } }>>;
const both = old.both[0].function.parameters;
const coreKeys = Object.keys(both.properties ?? {}).filter((k) => k !== "linkedInAnalysis" && k !== "jobDescriptionAlignment");

describe("each cap is the largest legitimate reply its part of the schema asks for", () => {
  const measured = {
    core: largestReplyChars(both, coreKeys),
    linkedin: largestReplyChars(both, ["linkedInAnalysis"]),
    posting: largestReplyChars(both, ["jobDescriptionAlignment"]),
  };

  it("the measurement is the one analysis-parts.ts records", () => {
    expect(measured).toEqual({ core: 30_966, linkedin: 18_241, posting: 15_809 });
  });

  for (const [name, cap, chars] of [
    ["core", CORE_OUTPUT_TOKENS, measured.core],
    ["LinkedIn", LINKEDIN_OUTPUT_TOKENS, measured.linkedin],
    ["posting", POSTING_OUTPUT_TOKENS, measured.posting],
  ] as const) {
    it(`${name}: at or above ${Math.ceil(chars / CHARS_PER_TOKEN)} tokens, and within 10% of it`, () => {
      const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
      expect(cap, `${name}'s cap would truncate the largest legitimate reply`).toBeGreaterThanOrEqual(tokens);
      expect(cap, `${name}'s cap no longer follows the schema`).toBeLessThanOrEqual(Math.ceil(tokens * 1.1));
    });
  }

  it("each call's max_tokens is its sections' output plus the model's thinking, which counts against the same cap", () => {
    expect(THINKING_TOKENS).toBe(8_192);
    const caps = (l: boolean, j: boolean) => analysisParts(l, j).map((p) => [p.label, p.maxTokens]);
    expect(caps(false, false)).toEqual([["core", CORE_OUTPUT_TOKENS + THINKING_TOKENS]]);
    expect(caps(true, false)).toEqual([["core", CORE_OUTPUT_TOKENS + THINKING_TOKENS], ["linkedin", LINKEDIN_OUTPUT_TOKENS + THINKING_TOKENS]]);
    expect(caps(false, true)).toEqual([["core", CORE_OUTPUT_TOKENS + THINKING_TOKENS], ["posting", POSTING_OUTPUT_TOKENS + THINKING_TOKENS]]);
    expect(caps(true, true)).toEqual([
      ["core", CORE_OUTPUT_TOKENS + THINKING_TOKENS],
      ["linkedin", LINKEDIN_OUTPUT_TOKENS + THINKING_TOKENS],
      ["posting", POSTING_OUTPUT_TOKENS + THINKING_TOKENS],
    ]);
  });

  it("no section's call is larger than the core's: the two sections together would be (34,050 characters against 30,966)", () => {
    expect(measured.linkedin + measured.posting).toBeGreaterThan(measured.core);
    for (const p of analysisParts(true, true).slice(1)) expect(p.maxTokens).toBeLessThan(analysisParts(true, true)[0].maxTokens);
  });

  it("pro's attempt leaves the next model at least 40 s of the part's budget", () => {
    expect(ANALYSIS_BUDGET_MS).toBeLessThanOrEqual(125_000);
    expect(ANALYSIS_BUDGET_MS - PRO_ATTEMPT_MS).toBeGreaterThanOrEqual(40_000);
  });
});

describe("the split is the old schema, cut once", () => {
  it("getAnalysisTools is the old schema, field for field, for every input a buyer may give", () => {
    expect(getAnalysisTools(false, false)).toEqual(old.none);
    expect(getAnalysisTools(true, false)).toEqual(old.linkedin);
    expect(getAnalysisTools(false, true)).toEqual(old.posting);
    expect(getAnalysisTools(true, true)).toEqual(old.both);
  });

  it("the parts' keys cover the old schema's keys exactly once, and each field is the old field", () => {
    for (const [l, j, key] of [[false, false, "none"], [true, false, "linkedin"], [false, true, "posting"], [true, true, "both"]] as const) {
      const params = old[key][0].function.parameters;
      const parts = analysisParts(l, j);
      const keys = parts.flatMap((p) => p.keys);
      expect(new Set(keys).size, "a key is asked twice").toBe(keys.length);
      expect([...keys].sort()).toEqual(Object.keys(params.properties ?? {}).sort());
      for (const p of parts) {
        const props = (p.tools[0].function.parameters as Schema).properties ?? {};
        expect(Object.keys(props).sort()).toEqual([...p.keys].sort());
        for (const k of p.keys) expect(props[k]).toEqual((params.properties ?? {})[k]);
      }
      expect(parts.length, "one call for the core and one for each section the buyer gave").toBe(1 + Number(l) + Number(j));
    }
  });

  it("a résumé alone is the old tool exactly, with no scope note", () => {
    const [only] = analysisParts(false, false);
    expect(only.tools).toEqual(old.none);
    expect(only.scopeNote).toBe("");
  });

  it("the merge takes the core reply as it came and only its own section from each other part", () => {
    const parts = analysisParts(true, true);
    const merged = mergeParts(parts, [
      { atsScore: { score: 70 }, keywords: ["a"], linkedInAnalysis: "stray from the core call", marker: "core" },
      { linkedInAnalysis: { profileScore: 1 }, atsScore: "stray from the LinkedIn call" },
      { jobDescriptionAlignment: { matchScore: 2 }, linkedInAnalysis: "stray from the posting call" },
    ]);
    expect(merged).toEqual({ atsScore: { score: 70 }, keywords: ["a"], marker: "core", linkedInAnalysis: { profileScore: 1 }, jobDescriptionAlignment: { matchScore: 2 } });
  });

  it("a section whose call failed is left out, as the old object left out a section the model did not write", () => {
    const parts = analysisParts(true, true);
    const merged = mergeParts(parts, [
      { keywords: ["a"], jobDescriptionAlignment: "stray from the core call" },
      { linkedInAnalysis: { profileScore: 1 } },
      null,
    ]);
    expect(merged).toEqual({ keywords: ["a"], linkedInAnalysis: { profileScore: 1 } });
  });

  it("the report has one LinkedIn headline: the LinkedIn section's improved one, when it wrote one", () => {
    const parts = analysisParts(true, false);
    const core = { summaryRewrite: { professionalSummary: "S.", linkedInHeadline: "core" } };
    expect(mergeParts(parts, [core, { linkedInAnalysis: { headlineOptimization: { current: "a", improved: "B | C", whyBetter: "d" } } }]).summaryRewrite)
      .toEqual({ professionalSummary: "S.", linkedInHeadline: "B | C" });
    for (const section of [null, { linkedInAnalysis: { headlineOptimization: { improved: "  " } } }, { linkedInAnalysis: {} }]) {
      expect(mergeParts(parts, [core, section]).summaryRewrite).toEqual(core.summaryRewrite);
    }
    // The core's object is not changed in place: the reply stays as it came.
    expect(core.summaryRewrite.linkedInHeadline).toBe("core");
  });

  it("a part's reply is deliverable only with what that part was asked for", () => {
    const [core, linkedin, posting] = analysisParts(true, true);
    expect(usablePart(core, { optimizedBullets: [1], actionVerbs: [1], keywords: [1], redFlags: [] })).toBe(true);
    expect(usablePart(core, { optimizedBullets: [1], actionVerbs: [1], keywords: [1] })).toBe(false);
    expect(usablePart(linkedin, { linkedInAnalysis: {} })).toBe(true);
    expect(usablePart(linkedin, { jobDescriptionAlignment: {} })).toBe(false);
    expect(usablePart(posting, { jobDescriptionAlignment: {} })).toBe(true);
    expect(usablePart(posting, { jobDescriptionAlignment: "text" })).toBe(false);
  });

  it("a reply is read from the tool call, or from JSON in the message, and a truncated one is no reply", () => {
    const tool = (args: string) => ({ choices: [{ message: { tool_calls: [{ function: { arguments: args } }] } }] });
    expect(readToolReply(tool('{"a":1}'))).toEqual({ a: 1 });
    expect(readToolReply(tool('{"a":1, "b": {"c'))).toBeNull();
    expect(readToolReply(tool("[1,2]"))).toBeNull();
    expect(readToolReply({ choices: [{ message: { content: '```json\n{"a":2}\n```' } }] })).toEqual({ a: 2 });
    expect(readToolReply({ choices: [{ message: {} }] })).toBeNull();
    expect(readToolReply(null)).toBeNull();
  });
});
