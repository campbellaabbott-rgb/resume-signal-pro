// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * A REPLY THE CODE CANNOT READ IS LOGGED BY ITS SHAPE, NEVER ITS WORDS (S13-064).
 *
 * parse-resume-structured, generate-apply-package and generate-tailored-resume
 * each logged "Unexpected response format:" followed by JSON.stringify of the
 * whole model reply. The reply to a résumé parser or a tailored résumé is the
 * person's own résumé: their name, email, phone and employers went into the
 * function logs, kept by the platform and readable by anyone with log access.
 *
 * Held by running each shipped handler on a gateway that answers in prose
 * (no tool call) quoting the résumé, and reading every console line the
 * request wrote: none carries the résumé's words; the unexpected-format line
 * still says what the reply was (its keys, finish_reason and lengths); and
 * each function answers as it did.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { WRITING_STUBS, WritingWorld, loadWriter, post } from "./helpers/writing-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const PII = ["Jane Doe", "jane.doe@example.com", "555-0142", "Acme Corp"];
const RESUME = "Jane Doe | jane.doe@example.com | (512) 555-0142\nSenior software engineer at Acme Corp, ten years of TypeScript and Postgres. Led a team of five. ".repeat(2);
const PROSE = "Here is the structured resume for Jane Doe (jane.doe@example.com, (512) 555-0142), senior engineer at Acme Corp.";

let world: WritingWorld;
let lines: string[];

function capture(): void {
  lines = [];
  for (const level of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
}

function expectNoWordsOfTheResume(fn: string): void {
  const formatLine = lines.find((l) => /Unexpected response format/.test(l));
  expect(formatLine, `${fn} logged no unexpected-format line`).toBeDefined();
  expect(formatLine).toMatch(/content=\d+ chars/);
  expect(formatLine).toMatch(/tool_calls=0/);
  for (const line of lines) for (const word of PII) expect(line, `${fn} logged "${word}"`).not.toContain(word);
}

beforeEach(() => {
  world = new WritingWorld();
  world.install();
  world.reply = () => new Response(JSON.stringify({ id: "gen-1", choices: [{ finish_reason: "stop", message: { role: "assistant", content: PROSE } }] }), { status: 200 });
  world.db.rpcs.purchase_spend_take = () => ({ data: true, error: null });
  capture();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("each logger, run as shipped", () => {
  let parser: EdgeHandler;
  let tailored: EdgeHandler;
  let kit: EdgeHandler;
  beforeAll(async () => {
    new WritingWorld().install();
    parser = await loadWriter("parse-resume-structured");
    tailored = await loadWriter("generate-tailored-resume");
    kit = await loadEdgeHandler("generate-apply-package", {
      ...WRITING_STUBS,
      "https://esm.sh/stripe@18.5.0":
        "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', metadata: { product_type: 'apply_assistant' } }) } }; } }",
    });
  }, 240_000);

  it("parse-resume-structured", async () => {
    const r = await post(parser, "parse-resume-structured", { resumeText: RESUME }, "anon");
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: "Invalid AI response format" });
    expectNoWordsOfTheResume("parse-resume-structured");
  });

  it("generate-tailored-resume", async () => {
    const r = await post(tailored, "generate-tailored-resume", { resumeText: RESUME, jobTitle: "Engineer", jobDescription: "Globex is hiring a senior engineer." }, "service");
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: "Invalid AI response format", retryable: true });
    expectNoWordsOfTheResume("generate-tailored-resume");
  });

  it("generate-apply-package", async () => {
    const r = await post(kit, "generate-apply-package", { resumeText: RESUME, jobPostingText: "Globex is hiring a senior engineer to own payments end to end.", sessionId: "cs_live_kit" }, "anon");
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(500);
    expect(r.body).toMatchObject({ error: "Invalid AI response format" });
    expectNoWordsOfTheResume("generate-apply-package");
  });
});
