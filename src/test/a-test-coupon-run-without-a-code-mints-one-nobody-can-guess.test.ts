// @vitest-environment node
/**
 * A TEST COUPON RUN WITHOUT A CODE MINTS ONE NOBODY CAN GUESS (audit
 * 2026-10-31, S13-062; create-test-coupon 2026-11-03.1).
 *
 * WHAT WAS WRONG. The owner's coupon tool, run without body.code, minted one
 * fixed name, printed in a public repository, as a live 100%-off promotion
 * code valid on every checkout: anyone who read the source could redeem it
 * before the owner did.
 *
 * WHAT HOLDS NOW (the shipped handler, Stripe faked): without a code the
 * promotion code is TEST plus 16 characters drawn at random (80 bits), a
 * different one each run, and the answer names it; a code the owner passes
 * is still used as given; the old fixed name is nowhere in the code.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ADMIN = "admin-key-harness-0123456789";
const env: Record<string, string> = { ADMIN_API_KEY: ADMIN, STRIPE_SECRET_KEY: "sk_test_harness" };
let minted: Array<{ code: string }>;
let mint: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__coupon = { minted: () => minted };
  mint = await loadEdgeHandler("create-test-coupon", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() {
      this.coupons = { create: async () => ({ id: "co_1" }) };
      this.promotionCodes = { create: async (a) => { globalThis.__coupon.minted().push(a); return { id: "promo_1", code: a.code, expires_at: a.expires_at }; } };
    } }`,
  });
}, 120_000);

beforeEach(() => { minted = []; });

const run = async (body: unknown, key = ADMIN) => mint(new Request("https://harness.supabase.co/functions/v1/create-test-coupon", {
  method: "POST", headers: { "content-type": "application/json", "x-admin-key": key }, body: JSON.stringify(body),
}));

describe("the owner's coupon tool", () => {
  it("without a code, mints TEST and 16 random characters, different each run, and answers with it", async () => {
    const a = await (await run({})).json() as { code: string };
    const b = await (await run({})).json() as { code: string };
    expect(a.code).toMatch(/^TEST[A-HJ-NP-Z2-9]{16}$/);
    expect(b.code).toMatch(/^TEST[A-HJ-NP-Z2-9]{16}$/);
    expect(a.code).not.toBe(b.code);
    expect(minted.map((m) => m.code)).toEqual([a.code, b.code]);
    expect(minted.map((m) => m.code)).not.toContain("TESTFREE48");
  });

  it("uses a code the owner passes, as before", async () => {
    const j = await (await run({ code: "rehearsal-1" })).json() as { code: string };
    expect(j.code).toBe("REHEARSAL1");
  });

  it("a code with no letter or digit left once cleaned, or not a string, is replaced by one nobody can guess", async () => {
    for (const code of ["--!!", "", 48, null]) {
      const j = await (await run({ code })).json() as { code: string };
      expect(j.code, JSON.stringify(code)).toMatch(/^TEST[A-HJ-NP-Z2-9]{16}$/);
    }
  });

  it("still answers only the owner's key", async () => {
    expect((await run({}, "wrong")).status).toBe(401);
    expect(minted).toEqual([]);
  });

  it("names its build, and the old fixed code is nowhere in the code", async () => {
    const res = await mint(new Request("https://harness.supabase.co/functions/v1/create-test-coupon", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toBe("create-test-coupon.2026-11-03.1");
    const src = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/create-test-coupon/index.ts"), "utf8"));
    expect(src).not.toMatch(/TESTFREE/);
  });
});
