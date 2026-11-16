// @vitest-environment node
/**
 * A TAILORED RÉSUMÉ IS FACT-CHECKED, AND THE MODEL IS NEVER TOLD TO INJECT
 * THE KEYWORDS THE RÉSUMÉ LACKS (S14X-059).
 *
 * The tailor told the model to rewrite bullets "to inject missing JD keywords"
 * and to "address" the gap skills, then delivered whatever came back: a
 * bullet claiming a certification or a figure the person never had went out
 * as copy-paste-ready text. Now a gap goes to keywordGaps, every summary,
 * bullet and letter opening is checked against the résumé, a draft that
 * states what the résumé does not is asked for once more and then refused
 * (retryable, the use given back), and key skills the résumé does not state
 * are dropped.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WritingWorld, loadWriter, post, toolReply, tokenFor, FREE_USER } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

let tailor: EdgeHandler;
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  tailor = await loadWriter("generate-tailored-resume");
}, 240_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const REQUEST = { resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription: KIT_POSTING, missingSkills: ["Kubernetes", "CISSP"] };

function tailored(over: Record<string, unknown> = {}) {
  return {
    professionalSummary: "Senior software engineer who led a payments team on TypeScript and Postgres services.",
    keySkills: ["TypeScript", "Postgres", "Kubernetes"],
    experienceHighlights: [
      { original: "Cut checkout latency by 40% with a caching layer", tailored: "Cut checkout latency by 40% by building a caching layer for payments services", keywordsInjected: ["checkout", "payments"] },
    ],
    keywordsRequired: ["TypeScript", "Postgres", "Kubernetes"],
    keywordGaps: ["Kubernetes"],
    matchScoreDelta: 10,
    suggestedJobTitle: "Senior Software Engineer",
    coverLetterOpening: "My work on payments services fits this role well.",
    applicationTips: ["Lead with the checkout latency result."],
    ...over,
  };
}

const INVENTED = tailored({
  professionalSummary: "CISSP-certified senior engineer who ran a $2M payments programme.",
  experienceHighlights: [
    { original: "Led the payments team of five engineers on TypeScript and Postgres services", tailored: "Led a $2M payments programme as a CISSP-certified engineer", keywordsInjected: ["CISSP"] },
  ],
});

describe("a draft that claims what the résumé does not", () => {
  it("is asked for once more, then refused as retryable, and the use is given back", async () => {
    world.reply = () => toolReply("submit_tailored_resume", INVENTED);
    const r = await post(tailor, "generate-tailored-resume", REQUEST, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.retryable).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("CISSP-certified");
    expect(world.ai.length).toBe(2);
    expect(world.refunds.length).toBe(1);
  });

  it("is delivered when the second draft keeps to the résumé", async () => {
    let n = 0;
    world.reply = () => toolReply("submit_tailored_resume", n++ === 0 ? INVENTED : tailored());
    const r = await post(tailor, "generate-tailored-resume", REQUEST, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(String(r.body.professionalSummary)).not.toMatch(/CISSP|\$2M/);
    expect(world.refunds).toEqual([]);
  });
});

describe("a draft that keeps to the résumé", () => {
  it("is delivered with the key skills the résumé does not state dropped", async () => {
    world.reply = () => toolReply("submit_tailored_resume", tailored());
    const r = await post(tailor, "generate-tailored-resume", REQUEST, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.keySkills).toEqual(["TypeScript", "Postgres"]);
    expect(world.ai.length).toBe(1);
  });

  it("was asked for without any instruction to inject the missing keywords", async () => {
    world.reply = () => toolReply("submit_tailored_resume", tailored());
    await post(tailor, "generate-tailored-resume", REQUEST, tokenFor(FREE_USER));
    const prompt = world.prompts();
    expect(prompt).not.toMatch(/inject missing JD keywords/i);
    expect(prompt).not.toMatch(/GAP SKILLS TO ADDRESS WITH TRANSFERABLE EXPERIENCE/);
    expect(prompt).toMatch(/keywordGaps/);
    const tool = JSON.stringify(world.ai[0].body.tools);
    expect(tool).not.toMatch(/keywords injected naturally/i);
  });
});
