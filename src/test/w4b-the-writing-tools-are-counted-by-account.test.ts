// @vitest-environment node
/**
 * THE WRITING TOOLS ARE COUNTED BY ACCOUNT (owner decision 2026-10-12).
 *
 * The tailored résumé, the cover letter and the interview-prep set answered
 * anyone holding the publishable key: every visitor got Pro's headline tools
 * with no sign-in. The server now decides by account, whatever page calls:
 *   - signed out: 401 { error: "sign_in_required" }, before any count or model call;
 *   - a free account: one of each a UTC day, on the Flash chain;
 *   - Pro: five a UTC day and sixty a UTC month of each, on the quality chain;
 *   - spent: 429 { error: "daily_limit" | "monthly_limit", resetsAt } and a Retry-After;
 *   - a call that does not deliver gives its use back;
 *   - our own servers (paid deliveries) and a past buyer's purchase are not counted.
 * Each generator runs as shipped (helpers/writing-harness), only its network faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { chatReply, FREE_USER, loadWriter, post, PRO_USER, tokenFor, toolReply, WritingWorld } from "./helpers/writing-harness";
import { WRITING_ALLOWANCE as SERVER } from "../../supabase/functions/_shared/writing-allowance";
import { WRITING_ALLOWANCE as PAGES } from "@/config/writing-allowance";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work at Acme Corp. Led a team of five. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end, with on-call and mentoring for the team.";

const LETTER = JSON.stringify({ coverLetter: "Dear Hiring Manager,\n\nAt Acme Corp I led a team of five on payments work in TypeScript and Postgres. I would bring the same care to your checkout services.\n\nBest,\nJane Doe", openingLine: "x", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "x", alternateOpenings: [] });
const PREP = JSON.stringify({ interviewProfile: { targetRole: "Engineer", difficulty: "Senior", interviewType: "mix" }, questions: [], interviewTips: { beforeInterview: [], duringInterview: [], closingQuestions: [] } });
const TAILORED = { professionalSummary: "Engineer", keySkills: [], experienceHighlights: [], keywordsRequired: [], keywordGaps: [], matchScoreDelta: 5, suggestedJobTitle: "Engineer", coverLetterOpening: "x", applicationTips: [] };

type Tool = { fn: string; tool: "letter" | "resume" | "prep"; body: Record<string, unknown>; ok: () => Response };
const TOOLS: Tool[] = [
  { fn: "generate-cover-letter", tool: "letter", body: { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING }, ok: () => chatReply(LETTER) },
  { fn: "generate-tailored-resume", tool: "resume", body: { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING }, ok: () => toolReply("submit_tailored_resume", TAILORED) },
  { fn: "generate-interview-coach", tool: "prep", body: { resumeText: RESUME, targetRole: "Engineer", mode: "generate" }, ok: () => chatReply(PREP) },
];

const handlers = new Map<string, EdgeHandler>();
let world: WritingWorld;

beforeAll(async () => {
  new WritingWorld().install();
  for (const t of TOOLS) handlers.set(t.fn, await loadWriter(t.fn));
  handlers.set("generate-apply-package", await loadWriter("generate-apply-package"));
}, 180_000);

beforeEach(() => {
  world = new WritingWorld();
  world.install();
});

describe("the pages say the server's numbers", () => {
  it("the mirror equals the server's allowance", () => {
    expect(PAGES).toEqual(SERVER);
    expect(SERVER).toEqual({ freePerToolPerDay: 1, proPackagesPerDay: 5, proPackagesPerMonth: 60 });
  });
});

for (const t of TOOLS) {
  describe(t.fn, () => {
    const call = (who: string, body = t.body) => post(handlers.get(t.fn)!, t.fn, body, who);

    it("signed out: 401 sign_in_required, before any count, any allowance or any model call", async () => {
      world.reply = t.ok;
      const r = await call("anon");
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("sign_in_required");
      expect(typeof r.body.message).toBe("string");
      expect(world.takes).toEqual([]);
      expect(world.counts).toEqual([]);
      expect(world.ai).toEqual([]);
    });

    it("a token the auth server does not know is signed out too", async () => {
      const r = await call(tokenFor("00000000-0000-4000-8000-000000000000"));
      expect(r.status).toBe(401);
      expect(world.ai).toEqual([]);
    });

    it("a free account takes one use of its own tool a day and is written on Flash", async () => {
      world.reply = t.ok;
      const r = await call(tokenFor(FREE_USER));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(world.takes).toEqual([{ p_user_id: FREE_USER, p_tools: [t.tool], p_per_day: 1, p_per_month: null, p_tier: "free" }]);
      expect(world.ai[0].model).toBe("google/gemini-2.5-flash");
      expect(world.refunds).toEqual([]);
    });

    it("Pro takes from five a day and sixty a month and is written on the quality chain", async () => {
      world.reply = t.ok;
      const r = await call(tokenFor(PRO_USER));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(world.takes).toEqual([{ p_user_id: PRO_USER, p_tools: [t.tool], p_per_day: 5, p_per_month: 60, p_tier: "pro" }]);
      expect(world.ai[0].model).toBe("google/gemini-2.5-pro");
    });

    it("a spent day answers 429 daily_limit with resetsAt and a Retry-After, before the model", async () => {
      const resetsAt = new Date(Date.now() + 5 * 3600_000).toISOString();
      world.take = () => ({ allowed: false, reason: "daily_limit", tool: t.tool, limit: 1, resets_at: resetsAt });
      world.reply = t.ok;
      const r = await call(tokenFor(FREE_USER));
      expect(r.status).toBe(429);
      expect(r.body).toMatchObject({ error: "daily_limit", resetsAt, limit: 1, tier: "free" });
      expect(String(r.body.message)).toMatch(/UTC/);
      expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(3600);
      expect(world.ai).toEqual([]);
      expect(world.counts, "a refused call spent a rate slot").toEqual([]);
    });

    it("a spent month answers 429 monthly_limit", async () => {
      world.take = () => ({ allowed: false, reason: "monthly_limit", tool: t.tool, limit: 60, resets_at: "2026-11-01T00:00:00Z" });
      const r = await call(tokenFor(PRO_USER));
      expect(r.status).toBe(429);
      expect(r.body).toMatchObject({ error: "monthly_limit", limit: 60, tier: "pro" });
    });

    it("an allowance that cannot be read is a refusal (503), never a pass", async () => {
      world.db.rpcs.take_writing_tools = () => ({ data: null, error: { message: "boom" } });
      world.reply = t.ok;
      const r = await call(tokenFor(FREE_USER));
      expect(r.status).toBe(503);
      expect(world.ai).toEqual([]);
    });

    it("a call that does not deliver gives its use back", async () => {
      world.reply = () => new Response(JSON.stringify({ error: "down" }), { status: 400 });
      const r = await call(tokenFor(FREE_USER));
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(world.refunds).toEqual([{ p_user_id: FREE_USER, p_use_ids: [`use-${t.tool}-0`] }]);
    });

    it("a spend-gate refusal after the take gives the use back", async () => {
      world.db.rpcs.check_rate_limit = () => ({ data: false, error: null });
      const r = await call(tokenFor(FREE_USER));
      expect(r.status).toBe(429);
      expect(r.body.code).toBe("rate_limited_function");
      expect(world.refunds.length).toBe(1);
      expect(world.ai).toEqual([]);
    });

    it("our own servers are not counted by account", async () => {
      world.reply = t.ok;
      const r = await call("service");
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(world.takes).toEqual([]);
      expect(world.ai.length).toBeGreaterThan(0);
    });
  });
}

describe("a past buyer keeps the purchase", () => {
  it("generate-cover-letter: a Cover Letter purchase named from the success page is not counted by account", async () => {
    world.db.rows("used_stripe_sessions").push({ session_id: "cs_letter", product_type: "cover_letter" });
    world.reply = TOOLS[0].ok;
    const r = await post(handlers.get("generate-cover-letter")!, "generate-cover-letter", { ...TOOLS[0].body, sessionId: "cs_letter" }, "anon");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(world.takes).toEqual([]);
  });

  it("generate-cover-letter: a scan pack or a made-up session is not a letter purchase, so signed out is refused", async () => {
    world.db.rows("used_stripe_sessions").push({ session_id: "cs_scan", product_type: "scan_pack" });
    for (const sessionId of ["cs_scan", "cs_made_up"]) {
      const r = await post(handlers.get("generate-cover-letter")!, "generate-cover-letter", { ...TOOLS[0].body, sessionId }, "anon");
      expect(r.status, sessionId).toBe(401);
    }
    expect(world.ai).toEqual([]);
  });

  it("generate-interview-coach: an Interview Coach purchase is not counted by account", async () => {
    world.db.rows("used_stripe_sessions").push({ session_id: "cs_coach", product_type: "interview_coach" });
    world.reply = TOOLS[2].ok;
    const r = await post(handlers.get("generate-interview-coach")!, "generate-interview-coach", { ...TOOLS[2].body, sessionId: "cs_coach" }, "anon");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(world.takes).toEqual([]);
  });
});

describe("scoring a practised answer", () => {
  const evaluate = { resumeText: RESUME, mode: "evaluate", question: "Tell me about a hard bug.", answer: "I traced a payments race in Postgres and fixed it with a lock." };
  const EVAL = JSON.stringify({ score: 7, grade: "B", strengths: [], improvements: [], revisedAnswer: "x", recruiterReaction: "x" });

  it("needs an account: signed out is 401 before the model", async () => {
    const r = await post(handlers.get("generate-interview-coach")!, "generate-interview-coach", evaluate, "anon");
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("sign_in_required");
    expect(world.ai).toEqual([]);
  });

  it("a signed-in account scores without spending its daily prep set", async () => {
    world.reply = () => chatReply(EVAL);
    const r = await post(handlers.get("generate-interview-coach")!, "generate-interview-coach", evaluate, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(world.takes).toEqual([]);
  });
});

describe("generate-apply-package: Pro's kit is one tailored résumé from the allowance", () => {
  const KIT = { resumeText: RESUME, jobPostingText: POSTING, jobTitle: "Engineer", jobCompany: "Initech" };

  it("takes the résumé use on Pro's figures, and a spent day is 429 before the model", async () => {
    world.take = () => ({ allowed: false, reason: "daily_limit", tool: "resume", limit: 5, resets_at: new Date(Date.now() + 3600_000).toISOString() });
    const r = await post(handlers.get("generate-apply-package")!, "generate-apply-package", KIT, tokenFor(PRO_USER));
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("daily_limit");
    expect(world.takes).toEqual([{ p_user_id: PRO_USER, p_tools: ["resume"], p_per_day: 5, p_per_month: 60, p_tier: "pro" }]);
    expect(world.ai).toEqual([]);
  });

  it("gives the use back when no kit is delivered", async () => {
    world.reply = () => new Response(JSON.stringify({ error: "down" }), { status: 400 });
    const r = await post(handlers.get("generate-apply-package")!, "generate-apply-package", KIT, tokenFor(PRO_USER));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(world.refunds).toEqual([{ p_user_id: PRO_USER, p_use_ids: ["use-resume-0"] }]);
  });

  it("a free account is still asked to go Pro (402) and spends nothing", async () => {
    const r = await post(handlers.get("generate-apply-package")!, "generate-apply-package", KIT, tokenFor(FREE_USER));
    expect(r.status).toBe(402);
    expect(world.takes).toEqual([]);
  });
});
