// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * A TAILORED RÉSUMÉ READS THE WHOLE RÉSUMÉ (S13-008, the tailored-résumé part).
 *
 * generate-tailored-resume sent the model resumeText.slice(0, 15000) and said
 * nothing: a long résumé lost its later roles, education and certifications
 * without a word, and the "original bullet verbatim" the tool asks for could
 * only come from the first 15,000 characters. Every other writer reads the
 * résumé up to the shared cap (_shared/input-limits.ts, 50,000) and refuses a
 * longer one in words.
 *
 * Held by running the shipped handler: a 20,000-character résumé reaches the
 * model whole, its last line included; one over the shared cap is refused
 * with the shared words before the account's use is taken or the model asked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { FREE_USER, WritingWorld, loadWriter, post, tokenFor, toolReply } from "./helpers/writing-harness";
import { MAX_RESUME_LENGTH } from "../../supabase/functions/_shared/input-limits";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const TAILORED = { professionalSummary: "Engineer", keySkills: [], experienceHighlights: [], keywordsRequired: [], keywordGaps: [], matchScoreDelta: 5, suggestedJobTitle: "Engineer", coverLetterOpening: "x", applicationTips: [] };
const ROLE = "- Led payments work at Acme Corp in TypeScript and Postgres for a team of five.\n";
const LAST = "CERTIFICATIONS: AWS Certified Solutions Architect (2021), the line past character 15,000";

let handler: EdgeHandler;
let world: WritingWorld;

beforeAll(async () => {
  new WritingWorld().install();
  handler = await loadWriter("generate-tailored-resume");
}, 240_000);

beforeEach(() => {
  world = new WritingWorld();
  world.install();
  world.reply = () => toolReply("submit_tailored_resume", TAILORED);
});

const userPrompt = () => String((world.ai[0].body.messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "");

describe("generate-tailored-resume, run as shipped", () => {
  it("a 20,000-character résumé reaches the model whole, its last line included", async () => {
    const resume = ROLE.repeat(Math.ceil((20_000 - LAST.length) / ROLE.length)) + LAST;
    expect(resume.length).toBeGreaterThan(20_000);
    const r = await post(handler, "generate-tailored-resume", { resumeText: resume, jobTitle: "Engineer", jobDescription: "Globex is hiring a senior engineer." }, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(userPrompt()).toContain(LAST);
    expect(userPrompt()).toContain(resume);
  });

  it("a résumé over the shared cap is refused in the shared words, before the use is taken or the model asked", async () => {
    const r = await post(handler, "generate-tailored-resume", { resumeText: "x".repeat(MAX_RESUME_LENGTH + 1), jobTitle: "Engineer" }, tokenFor(FREE_USER));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/Resume text is too long\. Please limit to 50,000 characters\./);
    expect(world.takes).toEqual([]);
    expect(world.ai).toEqual([]);
  });

  it("a résumé at the cap is read", async () => {
    const r = await post(handler, "generate-tailored-resume", { resumeText: "y".repeat(MAX_RESUME_LENGTH), jobTitle: "Engineer" }, tokenFor(FREE_USER));
    expect(r.status).toBe(200);
    expect(userPrompt()).toContain("y".repeat(MAX_RESUME_LENGTH));
  });
});
