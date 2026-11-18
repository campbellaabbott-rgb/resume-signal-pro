// @vitest-environment node
/**
 * THE AI PROVIDER OUT OF CREDITS IS OUR OUTAGE, NOT THE CALLER'S PURCHASE
 * (S14X-109).
 *
 * When the AI gateway answers 402 (its credits ran out), the shared check
 * and the three writers' own branches answered HTTP 402, the status this site
 * uses for "buy something". A page reading 402 as a purchase question told a
 * paying member to buy Pro for an outage. A gateway 402 is now a retryable
 * 503 { code: "ai_unavailable" } with Retry-After; 402 stays for our own
 * purchase refusals. Run against the shipped handlers with only the network
 * faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAiGatewayResponse } from "../../supabase/functions/_shared/ai-gateway-response";
import { WritingWorld, loadWriter, post, tokenFor, PRO_USER, FREE_USER } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const outOfCredits = () => new Response(JSON.stringify({ error: "Payment required" }), { status: 402 });

const expectOutage = (r: { status: number; body: Record<string, unknown>; headers: Headers }, fn: string) => {
  expect(r.status, `${fn}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(503);
  expect(r.body, fn).toMatchObject({ code: "ai_unavailable", retryable: true });
  expect(Number(r.headers.get("retry-after")), fn).toBeGreaterThan(0);
  expect(r.body.requiresPurchase, fn).toBeUndefined();
};

describe("the shared gateway check", () => {
  it("answers a gateway 402 as a retryable 503 with Retry-After", async () => {
    const res = await checkAiGatewayResponse(new Response("", { status: 402 }), { "Access-Control-Allow-Origin": "*" });
    expect(res!.status).toBe(503);
    expect(Number(res!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res!.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res!.json()).toMatchObject({ code: "ai_unavailable", retryable: true });
  });
});

describe("each writer, run as shipped, on a gateway out of credits", () => {
  let world: WritingWorld;
  const handlers: Record<string, EdgeHandler> = {};
  beforeAll(async () => {
    new WritingWorld().install();
    for (const fn of ["generate-apply-package", "generate-tailored-resume", "generate-application-answers", "generate-interview-coach"]) {
      handlers[fn] = await loadWriter(fn);
    }
  }, 240_000);
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
    world.reply = outOfCredits;
  });

  it("generate-apply-package: a Pro member's kit is a 503, and the use is given back", async () => {
    const r = await post(handlers["generate-apply-package"], "generate-apply-package", { resumeText: KIT_RESUME, jobPostingText: KIT_POSTING }, tokenFor(PRO_USER));
    expectOutage(r, "generate-apply-package");
    expect(world.refunds.length).toBe(1);
  });

  it("generate-tailored-resume", async () => {
    const r = await post(handlers["generate-tailored-resume"], "generate-tailored-resume", { resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobDescription: KIT_POSTING }, tokenFor(FREE_USER));
    expectOutage(r, "generate-tailored-resume");
    expect(world.refunds.length).toBe(1);
  });

  it("generate-application-answers: the screening answers and the cover note", async () => {
    const answers = await post(handlers["generate-application-answers"], "generate-application-answers", {
      resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription: KIT_POSTING,
      questions: [{ label: "Why do you want to work at Hooli?" }],
    }, "service");
    expectOutage(answers, "generate-application-answers answers");
    const note = await post(handlers["generate-application-answers"], "generate-application-answers", {
      mode: "cover-note", resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription: KIT_POSTING, language: "en",
    }, "service");
    expectOutage(note, "generate-application-answers cover note");
  });

  it("generate-interview-coach: scoring an answer", async () => {
    const r = await post(handlers["generate-interview-coach"], "generate-interview-coach", {
      resumeText: KIT_RESUME, mode: "evaluate", question: "Tell me about a hard bug.", answer: "I traced a checkout race to a cache and fixed it.",
    }, "service");
    expectOutage(r, "generate-interview-coach");
  });
});
