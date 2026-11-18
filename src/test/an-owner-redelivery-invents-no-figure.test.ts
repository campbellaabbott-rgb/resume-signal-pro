// @vitest-environment node
/**
 * AN OWNER RE-DELIVERY INVENTS NO FIGURE (RC-S12-106).
 *
 * admin-regenerate-delivery (the owner's tool that remakes a customer's
 * Premium Package and mails it to them) asked the model to quantify
 * achievements from guessed metrics and the letter to connect experiences
 * "with metrics", ran neither the contact guard nor the figure check the
 * premium package runs, and mailed what came back with a score no one had
 * measured. Now, as the premium package does:
 *   - the prompts forbid any figure the résumé does not state;
 *   - a phone, email or link the résumé does not contain is taken out;
 *   - a draft with an invented figure is sent back once with the figures
 *     named; a résumé line that still carries one is put back to the
 *     résumé's own line; a draft that still fails is refused (the background
 *     task ends 422): nothing is saved, nothing is mailed;
 *   - the mail carries no score.
 *
 * Held on the shipped handler with the gateway, the database and Resend
 * faked and the background task awaited.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const ADMIN = "admin-key-for-the-harness-0123456789abcdef";
type Sent = { subject: string; html: string; to: string[] };
type Asked = { model: string; body: { messages: Array<{ role: string; content: string }>; max_completion_tokens: number } };

const sent: Sent[] = [];
const asked: Asked[] = [];
const background: Promise<unknown>[] = [];
let db: FakeDb;
let answer: (a: Asked) => Response = () => new Response("{}", { status: 500 });
let handler: EdgeHandler;

const SOURCE = [
  "JANE DOE",
  "jane@example.com",
  "Senior Engineer, Acme Corp",
  "- Led a team of five on payments in TypeScript and Postgres.",
  "- Cut checkout errors by 30% in 2023.",
  "- Mentored new engineers and ran the on-call rota.",
].join("\n");
const INVENTED_PHONE = "(415) 555-0199";

const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
const isLetter = (a: Asked) => a.body.max_completion_tokens === 4000;
const isRepair = (a: Asked) => a.body.messages.some((m) => m.role === "assistant");

const resumeJson = (rewrittenResume: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  rewrittenResume, professionalSummary: "Payments engineer.", keyChanges: [], addedKeywords: ["Postgres"], highlights: [], ...extra,
});
const letterJson = (coverLetter: string) => JSON.stringify({
  coverLetter, openingLine: "", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "Senior Engineer application",
});

const GROUNDED = [
  "JANE DOE",
  "jane@example.com",
  "Senior Engineer, Acme Corp",
  "- Led a team of five engineers on payments in TypeScript and Postgres.",
  "- Cut checkout errors by 30% in 2023 through better retries.",
  "- Mentored new engineers and ran the on-call rota for the payments team.",
].join("\n");
const GROUNDED_LETTER = "Dear Hiring Manager,\n\nAt Acme I cut checkout errors by 30%.\n\nJane";
const INVENTED_LETTER = "Dear Hiring Manager,\n\nAt Acme I grew payments revenue to $2M.\n\nJane";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-harness", RESEND_API_KEY: "re_harness",
    LOVABLE_API_KEY: "lovable-harness", ADMIN_API_KEY: ADMIN,
  };
  g.__sentRedelivery = sent;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { background.push(p); } };
  handler = await loadEdgeHandler("admin-regenerate-delivery", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__sentRedelivery.push(m); return { data: { id: 'em_1' }, error: null }; } }; } }",
  });
  const realFetch = g.fetch as typeof fetch;
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (!String(url).includes("ai.gateway.lovable.dev")) return realFetch(url, init as RequestInit);
    const body = JSON.parse(String(init?.body ?? "{}")) as Asked["body"] & { model: string };
    const a = { model: String(body.model), body };
    asked.push(a);
    return answer(a);
  };
}, 60_000);

beforeEach(() => {
  db = new FakeDb();
  (globalThis as Record<string, unknown>).__fakeSupabase = db;
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});
afterEach(() => {
  sent.length = 0;
  asked.length = 0;
  background.length = 0;
  vi.restoreAllMocks();
});

/** One regeneration; answers how the background task ended. */
async function regenerate(): Promise<{ status?: number; part?: string } | undefined> {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/admin-regenerate-delivery", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN },
    body: JSON.stringify({ email: "buyer@example.com", resumeText: SOURCE, jobTitle: "Senior Engineer", jobCompany: "Initech" }),
  }));
  expect(res.status).toBe(200);
  const [outcome] = await Promise.all(background);
  return outcome as { status?: number; part?: string } | undefined;
}
const saved = () => db.rows("purchased_content");

describe("the prompts ask for no figure the résumé does not state", () => {
  it("neither prompt asks the model to infer or add metrics, and both forbid a figure the résumé does not state", async () => {
    answer = (a) => (isLetter(a) ? chat(letterJson(GROUNDED_LETTER)) : chat(resumeJson(GROUNDED)));
    await regenerate();
    const system = (a: Asked) => a.body.messages.find((m) => m.role === "system")?.content ?? "";
    const resumePrompt = system(asked.find((a) => !isLetter(a))!);
    const letterPrompt = system(asked.find(isLetter)!);
    expect(resumePrompt).not.toMatch(/infer reasonable metrics/i);
    expect(letterPrompt).not.toMatch(/experiences with metrics/i);
    for (const prompt of [resumePrompt, letterPrompt]) {
      expect(prompt).toMatch(/NEVER add a number, percentage, amount, count or date the resume does not state/);
    }
    expect(resumePrompt, "the prompt still asks for a score nothing measures").not.toMatch(/atsScore/);
  });
});

describe("a grounded reply", () => {
  it("is saved and mailed, with no score in the mail even when the reply writes one", async () => {
    answer = (a) => (isLetter(a) ? chat(letterJson(GROUNDED_LETTER)) : chat(resumeJson(GROUNDED, { atsScore: { before: 60, after: 92 } })));
    const outcome = await regenerate();
    expect(outcome).toMatchObject({ status: 200 });
    expect(asked.filter(isRepair)).toEqual([]);
    expect(saved()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain("Cut checkout errors by 30% in 2023");
    expect(sent[0].html).not.toContain("ATS Score Improvement");
    expect(sent[0].html).not.toMatch(/>60%<|>92%</);
  });
});

describe("an invented figure or contact detail", () => {
  it("a phone the résumé does not contain is taken out of what is saved and mailed", async () => {
    answer = (a) => (isLetter(a)
      ? chat(letterJson(`${GROUNDED_LETTER}\n${INVENTED_PHONE}`))
      : chat(resumeJson(GROUNDED.replace("jane@example.com", `jane@example.com | ${INVENTED_PHONE}`))));
    expect(await regenerate()).toMatchObject({ status: 200 });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain("555-0199");
    expect(JSON.stringify(saved()[0].generated_content)).not.toContain("555-0199");
  });

  it("a résumé line that still invents a figure after its one repair is put back to the résumé's own line, then mailed", async () => {
    const invented = GROUNDED.replace("- Mentored new engineers and ran the on-call rota for the payments team.",
      "- Mentored 14 new engineers and ran the on-call rota for the payments team.");
    answer = (a) => (isLetter(a) ? chat(letterJson(GROUNDED_LETTER)) : chat(resumeJson(invented)));
    expect(await regenerate()).toMatchObject({ status: 200 });
    // Sent back once, with the figure named.
    const repairs = asked.filter((a) => isRepair(a) && !isLetter(a));
    expect(repairs).toHaveLength(1);
    expect(repairs[0].body.messages.at(-1)?.content).toMatch(/REJECTED by an automated fact check[\s\S]*14/);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toMatch(/Mentored 14/);
    expect(sent[0].html).toContain("Mentored new engineers and ran the on-call rota.");
  });

  it("a letter with '$2M' and a phone the résumé never stated, still there after the repair, is refused: 422, nothing saved, nothing mailed", async () => {
    answer = (a) => (isLetter(a)
      ? chat(letterJson(`${INVENTED_LETTER}\n${INVENTED_PHONE}`))
      : chat(resumeJson(GROUNDED)));
    const outcome = await regenerate();
    expect(outcome).toMatchObject({ status: 422, part: "coverLetter" });
    expect(asked.filter((a) => isRepair(a) && isLetter(a))).toHaveLength(1);
    expect(saved()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a rewrite made of invented figures is refused before the letter is asked for", async () => {
    const madeUp = "JANE DOE\n- Grew revenue to $2M.\n- Saved $750K.\n- Hired 40 people.\n- Shipped 120 releases.";
    answer = (a) => (isLetter(a) ? chat(letterJson(GROUNDED_LETTER)) : chat(resumeJson(madeUp)));
    const outcome = await regenerate();
    expect(outcome).toMatchObject({ status: 422, part: "resume" });
    expect(asked.filter(isLetter)).toEqual([]);
    expect(saved()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a repair that writes the figures out is delivered", async () => {
    answer = (a) => {
      if (isLetter(a)) return chat(letterJson(isRepair(a) ? GROUNDED_LETTER : INVENTED_LETTER));
      return chat(resumeJson(GROUNDED));
    };
    expect(await regenerate()).toMatchObject({ status: 200 });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain("$2M");
    expect(sent[0].html).toContain("cut checkout errors by 30%");
  });
});
