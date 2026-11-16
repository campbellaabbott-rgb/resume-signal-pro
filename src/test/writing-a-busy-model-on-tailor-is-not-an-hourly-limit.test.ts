// @vitest-environment node
/**
 * A BUSY MODEL ON THE TAILOR IS NOT AN HOURLY LIMIT (S14X-265).
 *
 * The tailor's toast for a busy model (429 model_busy, Retry-After 60) said
 * "Hourly limit reached ... they reset within the hour", while the cover and
 * coach tools said they were busy. Every real limit is worded by its own path
 * (the allowance by writingRefusalOf, the spend gate by its code and its
 * Retry-After); what is left for the tailor's own copy is a busy model, and
 * that copy now says so.
 */
import { describe, expect, it } from "vitest";
import { writingToolToast } from "@/lib/writing-refusal";
import EN from "@/i18n/locales/en.json";
import WRITING from "@/i18n/shards/writing-tools/en.json";

const strings: Record<string, Record<string, unknown>> = { ...(EN as unknown as Record<string, Record<string, unknown>>), ...(WRITING as unknown as Record<string, Record<string, unknown>>) };
/** A translator over the real English strings, filling {{vars}}. */
const t = (key: string, fallback: string, vars?: Record<string, unknown>) => {
  const [ns, k] = key.split(".");
  const found = strings[ns]?.[k];
  const raw = typeof found === "string" ? found : fallback;
  return raw.replace(/\{\{(\w+)\}\}/g, (m, v: string) => (vars && v in vars ? String(vars[v]) : m));
};
const invokeError = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response(JSON.stringify(body), { status, headers }) });

describe("the tailor's toast for a busy model", () => {
  it("says the tailor is busy, never an hourly limit", async () => {
    const toast = await writingToolToast("tailor", invokeError(429, { error: "AI service is temporarily busy.", code: "model_busy" }, { "retry-after": "60" }), t, "en-US");
    expect(toast).toEqual({ title: WRITING.writingTools.tailorBusyTitle, description: WRITING.writingTools.tailorBusy });
    expect(`${toast.title} ${toast.description}`).not.toMatch(/hour|limit/i);
  });
});

describe("positive control: a real limit keeps its own words", () => {
  it("the spend gate's hour names when it opens", async () => {
    const toast = await writingToolToast("tailor", invokeError(429, { error: "Too many requests", code: "rate_limited_function" }, { "retry-after": "3600" }), t, "en-US");
    expect(toast.description).toMatch(/It opens again at /);
  });
  it("the day's allowance names the day", async () => {
    const toast = await writingToolToast("tailor", invokeError(429, { error: "daily_limit", resetsAt: "2026-11-16T00:00:00Z" }), t, "en-US");
    expect(toast.description).toMatch(/today's writing allowance/);
  });
});
