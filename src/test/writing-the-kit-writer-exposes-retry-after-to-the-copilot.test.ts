// @vitest-environment node
/**
 * THE KIT WRITER LETS THE CO-PILOT READ WHEN A LIMIT ENDS (RC-S12-051).
 *
 * The co-pilot words a refused kit by its Retry-After ("try the rest in about
 * 50 minutes"), but a browser hands a page only the response headers the
 * function exposes, and generate-apply-package, alone of the writers, exposed
 * none: every limit read as "try the rest tomorrow". Its preflight and its
 * refusals now expose x-fn-build and retry-after, as the other writers do.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WritingWorld, loadWriter, post, tokenFor, FREE_USER } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const exposes = (h: Headers) => (h.get("access-control-expose-headers") ?? "").toLowerCase().split(/\s*,\s*/);

let kit: EdgeHandler;
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  kit = await loadWriter("generate-apply-package");
}, 240_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
});

describe("generate-apply-package exposes retry-after", () => {
  it("on its preflight", async () => {
    const res = await kit(new Request("https://harness.supabase.co/functions/v1/generate-apply-package", { method: "OPTIONS" }));
    expect(exposes(res.headers)).toEqual(expect.arrayContaining(["x-fn-build", "retry-after"]));
  });

  it("on a refusal that carries a Retry-After: an account's hour spent", async () => {
    world.db.rpcs.check_rate_limit = (a) => ({ data: !String(a.p_ip).startsWith("user:"), error: null });
    const r = await post(kit, "generate-apply-package", { resumeText: KIT_RESUME, jobPostingText: KIT_POSTING }, tokenFor(FREE_USER));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(exposes(r.headers)).toContain("retry-after");
  });
});
