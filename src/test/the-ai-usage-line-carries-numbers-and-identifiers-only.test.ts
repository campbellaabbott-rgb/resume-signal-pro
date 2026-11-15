// @vitest-environment node
/**
 * THE AI USAGE LINE CARRIES NUMBERS AND IDENTIFIERS ONLY (cost audit
 * 2026-11-08, Do first #11).
 *
 * No function read the gateway's `usage` block, so every AI cost in the audit
 * was an estimate from prompt bytes. Every reply the shared helper parses now
 * logs one line: the chain's label, the model id, four token counts and the
 * finish reason. The function logs are readable by more people than the
 * database is, so the line must never carry a word of the prompt or the
 * reply, an e-mail address, an account id or a network address (S13-064).
 *
 * WHAT THIS HOLDS, against the shipped module:
 *   - the line's shape, for the OpenAI-style and the input/output-style
 *     usage blocks, and "-" for every count the gateway did not report;
 *   - a hostile reply (text in the counts, a sentence in the finish reason,
 *     the résumé in the content) yields a line of the same shape that names
 *     none of it, and a label or model id carrying an address, an account id
 *     or an IP prints without it;
 *   - callAIForUsableReply logs exactly one line per parsed reply, the
 *     refused reply included, naming the model that wrote each, and nothing
 *     for a request the gateway refused before replying.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiUsageLine, callAIForUsableReply, freeChainFrom } from "../../supabase/functions/_shared/ai-fallback";

const SHAPE = /^\[AI-USAGE\] context=[A-Za-z0-9._:/-]+ model=[A-Za-z0-9._:/-]+ prompt_tokens=(\d+|-) completion_tokens=(\d+|-) cached_tokens=(\d+|-) reasoning_tokens=(\d+|-) finish_reason=([a-z_]+|-)$/;
const RESUME = "Jane Doe, jane.doe@example.com, 4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21, led payments at Acme";

describe("the usage line's shape", () => {
  it("reads an OpenAI-style usage block, cached and reasoning counts included", () => {
    const line = aiUsageLine("NL-SEARCH", "google/gemini-3-flash-preview", {
      choices: [{ finish_reason: "tool_calls", message: { content: RESUME } }],
      usage: { prompt_tokens: 1234, completion_tokens: 56, prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens_details: { reasoning_tokens: 40 } },
    });
    expect(line).toBe("[AI-USAGE] context=NL-SEARCH model=google/gemini-3-flash-preview prompt_tokens=1234 completion_tokens=56 cached_tokens=1024 reasoning_tokens=40 finish_reason=tool_calls");
  });

  it("reads an input/output-style block, and prints - for every count the gateway did not report", () => {
    expect(aiUsageLine("COVER-NOTE", "openai/gpt-5-mini", { choices: [{ finish_reason: "length" }], usage: { input_tokens: 900, output_tokens: 400 } }))
      .toBe("[AI-USAGE] context=COVER-NOTE model=openai/gpt-5-mini prompt_tokens=900 completion_tokens=400 cached_tokens=- reasoning_tokens=- finish_reason=length");
    for (const reply of [null, undefined, "text", 42, [], {}, { usage: null, choices: null }]) {
      expect(aiUsageLine("X", "m", reply), JSON.stringify(reply)).toBe("[AI-USAGE] context=X model=m prompt_tokens=- completion_tokens=- cached_tokens=- reasoning_tokens=- finish_reason=-");
    }
  });
});

describe("the usage line never carries text, an address or an account", () => {
  it("a hostile reply yields the same shape and names none of what it carried", () => {
    const line = aiUsageLine("APPLICATION-ANSWERS", "google/gemini-2.5-flash", {
      choices: [{ finish_reason: `stop ${RESUME}`, message: { content: RESUME, tool_calls: [{ function: { arguments: RESUME } }] } }],
      usage: {
        prompt_tokens: `12 ${RESUME}`,
        completion_tokens: -5,
        prompt_tokens_details: { cached_tokens: 3.5 },
        completion_tokens_details: { reasoning_tokens: { text: RESUME } },
        note: RESUME,
      },
      id: RESUME,
    });
    expect(line).toMatch(SHAPE);
    expect(line).toBe("[AI-USAGE] context=APPLICATION-ANSWERS model=google/gemini-2.5-flash prompt_tokens=- completion_tokens=- cached_tokens=- reasoning_tokens=- finish_reason=-");
  });

  it("a label or model id carrying an address, an account id or an IP prints without it", () => {
    const cases: Array<[string, string]> = [
      [`COVER-NOTE ${RESUME}`, "google/gemini-2.5-flash"],
      ["IMPORT-FREELANCE user 4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21", "openai/gpt-5-mini from 198.51.100.4"],
      ["NL-SEARCH 2001:db8:1:2::aaaa", "x@y"],
    ];
    for (const [context, model] of cases) {
      const line = aiUsageLine(context, model, { usage: { prompt_tokens: 1, completion_tokens: 2 } });
      expect(line, line).toMatch(SHAPE);
      expect(line, line).not.toMatch(/@|example|4f9a3c2e|198\.51\.100\.4|2001:db8|aaaa/i);
      // Exactly the eight space-separated fields: no sentence widened it.
      expect(line.split(" ")).toHaveLength(8);
    }
  });
});

describe("callAIForUsableReply logs one line per reply it parsed", () => {
  const realFetch = globalThis.fetch;
  let logged: string[];
  let asked: string[];

  beforeEach(() => {
    logged = [];
    asked = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("the refused reply and the usable one are both counted, each under the model that wrote it", async () => {
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const model = JSON.parse(String(init?.body ?? "{}")).model as string;
      asked.push(model);
      const content = model === "google/gemini-2.5-flash" ? RESUME : JSON.stringify({ ok: true });
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content } }],
        usage: { prompt_tokens: model.length, completion_tokens: 9 },
      }), { status: 200 });
    }) as typeof fetch;

    const reply = await callAIForUsableReply("key", {
      models: freeChainFrom("google/gemini-2.5-flash"),
      messages: [{ role: "user", content: RESUME }],
      maxTokens: 100,
      context: "PRODUCT-PREVIEW",
      read: (data) => {
        try { return JSON.parse((data as { choices: Array<{ message: { content: string } }> }).choices[0].message.content); } catch { return null; }
      },
    });
    expect(reply.ok).toBe(true);
    expect(asked).toEqual(["google/gemini-2.5-flash", "openai/gpt-5-mini"]);
    const usage = logged.filter((l) => l.startsWith("[AI-USAGE]"));
    expect(usage).toEqual([
      "[AI-USAGE] context=PRODUCT-PREVIEW model=google/gemini-2.5-flash prompt_tokens=23 completion_tokens=9 cached_tokens=- reasoning_tokens=- finish_reason=stop",
      "[AI-USAGE] context=PRODUCT-PREVIEW model=openai/gpt-5-mini prompt_tokens=17 completion_tokens=9 cached_tokens=- reasoning_tokens=- finish_reason=stop",
    ]);
    for (const l of usage) expect(l).not.toMatch(/Jane|example|Acme/);
  });

  it("a request the gateway refused before replying is not a parsed reply, so it logs no usage line", async () => {
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      asked.push(JSON.parse(String(init?.body ?? "{}")).model as string);
      return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    }) as typeof fetch;
    const reply = await callAIForUsableReply("key", {
      models: ["google/gemini-2.5-flash", "openai/gpt-5-mini"],
      messages: [{ role: "user", content: "x" }],
      maxTokens: 10,
      context: "NL-SEARCH",
      read: () => ({}),
    });
    expect(reply.ok).toBe(false);
    expect(asked).toEqual(["google/gemini-2.5-flash", "openai/gpt-5-mini"]);
    expect(logged.filter((l) => l.startsWith("[AI-USAGE]"))).toEqual([]);
  });
});
