// @vitest-environment node
/**
 * THE BOARD'S PREPARE MODAL SAYS WHEN THE WRITING ALLOWANCE COMES BACK
 * (recheck 3 of wave 4, 2026-10-26).
 *
 * Wave 4 counts the writing tools per account: a free account gets one
 * tailored résumé, one cover letter and one interview-prep set per UTC day,
 * Pro five packages a day, and past that the server answers 429
 * { error: "daily_limit", resetsAt: <next 00:00 UTC> }. The /jobs prepare
 * modal still worded every 429 as main did: "Hourly limit reached ... they
 * reset within the hour", "The cover-letter writer is busy", "The interview
 * coach is busy". The account panels already read the refusal
 * (src/lib/writing-refusal.ts); the modal's three tools now do too, through
 * one helper, and keep the hourly or busy copy only for a 429 the helper does
 * not recognise (the model-spend gate). The helper runs here on the exact
 * error supabase-js hands the page, and the three handlers are held to it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writingToolToast, type WritingTool } from "@/lib/writing-refusal";
import EN from "@/i18n/locales/en.json";
import { codeOf } from "./helpers/strip-comments";

const en = EN as unknown as Record<string, Record<string, string>>;
/** A translator over the real English file, filling {{vars}}. */
const t = (key: string, fallback: string, vars?: Record<string, unknown>) => {
  const [ns, k] = key.split(".");
  const raw = en[ns]?.[k] ?? fallback;
  return raw.replace(/\{\{(\w+)\}\}/g, (m, v: string) => (vars && v in vars ? String(vars[v]) : m));
};
/** What supabase.functions.invoke hands the page for a non-2xx answer. */
const invokeError = (status: number, body: unknown) => Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response(JSON.stringify(body), { status }) });
const DAILY = { error: "daily_limit", tier: "free", limit: 1, resetsAt: "2026-10-27T00:00:00Z", message: "You've used today's free tailored résumé." };
const TOOLS: WritingTool[] = ["tailor", "cover", "coach"];

describe("a daily allowance spent is said as a daily allowance, with when it comes back", () => {
  for (const tool of TOOLS) {
    it(`${tool}: never 'within the hour' or 'busy', and names the reset`, async () => {
      const toast = await writingToolToast(tool, invokeError(429, DAILY), t, "en-US");
      const text = `${toast.title} ${toast.description}`;
      expect(text).not.toMatch(/within the hour|hourly|busy/i);
      expect(toast.description).toMatch(/today's writing allowance/);
      expect(toast.description).toMatch(/You can make more after /);
    });
  }

  it("a month spent says the month", async () => {
    const toast = await writingToolToast("tailor", invokeError(429, { error: "monthly_limit", resetsAt: "2026-11-01T00:00:00Z" }), t, "en-US");
    expect(toast.description).toMatch(/this month's writing allowance/);
  });

  it("a signed-out answer asks for a sign-in", async () => {
    const toast = await writingToolToast("cover", invokeError(401, { error: "sign_in_required" }), t, "en-US");
    expect(toast.description).toMatch(/Sign in to use the writing tools/);
  });
});

describe("positive control: a 429 that is not the allowance keeps main's copy", () => {
  it("tailor: the hourly copy; cover and coach: the busy copy", async () => {
    const spend = invokeError(429, { error: "Too many requests right now." });
    expect((await writingToolToast("tailor", spend, t, "en-US")).title).toBe(en.jobsPage.tailorLimitTitle);
    expect((await writingToolToast("cover", spend, t, "en-US")).description).toBe(en.jobsPage.coverBusy);
    expect((await writingToolToast("coach", spend, t, "en-US")).description).toBe(en.jobsPage.coachBusy);
  });
  it("any other failure keeps the plain error", async () => {
    expect((await writingToolToast("coach", invokeError(500, {}), t, "en-US")).description).toBe(en.jobsPage.coachError);
    expect((await writingToolToast("tailor", null, t, "en-US")).description).toBe(en.jobsPage.tailorError);
  });
});

describe("the /jobs prepare modal's three tools word their refusals through the helper", () => {
  const jobs = codeOf(readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8"));
  const body = (name: string) => {
    const at = jobs.indexOf(`const ${name} = async () => {`);
    expect(at, `${name} not found`).toBeGreaterThan(-1);
    return jobs.slice(at, jobs.indexOf("\n  };", at));
  };
  for (const [fn, tool] of [["tailorForRole", "tailor"], ["draftCoverLetter", "cover"], ["prepInterview", "coach"]] as const) {
    it(`${fn} asks writingToolToast("${tool}", …) and words no 429 itself`, () => {
      const b = body(fn);
      expect(b).toMatch(new RegExp(`writingToolToast\\("${tool}", error`));
      expect(b).not.toMatch(/status === 429/);
      expect(b).not.toMatch(/tailorLimit|coverBusy|coachBusy/);
    });
  }
});
