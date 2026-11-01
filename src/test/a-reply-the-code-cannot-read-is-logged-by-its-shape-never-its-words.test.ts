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

/*
 * THE PARSE ERROR QUOTES THE REPLY (recheck of S13-064). The lines kept for a
 * tool call whose arguments do not parse logged String(error), and V8's
 * JSON.parse message quotes up to about ten characters either side of where
 * it failed: an unquoted name in the arguments put "Jane Doe" into the logs.
 * Now a SyntaxError is logged by its name and position only (describeError).
 */
const MALFORMED = '{"summary": "Senior engineer", "name": Jane Doe, "email": jane.doe@example.com}';
const malformedCall = (name: string) =>
  new Response(JSON.stringify({ id: "gen-2", choices: [{ finish_reason: "stop", message: { role: "assistant", tool_calls: [{ function: { name, arguments: MALFORMED } }] } }] }), { status: 200 });

function expectNoWordsInAnyLine(fn: string): void {
  expect(lines.some((l) => /SyntaxError/.test(l)), `${fn} logged no parse failure`).toBe(true);
  for (const line of lines) for (const word of PII) expect(line, `${fn} logged "${word}"`).not.toContain(word);
}

describe("describeError", () => {
  it("names a SyntaxError and its position, never the text around it", async () => {
    const { describeError } = await import("../../supabase/functions/_shared/ai-fallback");
    let thrown: unknown;
    try {
      JSON.parse(MALFORMED);
    } catch (e) {
      thrown = e;
    }
    expect(String(thrown), "the engine's own message quotes the reply (the reason for this)").toMatch(/Jane|Doe/);
    const line = describeError(thrown);
    expect(line).toMatch(/^SyntaxError/);
    for (const word of ["Jane", "Doe", "jane"]) expect(line).not.toContain(word);
    let cut: unknown;
    try {
      JSON.parse('{"name": "Jane Doe');
    } catch (e) {
      cut = e;
    }
    expect(describeError(cut)).toMatch(/^SyntaxError( at position \d+| at the end of the input)?$/);
    expect(describeError(Object.assign(new Error("The signal has been aborted"), { name: "AbortError" }))).toBe("AbortError: The signal has been aborted");
    expect(describeError("Jane Doe")).toBe("string");
  });
});

describe("a tool call whose arguments do not parse, run as shipped", () => {
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
    world.reply = () => malformedCall("submit_structured_resume");
    const r = await post(parser, "parse-resume-structured", { resumeText: RESUME }, "anon");
    expect(r.status).toBe(422);
    expectNoWordsInAnyLine("parse-resume-structured");
  });

  it("generate-tailored-resume", async () => {
    world.reply = () => malformedCall("submit_tailored_resume");
    const r = await post(tailored, "generate-tailored-resume", { resumeText: RESUME, jobTitle: "Engineer", jobDescription: "Globex is hiring a senior engineer." }, "service");
    expect(r.status).toBe(422);
    expectNoWordsInAnyLine("generate-tailored-resume");
  });

  it("generate-apply-package, the first draft", async () => {
    world.reply = () => malformedCall("submit_apply_package");
    const r = await post(kit, "generate-apply-package", { resumeText: RESUME, jobPostingText: "Globex is hiring a senior engineer to own payments end to end.", sessionId: "cs_live_kit" }, "anon");
    expect(r.status).toBe(422);
    expectNoWordsInAnyLine("generate-apply-package");
  });

  it("generate-apply-package, the regeneration after the fact check refused the draft", async () => {
    const invented = {
      jobMetadata: { title: "Engineer", company: "Globex" },
      tailoredResume: { contact: {}, summary: "Senior software engineer.", experience: [{ company: "Initech Global Holdings", title: "Senior software engineer", startDate: "", endDate: "", bullets: [] }], education: [], skills: [], certifications: [] },
      skillGaps: [],
      checklist: [],
    };
    let n = 0;
    world.reply = () => (n++ === 0
      ? new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { tool_calls: [{ function: { name: "submit_apply_package", arguments: JSON.stringify(invented) } }] } }] }), { status: 200 })
      : malformedCall("submit_apply_package"));
    const r = await post(kit, "generate-apply-package", { resumeText: RESUME, jobPostingText: "Globex is hiring a senior engineer to own payments end to end.", sessionId: "cs_live_kit" }, "anon");
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(422);
    expect(n).toBe(2);
    expectNoWordsInAnyLine("generate-apply-package regeneration");
  });
});
