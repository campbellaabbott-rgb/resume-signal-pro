// @vitest-environment node
/**
 * THE KIT'S REFUSAL NAMES PRO'S REAL ALLOWANCE, AND A PLAN THAT CANNOT BE
 * READ IS A 503 (S14X-169).
 *
 * The unentitled answer promised "unlimited application kits" and sent the
 * person to unlock a retired product from the pricing page; Pro is five
 * application packages a day. And a signed-in member whose plan read failed
 * (accountProStanding answers known: false) was counted on the address's day
 * and refused 402 as if they had no plan. Now that read is a retryable 503
 * limiter_unavailable, and the refusal names the allowance the code enforces.
 * Asserted on the response bodies, run against the shipped handler.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WRITING_ALLOWANCE } from "../../supabase/functions/_shared/writing-allowance";
import { WritingWorld, loadWriter, post, tokenFor, PRO_USER } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

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

describe("a signed-in member whose plan cannot be read", () => {
  it("is answered 503 limiter_unavailable with Retry-After, never a purchase refusal, and no model is asked", async () => {
    world.db.rpcs.pro_entitlement_rows = () => ({ data: null, error: { message: "statement timeout" } });
    const r = await post(kit, "generate-apply-package", { resumeText: KIT_RESUME, jobPostingText: KIT_POSTING }, tokenFor(PRO_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(503);
    expect(r.body).toMatchObject({ code: "limiter_unavailable", retryable: true });
    expect(Number(r.headers.get("retry-after"))).toBe(60);
    expect(r.body.requiresPurchase).toBeUndefined();
    expect(world.ai).toEqual([]);
    // Never counted on the address's day as a stranger.
    expect(world.counts.some((c) => !String(c.p_ip).startsWith("user:"))).toBe(false);
  });
});

describe("a caller with no plan and no purchase", () => {
  it("is told Pro's real daily allowance, with no promise of unlimited kits", async () => {
    const r = await post(kit, "generate-apply-package", { resumeText: KIT_RESUME, jobPostingText: KIT_POSTING }, "anon");
    expect(r.status).toBe(402);
    expect(r.body.requiresPurchase).toBe(true);
    const said = String(r.body.error);
    expect(said).toContain(`${WRITING_ALLOWANCE.proPackagesPerDay} application packages a day`);
    expect(said).not.toMatch(/unlimited/i);
    expect(said).not.toMatch(/pricing page/i);
  });
});
