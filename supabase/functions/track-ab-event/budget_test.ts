// THE BUDGET, DRIVEN. budget.ts is pure, so this file hands it a fake RPC
// and asserts what leaves for the database — which tier is keyed on what,
// with which number, in which order, and what one tier's refusal does to
// the other. (Named *_test.ts, Deno's suffix, so vitest never sweeps it up;
// the repo's check:functions gate type-checks it beside the entry point.)
//
// Run: deno test --allow-env supabase/functions/track-ab-event/

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ADDRESS_CEILING_PER_HOUR,
  BUDGET_WINDOW_MINUTES,
  RATE_LIMIT_KEY_MAX,
  VISITOR_BUDGET_FUNCTION,
  VISITOR_BUDGET_PER_HOUR,
  recordEvent,
  type Rpc,
  type RpcResult,
} from "./budget.ts";

const VISITOR = "8b2f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const ADDRESS = "203.0.113.7";

const event = () => ({
  testName: "conversion_funnel",
  variant: "upload_started",
  eventType: "view",
  visitorId: VISITOR,
  metadata: { page: "/" },
  clientIp: ADDRESS,
});

type Call = { fn: string; args: Record<string, unknown> };

/** A fake RPC that records every call and answers each function from a script. */
function fakeRpc(answers: Record<string, RpcResult>): { rpc: Rpc; calls: Call[] } {
  const calls: Call[] = [];
  const rpc: Rpc = (fn, args) => {
    calls.push({ fn, args });
    return Promise.resolve(answers[fn] ?? { data: null, error: { message: `unscripted rpc ${fn}` } });
  };
  return { rpc, calls };
}

const allowed: RpcResult = { data: true, error: null };
const refused: RpcResult = { data: false, error: null };
const wrote = (status: string): RpcResult => ({ data: { success: true, status }, error: null });

Deno.test("tier 1 is keyed on the VISITOR under its own function name, tier 2 on the ADDRESS in the writer — in that order", async () => {
  const { rpc, calls } = fakeRpc({ check_rate_limit: allowed, track_ab_event_optimized: wrote("recorded") });
  const out = await recordEvent(rpc, event());
  assertEquals(out.status, "recorded");
  assertEquals(calls.map((c) => c.fn), ["check_rate_limit", "track_ab_event_optimized"]);

  const tier1 = calls[0].args;
  assertEquals(tier1.p_ip, VISITOR, "the visitor tier is keyed on the visitor id");
  assert(tier1.p_ip !== ADDRESS, "the visitor tier must not be keyed on the address");
  assertEquals(tier1.p_function, VISITOR_BUDGET_FUNCTION);
  assertEquals(tier1.p_max_requests, VISITOR_BUDGET_PER_HOUR);
  assertEquals(tier1.p_window_minutes, BUDGET_WINDOW_MINUTES);

  const tier2 = calls[1].args;
  assertEquals(tier2.p_client_ip, ADDRESS, "the writer's limiter is keyed on the address");
  assert(tier2.p_client_ip !== VISITOR, "the writer's limiter must not be keyed on the visitor");
  assertEquals(tier2.p_max_requests, ADDRESS_CEILING_PER_HOUR);
  assertEquals(tier2.p_window_minutes, BUDGET_WINDOW_MINUTES);
  assertEquals(tier2.p_visitor_id, VISITOR);
  assertEquals(tier2.p_test_name, "conversion_funnel");
  assertEquals(tier2.p_variant, "upload_started");
  assertEquals(tier2.p_event_type, "view");
  assertEquals(tier2.p_metadata, { page: "/" });
});

Deno.test("a visitor over its own budget is refused BEFORE the writer runs — it spends nothing of its address's ceiling", async () => {
  const { rpc, calls } = fakeRpc({ check_rate_limit: refused, track_ab_event_optimized: wrote("recorded") });
  const out = await recordEvent(rpc, event());
  assertEquals(out.status, "rate_limited_visitor");
  assertEquals(calls.map((c) => c.fn), ["check_rate_limit"]);
});

Deno.test("an address over its ceiling is reported as the address, not the visitor", async () => {
  const { rpc } = fakeRpc({ check_rate_limit: allowed, track_ab_event_optimized: wrote("rate_limited") });
  const out = await recordEvent(rpc, event());
  assertEquals(out.status, "rate_limited_address");
});

Deno.test("the writer's duplicate and recorded answers pass through unchanged", async () => {
  for (const s of ["duplicate", "recorded"] as const) {
    const { rpc } = fakeRpc({ check_rate_limit: allowed, track_ab_event_optimized: wrote(s) });
    assertEquals((await recordEvent(rpc, event())).status, s);
  }
});

Deno.test("a writer without a status word is a recorded row (the pre-status contract)", async () => {
  const { rpc } = fakeRpc({ check_rate_limit: allowed, track_ab_event_optimized: { data: null, error: null } });
  assertEquals((await recordEvent(rpc, event())).status, "recorded");
});

Deno.test("the visitor tier's own failure fails OPEN to the writer; the writer's failure is an error", async () => {
  const broken: RpcResult = { data: null, error: { message: "boom" } };
  const open = fakeRpc({ check_rate_limit: broken, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(open.rpc, event())).status, "recorded");
  assertEquals(open.calls.map((c) => c.fn), ["check_rate_limit", "track_ab_event_optimized"]);

  const closed = fakeRpc({ check_rate_limit: allowed, track_ab_event_optimized: broken });
  const out = await recordEvent(closed.rpc, event());
  assertEquals(out.status, "error");
  assertEquals(out.error, "boom");
});

Deno.test("the visitor key handed to check_rate_limit never exceeds its 45-character bound", async () => {
  const { rpc, calls } = fakeRpc({ check_rate_limit: allowed, track_ab_event_optimized: wrote("recorded") });
  const long = "x".repeat(64); // the entry point accepts up to 64
  await recordEvent(rpc, { ...event(), visitorId: long });
  assertEquals(String(calls[0].args.p_ip).length, RATE_LIMIT_KEY_MAX);
  assertEquals(calls[1].args.p_visitor_id, long, "the row itself keeps the full id");
});

Deno.test("the numbers: the address ceiling is at least ten visitor budgets, and the visitor budget is under check_rate_limit's 1000 bound", () => {
  assert(ADDRESS_CEILING_PER_HOUR >= 10 * VISITOR_BUDGET_PER_HOUR, `${ADDRESS_CEILING_PER_HOUR} < 10 × ${VISITOR_BUDGET_PER_HOUR}`);
  assert(VISITOR_BUDGET_PER_HOUR >= 1 && VISITOR_BUDGET_PER_HOUR <= 1000, "check_rate_limit raises outside 1..1000 and the tier would fail open on every call");
  assertEquals(BUDGET_WINDOW_MINUTES, 60);
});
