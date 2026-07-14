// chainFrom builds a per-function fallback chain that keeps the caller's current
// primary model FIRST (so latency/quality is unchanged on the happy path) and
// appends cross-provider fallbacks for resilience, de-duped.
import { describe, it, expect } from "vitest";
import { chainFrom } from "../../supabase/functions/_shared/ai-fallback";

describe("chainFrom (AI provider failover chain)", () => {
  it("keeps the primary first and appends cross-provider fallbacks", () => {
    expect(chainFrom("google/gemini-2.5-flash-lite")).toEqual([
      "google/gemini-2.5-flash-lite",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
      "openai/gpt-5-mini",
    ]);
  });

  it("de-dupes when the primary is already in the default tail", () => {
    const chain = chainFrom("google/gemini-2.5-pro");
    expect(chain[0]).toBe("google/gemini-2.5-pro");
    expect(chain.filter((m) => m === "google/gemini-2.5-pro")).toHaveLength(1);
    expect(chain).toEqual([
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
      "openai/gpt-5-mini",
    ]);
  });

  it("always ends with a cross-provider (non-Google) option for real diversity", () => {
    for (const primary of ["google/gemini-2.5-flash", "google/gemini-3-flash-preview", "openai/gpt-5"]) {
      const chain = chainFrom(primary);
      expect(chain[0]).toBe(primary);
      expect(chain.some((m) => m.startsWith("openai/"))).toBe(true);
    }
  });
});
