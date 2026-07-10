// The keepalive analytics transport: never throws, and never fires from
// dev/test environments (dev sessions hit the production Supabase project,
// so local clicking used to pollute the live funnel tables).
import { describe, it, expect, vi } from "vitest";
import { isTrackingDisabled, postTrackEvent } from "../lib/track-transport";

describe("track-transport", () => {
  it("is disabled in dev/test environments", () => {
    expect(isTrackingDisabled()).toBe(true); // vitest runs with DEV semantics
  });

  it("postTrackEvent is a safe no-op when disabled (no fetch, no throw)", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(() => postTrackEvent({ testName: "x", variant: "y" })).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
