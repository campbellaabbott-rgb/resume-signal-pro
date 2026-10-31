// @vitest-environment node
/**
 * THE $5 FULL ANALYSIS IS ASKED IN PARTS, AND A TIMEOUT SAYS TRY AGAIN (S13-001).
 *
 * WHAT WAS WRONG. analyze-resume asked for the whole analysis in ONE
 * structured call: 179 typed fields with a LinkedIn profile and a posting, on
 * gemini-2.5-pro, with no output cap. A slow reply ran the chain out of its
 * 125 s and the AbortError reached the catch-all: a 500 "An error occurred"
 * with no retryable flag, for a purchase that was never redeemed.
 *
 * NOW. The résumé analysis is one call and, only when the buyer gave them, the
 * LinkedIn and posting sections are another, asked at the same time; each has
 * its own part of the OLD schema, a measured output cap, pro first with a real
 * window left for flash, and a reply it cannot deliver goes to the next model.
 * The parts merge into exactly the object the old call produced, and that
 * object is what the buyer sees, what is stored behind the share link and
 * what the email carries. A chain that runs out of time answers 504 with
 * retryable: true and nothing redeemed, and the same purchase then delivers.
 *
 * The shipped handler runs (helpers/analyze-resume-harness.ts) with the model
 * chain stubbed at the shared module; the old schema is frozen in
 * fixtures/full-analysis-tool-schema.before-s13-001.json (main f8d72a9b).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";
import OLD from "./fixtures/full-analysis-tool-schema.before-s13-001.json";

const PRO = "google/gemini-2.5-pro";
const FLASH = "google/gemini-2.5-flash";
const MINI = "openai/gpt-5-mini";
const EXTRA_KEYS = ["linkedInAnalysis", "jobDescriptionAlignment"];
const LINKEDIN = "Jane Doe | Senior Software Engineer at Acme. About: I build payment systems. Experience: Acme 2019-now.";
const POSTING = "Senior Financial Analyst. We need FP&A, variance analysis, forecasting and SQL for our corporate finance team in Austin.";

// The real chain's order behind the shared module's name, so a part can walk it.
const CHAIN_STUB = {
  "_shared/ai-fallback.ts": `const TAIL = ${JSON.stringify([PRO, FLASH, MINI])};
export const chainFrom = (m) => [m, ...TAIL.filter((x) => x !== m)];
export const callAIWithModelFallback = (key, opts) => globalThis.__fakeAI(opts);`,
};

type Schema = { type: string; properties?: Record<string, Schema>; items?: Schema; required?: string[]; enum?: string[] };
type Tool = { type: string; function: { name: string; description: string; parameters: Schema } };
type Opts = {
  messages: Array<{ role: string; content: string }>;
  tools: Tool[];
  toolChoice: unknown;
  maxTokens?: number;
  models?: string[];
  deadlineMs?: number;
  attemptTimeoutMs?: number;
  context?: string;
};
type Call = { opts: Opts; start: number; end?: number };
type Reply = { response: Response; modelUsed: string };

const oldParams = (k: "none" | "linkedin" | "posting" | "both") => (OLD as unknown as Record<string, Tool[]>)[k][0].function.parameters;

/** A complete answer to a schema: every property, two items per array, a value of each leaf's type. */
function instance(s: Schema, key = ""): unknown {
  if (s.type === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, instance(v, k)]));
  if (s.type === "array") return [instance(s.items as Schema, key), instance(s.items as Schema, key)];
  if (s.type === "number") return 42;
  if (s.type === "boolean") return true;
  return s.enum ? s.enum[0] : `${key} text`;
}

/** The keys at every depth (an array by its first item), so two objects with the same keys everywhere compare equal. */
function keyTree(v: unknown): unknown {
  if (Array.isArray(v)) return v.length ? [keyTree(v[0])] : [];
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, keyTree((v as Record<string, unknown>)[k])]));
  return typeof v;
}
const schemaKeyTree = (s: Schema) => keyTree(instance(s));

const toolReply = (obj: unknown, modelUsed: string, raw?: string): Reply => ({
  response: new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: raw ?? JSON.stringify(obj) } }] } }] }), { status: 200 }),
  modelUsed,
});
const propsOf = (c: Call) => c.opts.tools[0].function.parameters.properties ?? {};
const isCore = (c: Call) => "optimizedBullets" in propsOf(c);
const without = (o: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let h: Harness;
let calls: Call[];
let reply: (opts: Opts, n: number) => Promise<Reply>;
let mails: Array<Record<string, unknown>>;
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  h = await analyzeResumeHarness(CHAIN_STUB);
}, 240_000);

beforeEach(() => {
  h.reset();
  calls = [];
  mails = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  // Every model answers what it was asked, a moment later.
  reply = async (opts) => {
    await pause(40);
    return toolReply(instance(opts.tools[0].function.parameters), opts.models?.[0] ?? PRO);
  };
  g.__fakeAI = async (opts: Opts) => {
    const call: Call = { opts, start: performance.now() };
    calls.push(call);
    try {
      return await reply(opts, calls.length);
    } finally {
      call.end = performance.now();
    }
  };
  g.fetch = async (url: string, init?: RequestInit) => {
    if (String(url).includes("/send-analysis-email")) mails.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  };
});

const buy = (id: string) => h.sessions.set(id, fullAnalysisSession(id));

describe("a LinkedIn profile and a posting: two calls at once, each with its part of the old schema", () => {
  it("asks the résumé analysis and the two sections in parallel, every field exactly as the old schema had it", async () => {
    buy("cs_parts");
    const r = await h.call({ resumeText: RESUME, linkedInText: LINKEDIN, jobDescriptionText: POSTING, sessionId: "cs_parts" });
    expect(r.status).toBe(200);
    expect(calls, "the whole analysis was still one call").toHaveLength(2);
    const [a, b] = calls;
    expect(a.start < (b.end ?? Infinity) && b.start < (a.end ?? Infinity), "the second part waited for the first").toBe(true);

    const core = calls.find(isCore)!;
    const extras = calls.find((c) => !isCore(c))!;
    const old = oldParams("both");
    const oldCoreKeys = Object.keys(old.properties ?? {}).filter((k) => !EXTRA_KEYS.includes(k));
    expect(Object.keys(propsOf(core)).sort()).toEqual([...oldCoreKeys].sort());
    expect(core.opts.tools[0].function.parameters.required).toEqual(old.required);
    expect(Object.keys(propsOf(extras)).sort()).toEqual([...EXTRA_KEYS].sort());
    for (const [k, v] of Object.entries({ ...propsOf(core), ...propsOf(extras) })) {
      expect(v, `${k} is not the field the old schema asked for`).toEqual(old.properties?.[k]);
    }
    for (const c of calls) expect(c.opts.tools[0].function.name).toBe("submit_resume_analysis");

    // Both parts read everything the buyer gave, under the same prompt, each told its scope.
    expect(core.opts.messages[1]).toEqual(extras.opts.messages[1]);
    for (const text of [LINKEDIN, "variance analysis, forecasting and SQL"]) expect(core.opts.messages[1].content).toContain(text);
    const prompt = (c: Call) => c.opts.messages[0].content.split("\n\nCALL SCOPE:")[0];
    expect(prompt(core)).toBe(prompt(extras));
    expect(core.opts.messages[0].content).toMatch(/CALL SCOPE: This call produces the core resume analysis only/);
    expect(extras.opts.messages[0].content).toMatch(/CALL SCOPE: This call writes only the LinkedIn profile analysis and the job description alignment/);
  });

  it("merges into exactly what the old single call delivered for the same answer: the page, the stored copy and the email", async () => {
    buy("cs_merge");
    // Each part also returns a key that belongs to the other: neither may overwrite the other's.
    reply = async (opts) => {
      await pause(20);
      const own = instance(opts.tools[0].function.parameters) as Record<string, unknown>;
      return toolReply("optimizedBullets" in own ? { ...own, linkedInAnalysis: "from the core call" } : { ...own, atsScore: "from the posting call" }, PRO);
    };
    const r = await h.call({ resumeText: RESUME, linkedInText: LINKEDIN, jobDescriptionText: POSTING, sessionId: "cs_merge" });
    expect(r.status).toBe(200);

    // What the old call delivered when the model answered the old schema in full.
    const expected = { ...(instance(oldParams("both")) as Record<string, unknown>), hasLinkedIn: true, hasJobDescription: true };
    const delivered = without(r.json, "shareId", "emailSent");
    expect(delivered).toEqual(expected);
    expect(keyTree(without(delivered, "hasLinkedIn", "hasJobDescription")), "the merged keys are not the old tool schema's").toEqual(schemaKeyTree(oldParams("both")));

    const stored = h.db.rows("resume_analyses");
    expect(stored).toHaveLength(1);
    expect(stored[0].analysis_result, "the copy behind the share link is not the old object").toEqual(expected);
    expect(h.db.rows("purchased_content")[0].generated_content).toEqual({ shareId: r.json.shareId });

    await h.settle();
    expect(mails).toHaveLength(1);
    expect(mails[0].analysisData, "the email does not carry the old object").toEqual(expected);
  });

  it("with only one of the two, the second call asks for that section alone and the merge is the old object for that input", async () => {
    for (const [input, key, oldKey] of [
      [{ linkedInText: LINKEDIN }, "linkedInAnalysis", "linkedin"],
      [{ jobDescriptionText: POSTING }, "jobDescriptionAlignment", "posting"],
    ] as const) {
      h.reset();
      calls = [];
      buy("cs_one");
      const r = await h.call({ resumeText: RESUME, ...input, sessionId: "cs_one" });
      expect(r.status).toBe(200);
      expect(calls).toHaveLength(2);
      expect(Object.keys(propsOf(calls.find((c) => !isCore(c))!))).toEqual([key]);
      expect(keyTree(without(r.json, "shareId", "emailSent", "hasLinkedIn", "hasJobDescription"))).toEqual(schemaKeyTree(oldParams(oldKey)));
    }
  });
});

describe("a résumé alone: one call, the old request but for its cap and its clock", () => {
  it("sends the old tool exactly, with no scope note, capped, on the paid chain with pro cut early enough for flash", async () => {
    buy("cs_solo");
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_solo" });
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.opts.tools, "a résumé-only analysis no longer sends the old tool").toEqual((OLD as unknown as Record<string, unknown>).none);
    expect(c.opts.messages[0].content).not.toContain("CALL SCOPE");
    expect(keyTree(without(r.json, "shareId", "emailSent", "hasLinkedIn", "hasJobDescription"))).toEqual(schemaKeyTree(oldParams("none")));
  });

  it("every call names its output cap, pro first, a pro attempt that leaves flash at least 40 s, and the platform-safe budget", async () => {
    for (const input of [{}, { linkedInText: LINKEDIN, jobDescriptionText: POSTING }]) {
      h.reset();
      calls = [];
      buy("cs_cap");
      await h.call({ resumeText: RESUME, ...input, sessionId: "cs_cap" });
      for (const c of calls) {
        expect(c.opts.maxTokens, "a part was sent with no output cap").toBeGreaterThan(10_000);
        expect(c.opts.models).toEqual([PRO, FLASH, MINI]);
        expect(c.opts.deadlineMs).toBeGreaterThan(120_000);
        expect(c.opts.deadlineMs).toBeLessThanOrEqual(125_000);
        expect(c.opts.attemptTimeoutMs).toBe(80_000);
        expect((c.opts.deadlineMs ?? 0) - (c.opts.attemptTimeoutMs ?? 0), "flash keeps less than 40 s").toBeGreaterThanOrEqual(40_000);
      }
    }
  });
});

describe("a reply a part cannot deliver asks the next model with the time that is left", () => {
  it("pro's truncated reply goes to flash, which delivers", async () => {
    buy("cs_walk");
    reply = async (opts) => {
      if (opts.models?.[0] === PRO) return toolReply(null, PRO, '{"industry": "technology", "atsScore": {"sco');
      return toolReply(instance(opts.tools[0].function.parameters), opts.models?.[0] ?? "?");
    };
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_walk" });
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.opts.models)).toEqual([[PRO, FLASH, MINI], [FLASH, MINI]]);
    expect(calls[1].opts.attemptTimeoutMs, "flash's attempt was cut like pro's").toBeUndefined();
    expect(calls[1].opts.deadlineMs ?? Infinity).toBeLessThanOrEqual(calls[0].opts.deadlineMs ?? 0);
    expect(h.db.rows("purchased_content")).toHaveLength(1);
  });

  it("when no model's reply is usable, the old answer: a 500 and nothing redeemed", async () => {
    buy("cs_none");
    reply = async (opts) => toolReply({ industry: "technology" }, opts.models?.[0] ?? "?");
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_none" });
    expect(r.status).toBe(500);
    expect(calls).toHaveLength(3);
    expect(h.db.rows("purchased_content")).toHaveLength(0);
  });

  it("an unusable reply that spent the part's budget is out of time, not a crash: 504 retryable, nothing redeemed", async () => {
    buy("cs_spent");
    const realNow = Date.now.bind(Date);
    let skew = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    // Pro answers a truncated reply 121 s in: under 5 s of the 125 s are left for anyone else.
    reply = async (opts) => { skew += 121_000; return toolReply({ industry: "technology" }, opts.models?.[0] ?? "?"); };
    try {
      const r = await h.call({ resumeText: RESUME, sessionId: "cs_spent" });
      expect(r.status, "a part that ran out of time answered like a crash").toBe(504);
      expect(r.json.retryable).toBe(true);
    } finally {
      clock.mockRestore();
    }
    expect(calls, "a model was asked with under 5 s left").toHaveLength(1);
    expect(h.db.rows("purchased_content")).toHaveLength(0);
  });
});

describe("a chain that ran out of time answers 504, retryable, and the same purchase then delivers", () => {
  const timedOut = () => new DOMException("The signal has been aborted", "AbortError");

  it("an AbortError from the chain is a 504 with retryable: true and an honest message, never a 500", async () => {
    buy("cs_slow");
    reply = async () => { throw timedOut(); };
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_slow" });
    expect(r.status, "a timed-out analysis still answers like a crash").toBe(504);
    expect(r.json.retryable).toBe(true);
    expect(r.json.code).toBe("analysis_timed_out");
    const msg = String(r.json.error);
    expect(msg).toMatch(/nothing was charged twice/i);
    expect(msg).toMatch(/trying again/i);
    expect(msg.length, "the success page shows a backend message as it is only under 200 characters").toBeLessThan(200);
    expect(h.db.rows("purchased_content")).toHaveLength(0);
    expect(h.db.rows("resume_analyses")).toHaveLength(0);
    expect(h.db.rows("used_stripe_sessions")).toHaveLength(0);

    reply = async (opts) => toolReply(instance(opts.tools[0].function.parameters), PRO);
    const again = await h.call({ resumeText: RESUME, sessionId: "cs_slow" });
    expect(again.status, "trying again was not safe after all").toBe(200);
    expect(h.db.rows("purchased_content")).toHaveLength(1);
  });

  it("the chain's own budget spent before any model answered is a 504 too", async () => {
    buy("cs_budget");
    reply = async () => { throw new Error("ANALYZE-RESUME core: timed out before any model answered"); };
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_budget" });
    expect(r.status).toBe(504);
    expect(r.json.retryable).toBe(true);
  });

  it("one part out of time while the other answered: 504, and nothing half-delivered is stored", async () => {
    buy("cs_half");
    reply = async (opts) => {
      if ("optimizedBullets" in (opts.tools[0].function.parameters.properties ?? {})) return toolReply(instance(opts.tools[0].function.parameters), PRO);
      await pause(20);
      throw timedOut();
    };
    const r = await h.call({ resumeText: RESUME, linkedInText: LINKEDIN, jobDescriptionText: POSTING, sessionId: "cs_half" });
    expect(r.status).toBe(504);
    expect(r.json.retryable).toBe(true);
    expect(h.db.rows("resume_analyses")).toHaveLength(0);
    expect(h.db.rows("purchased_content")).toHaveLength(0);
  });

  it("a gateway refusal is answered as the single call answered it", async () => {
    for (const [status, want] of [[429, 429], [402, 503], [500, 500]] as const) {
      h.reset();
      buy("cs_refused");
      reply = async () => ({ response: new Response(JSON.stringify({ error: "upstream" }), { status }), modelUsed: PRO });
      const r = await h.call({ resumeText: RESUME, sessionId: "cs_refused" });
      expect(r.status, `a ${status} from the gateway`).toBe(want);
      expect(r.json.retryable).toBeUndefined();
      expect(h.db.rows("purchased_content")).toHaveLength(0);
    }
  });
});
