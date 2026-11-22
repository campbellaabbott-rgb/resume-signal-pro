// @vitest-environment node
/**
 * AN ANALYSIS WITHOUT A SCORE IS NOT DELIVERED AS ZERO (S11-069).
 *
 * WHAT WAS WRONG. The paid analysis's core reply was usable with only
 * optimizedBullets, actionVerbs, keywords and redFlags. A reply without an
 * atsScore was then given {score: 0, breakdown: {keywordMatch, formatting,
 * structure, relevance}} (keys the page never reads) and delivered, redeemed
 * and mailed as 0/100: a buyer told their résumé scores zero because a model
 * left a field out.
 *
 * WHAT HOLDS NOW, on the shipped handler with the model chain faked:
 *   - a core reply with no score, or a score that is no number, is not
 *     usable: the next model is asked, and its score is the one delivered;
 *   - when no model gives one, the answer is a retryable 503 with nothing
 *     redeemed, never a 0;
 *   - a score written as a string holding a number is that number;
 *   - and the pure check says the same.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResumeHarness, analysisFixture, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";
import { analysisParts, usablePart } from "../../supabase/functions/analyze-resume/analysis-parts";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const PRO = "google/gemini-2.5-pro";
const FLASH = "google/gemini-2.5-flash";
const MINI = "openai/gpt-5-mini";
const CHAIN_STUB = {
  "_shared/ai-fallback.ts": `const TAIL = ${JSON.stringify([PRO, FLASH, MINI])};
export const chainFrom = (m) => [m, ...TAIL.filter((x) => x !== m)];
export const callAIWithModelFallback = (key, opts) => globalThis.__scoreAI(opts);
export const logAiUsage = () => {};`,
};

type Opts = { models?: string[]; tools: Array<{ function: { parameters: { properties?: Record<string, unknown> } } }> };
let h: Harness;
let asked: string[];
/** What each model's core reply carries in place of the fixture's atsScore (undefined: none at all). */
let scoreBy: Record<string, unknown>;
const g = globalThis as Record<string, unknown>;

const coreReply = (model: string): Record<string, unknown> => {
  const reply: Record<string, unknown> = { ...analysisFixture(model) };
  if (!(model in scoreBy)) return reply;
  if (scoreBy[model] === undefined) delete reply.atsScore;
  else reply.atsScore = scoreBy[model];
  return reply;
};

beforeAll(async () => { h = await analyzeResumeHarness(CHAIN_STUB); }, 240_000);

beforeEach(() => {
  h.reset();
  asked = [];
  scoreBy = {};
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  g.__scoreAI = async (opts: Opts) => {
    const model = opts.models?.[0] ?? PRO;
    asked.push(model);
    const body = { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(coreReply(model)) } }] } }] };
    return { response: new Response(JSON.stringify(body), { status: 200 }), modelUsed: model };
  };
});
afterEach(() => { vi.restoreAllMocks(); });

const buy = (id: string) => h.sessions.set(id, fullAnalysisSession(id));
const scoreOf = (json: Record<string, unknown>) => (json.atsScore as { score?: unknown } | undefined)?.score;

describe("a core reply with no score", () => {
  it("is passed to the next model, and the score delivered is the one a model gave", async () => {
    buy("cs_noscore_then_flash");
    scoreBy = { [PRO]: undefined };
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_noscore_then_flash" });
    expect(r.status).toBe(200);
    expect(asked, "a reply without a score was delivered without asking the next model").toEqual([PRO, FLASH]);
    expect(scoreOf(r.json), "the analysis went out scored 0/100").toBe(71);
    expect(r.json.marker).toBe(FLASH);
  });

  it("with a score that is no number is passed on the same way", async () => {
    for (const bad of [{ breakdown: {}, improvements: [] }, { score: null }, { score: "n/a" }, { score: "" }, "seventy"]) {
      h.reset();
      asked = [];
      buy("cs_badscore");
      scoreBy = { [PRO]: bad };
      const r = await h.call({ resumeText: RESUME, sessionId: "cs_badscore" });
      expect(r.status, JSON.stringify(bad)).toBe(200);
      expect(asked, JSON.stringify(bad)).toEqual([PRO, FLASH]);
      expect(scoreOf(r.json), JSON.stringify(bad)).toBe(71);
    }
  });

  it("from every model is a retryable 503 with nothing redeemed, never a 0", async () => {
    buy("cs_noscore_anywhere");
    scoreBy = { [PRO]: undefined, [FLASH]: undefined, [MINI]: undefined };
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_noscore_anywhere" });
    expect(r.status, "an analysis no model scored was delivered").toBe(503);
    expect(r.json.retryable).toBe(true);
    expect(asked).toEqual([PRO, FLASH, MINI]);
    expect(h.db.rows("purchased_content"), "the purchase was redeemed for a 0/100").toHaveLength(0);
    expect(h.db.rows("resume_analyses")).toHaveLength(0);
  });
});

describe("a score written as a string", () => {
  it("is delivered as the number it holds", async () => {
    buy("cs_stringscore");
    scoreBy = { [PRO]: { score: "64", breakdown: { jobTitleMatch: 10 }, improvements: [] } };
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_stringscore" });
    expect(r.status).toBe(200);
    expect(asked).toEqual([PRO]);
    expect(scoreOf(r.json)).toBe(64);
  });
});

describe("the check itself", () => {
  const [core] = analysisParts(false, false);
  const base = { optimizedBullets: [1], actionVerbs: [1], keywords: [1], redFlags: [] };
  it("needs a finite ATS score beside the four core fields", () => {
    expect(usablePart(core, { ...base, atsScore: { score: 71 } })).toBe(true);
    expect(usablePart(core, { ...base, atsScore: { score: 0 } }), "a real zero is a score").toBe(true);
    expect(usablePart(core, { ...base, atsScore: { score: "72" } })).toBe(true);
    expect(usablePart(core, base)).toBe(false);
    for (const atsScore of [{}, { score: null }, { score: "n/a" }, { score: Number.NaN }, { score: Number.POSITIVE_INFINITY }, 71, [71]]) {
      expect(usablePart(core, { ...base, atsScore }), JSON.stringify(atsScore)).toBe(false);
    }
  });
});
