// @vitest-environment node
/**
 * THE ANSWERS DRAFTER COUNTS A HELD BOARD PASS, AS THE OTHER WRITERS DO
 * (S14X-205, the server half).
 *
 * The page now sends the board pass it holds; the function hands it to the
 * spend gate, which counts the caller by the pass. Before, the body's pass
 * was never read and the caller was counted by account or address.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signBoardPass } from "../../supabase/functions/job-board/board-pass";
import { SERVICE_KEY, WritingWorld, chatReply, loadWriter, post, tokenFor, FREE_USER } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

let answersFn: EdgeHandler;
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  answersFn = await loadWriter("generate-application-answers");
}, 240_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
  // A board pass counts only where the pass secret is set, as live.
  const deno = (globalThis as unknown as { Deno: { env: { get: (k: string) => string | undefined } } }).Deno;
  const get = deno.env.get;
  deno.env.get = (k: string) => (k === "TURNSTILE_SECRET_KEY" ? "turnstile-harness-secret" : get(k));
  world.reply = () => chatReply(JSON.stringify({ answers: [{ question: "Why do you want to work here?", answer: "I led the payments team at Initech.", supported: true, note: "" }] }));
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const BODY = { resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription: KIT_POSTING, questions: [{ label: "Why do you want to work here?", type: "textarea" }] };

describe("a signed-in caller holding a board pass", () => {
  it("is counted by the pass", async () => {
    const { pass } = await signBoardPass(SERVICE_KEY);
    const r = await post(answersFn, "generate-application-answers", { ...BODY, boardPass: pass }, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const own = world.counts.filter((c) => c.p_function === "generate-application-answers").map((c) => String(c.p_ip));
    expect(own.some((k) => k.startsWith("pass:"))).toBe(true);
  });

  it("positive control: without a pass the same caller is counted by account", async () => {
    const r = await post(answersFn, "generate-application-answers", BODY, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const own = world.counts.filter((c) => c.p_function === "generate-application-answers").map((c) => String(c.p_ip));
    expect(own.some((k) => k.startsWith("pass:"))).toBe(false);
  });
});
