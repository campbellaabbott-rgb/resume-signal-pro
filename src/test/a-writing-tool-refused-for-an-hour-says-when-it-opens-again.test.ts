// @vitest-environment node
/**
 * A WRITING TOOL REFUSED FOR AN HOUR SAYS WHEN IT OPENS AGAIN (S12-051).
 *
 * The model-spend gate refuses a writing tool with 429, a rate_limited_ code
 * and Retry-After 3600 (a day, 86400, for one purchase's allowance). The
 * /jobs Prepare modal's cover-letter and interview-coach buttons still told
 * the person the writer was "busy — try again in a moment", and the tailor
 * button that its runs "reset within the hour". Now the refusal names the
 * time the tool opens again, in the reader's locale; a busy model (model_busy,
 * Retry-After 60) keeps the busy copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writingToolToast, type WritingTool } from "@/lib/writing-refusal";

const t = (_key: string, fallback: string, vars?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (m, v: string) => (vars && v in vars ? String(vars[v]) : m));
const refused = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }),
  });
const NOW = new Date("2026-11-03T14:05:00Z");
const TOOLS: WritingTool[] = ["tailor", "cover", "coach"];

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("the spend gate's hour-long refusal", () => {
  for (const tool of TOOLS) {
    it(`${tool}: names the time it opens again, never busy or a moment`, async () => {
      const toast = await writingToolToast(tool, refused(429, { error: "You've reached the limit for this tool for now. Please try again later.", code: "rate_limited_function" }, { "Retry-After": "3600" }), t, "en-US");
      const text = `${toast.title} ${toast.description}`;
      expect(text).not.toMatch(/busy|in a moment|within the hour/i);
      const when = new Date(NOW.getTime() + 3600_000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
      expect(toast.description).toContain(`opens again at ${when}`);
    });
  }

  it("a purchase's day-long allowance names a time a day away", async () => {
    const toast = await writingToolToast("cover", refused(429, { error: "x", code: "rate_limited_session" }, { "Retry-After": "86400" }), t, "en-US");
    const when = new Date(NOW.getTime() + 86_400_000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
    expect(toast.description).toContain(when);
  });

  it("the global gate, read by its code alone, says the same", async () => {
    const toast = await writingToolToast("coach", refused(429, { error: "This tool is very busy right now.", code: "rate_limited_global" }), t, "en-US");
    expect(toast.description).toMatch(/opens again at/);
  });
});

describe("positive control: a busy model is still busy", () => {
  it("model_busy with Retry-After 60 keeps the tool's own copy", async () => {
    const toast = await writingToolToast("cover", refused(429, { error: "The AI service is busy.", code: "model_busy" }, { "Retry-After": "60" }), t, "en-US");
    expect(toast.description).toMatch(/busy/);
    expect(toast.description).not.toMatch(/opens again/);
  });
});
