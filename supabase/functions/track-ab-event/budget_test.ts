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
  ADDRESS_DOOR,
  addressBucket,
  BUDGET_WINDOW_MINUTES,
  GLOBAL_BUDGET_SCOPE,
  GLOBAL_CEILING_PER_HOUR,
  addressKey,
  metadataTooLarge,
  PURCHASE_BUDGET_SCOPE,
  PURCHASE_CEILING_PER_HOUR,
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
  addressBucket: "a".repeat(32),
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

Deno.test("tier 1 is keyed on the VISITOR under its own function name, tier 2 on the ADDRESS before the site and in the writer — in that order", async () => {
  const { rpc, calls } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  const out = await recordEvent(rpc, event());
  assertEquals(out.status, "recorded");
  assertEquals(calls.map((c) => c.fn), ["check_rate_limit", "mail_door_take", "client_write_allowed", "track_ab_event_optimized"]);

  const door = calls[1].args;
  assertEquals(door.p_door, ADDRESS_DOOR);
  assertEquals(door.p_bucket, "a".repeat(32));
  assertEquals(door.p_max, ADDRESS_CEILING_PER_HOUR);
  assertEquals(door.p_window_minutes, BUDGET_WINDOW_MINUTES);

  const site = calls[2].args;
  assertEquals(site.p_scope, GLOBAL_BUDGET_SCOPE);
  assertEquals(site.p_ceiling, GLOBAL_CEILING_PER_HOUR);
  assertEquals(site.p_per_address, GLOBAL_CEILING_PER_HOUR);
  assertEquals(site.p_window_minutes, BUDGET_WINDOW_MINUTES);

  const tier1 = calls[0].args;
  assertEquals(tier1.p_ip, VISITOR, "the visitor tier is keyed on the visitor id");
  assert(tier1.p_ip !== ADDRESS, "the visitor tier must not be keyed on the address");
  assertEquals(tier1.p_function, VISITOR_BUDGET_FUNCTION);
  assertEquals(tier1.p_max_requests, VISITOR_BUDGET_PER_HOUR);
  assertEquals(tier1.p_window_minutes, BUDGET_WINDOW_MINUTES);

  const tier2 = calls[3].args;
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
  const { rpc, calls } = fakeRpc({ check_rate_limit: refused, mail_door_take: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  const out = await recordEvent(rpc, event());
  assertEquals(out.status, "rate_limited_visitor");
  assertEquals(calls.map((c) => c.fn), ["check_rate_limit"]);
});

Deno.test("an address over its ceiling is reported as the address, not the visitor", async () => {
  const { rpc } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote("rate_limited") });
  const out = await recordEvent(rpc, event());
  assertEquals(out.status, "rate_limited_address");
});

Deno.test("the writer's duplicate and recorded answers pass through unchanged", async () => {
  for (const s of ["duplicate", "recorded"] as const) {
    const { rpc } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote(s) });
    assertEquals((await recordEvent(rpc, event())).status, s);
  }
});

Deno.test("a writer without a status word is a recorded row (the pre-status contract)", async () => {
  const { rpc } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, client_write_allowed: allowed, track_ab_event_optimized: { data: null, error: null } });
  assertEquals((await recordEvent(rpc, event())).status, "recorded");
});

Deno.test("the visitor tier's own failure fails OPEN to the writer; the writer's failure is an error", async () => {
  const broken: RpcResult = { data: null, error: { message: "boom" } };
  const open = fakeRpc({ check_rate_limit: broken, mail_door_take: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(open.rpc, event())).status, "recorded");
  assertEquals(open.calls.map((c) => c.fn), ["check_rate_limit", "mail_door_take", "client_write_allowed", "track_ab_event_optimized"]);

  const closed = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, client_write_allowed: allowed, track_ab_event_optimized: broken });
  const out = await recordEvent(closed.rpc, event());
  assertEquals(out.status, "error");
  assertEquals(out.error, "boom");
});

Deno.test("the visitor key handed to check_rate_limit never exceeds its 45-character bound", async () => {
  const { rpc, calls } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  const long = "x".repeat(64); // the entry point accepts up to 64
  await recordEvent(rpc, { ...event(), visitorId: long });
  assertEquals(String(calls[0].args.p_ip).length, RATE_LIMIT_KEY_MAX);
  assertEquals(calls[3].args.p_visitor_id, long, "the row itself keeps the full id");
});

Deno.test("the numbers: the address ceiling is at least ten visitor budgets, and the visitor budget is under check_rate_limit's 1000 bound", () => {
  assert(ADDRESS_CEILING_PER_HOUR >= 10 * VISITOR_BUDGET_PER_HOUR, `${ADDRESS_CEILING_PER_HOUR} < 10 × ${VISITOR_BUDGET_PER_HOUR}`);
  assert(VISITOR_BUDGET_PER_HOUR >= 1 && VISITOR_BUDGET_PER_HOUR <= 1000, "check_rate_limit raises outside 1..1000 and the tier would fail open on every call");
  assertEquals(BUDGET_WINDOW_MINUTES, 60);
  assert(GLOBAL_CEILING_PER_HOUR >= 10 * ADDRESS_CEILING_PER_HOUR, "the site's hour admits at least ten address ceilings");
});

Deno.test("the site's hour refuses BEFORE the writer, and a failed site check fails open to the writer", async () => {
  const full = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, client_write_allowed: refused, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(full.rpc, event())).status, "rate_limited_global");
  assertEquals(full.calls.map((c) => c.fn), ["check_rate_limit", "mail_door_take", "client_write_allowed"]);
  const broken = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, client_write_allowed: { data: null, error: { message: "down" } }, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(broken.rpc, event())).status, "recorded");
});

Deno.test("metadata over the cap is too large; the error boundaries' payload is not", () => {
  assert(metadataTooLarge({ blob: "x".repeat(5000) }));
  assert(!metadataTooLarge({ message: "m".repeat(300), stack: "s".repeat(600), componentStack: "c".repeat(600), path: "/jobs" }));
});

Deno.test("an address over its hour is refused BEFORE the site's hour is spent; a failed count fails open", async () => {
  const full = fakeRpc({ check_rate_limit: allowed, mail_door_take: refused, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(full.rpc, event())).status, "rate_limited_address");
  assertEquals(full.calls.map((c) => c.fn), ["check_rate_limit", "mail_door_take"]);
  const broken = fakeRpc({ check_rate_limit: allowed, mail_door_take: { data: null, error: { message: "down" } }, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(broken.rpc, event())).status, "recorded");
});

Deno.test("the address bucket is a 32-hex keyed hash: one per address, another per key", async () => {
  const a = await addressBucket(ADDRESS, "k1");
  assert(/^[0-9a-f]{32}$/.test(a));
  assertEquals(await addressBucket(ADDRESS, "k1"), a);
  assert((await addressBucket("203.0.113.8", "k1")) !== a);
  assert((await addressBucket(ADDRESS, "k2")) !== a);
});

// ---------------------------------------------------------------------------
// A purchase is one the payment side knows (S14X-154), with an hour of its own
// (S14X-155), and an IPv6 subscriber is one address (S14X-155).
// ---------------------------------------------------------------------------

const purchase = (session: string | undefined, over: Record<string, unknown> = {}) => ({
  ...event(),
  variant: "purchase_completed",
  eventType: "conversion",
  metadata: session === undefined ? { productId: "fullAnalysis" } : { productId: "fullAnalysis", stripeSessionId: session },
  ...over,
});

Deno.test("a purchase whose Stripe session the site never minted is unverified, and the writer never runs", async () => {
  const { rpc, calls } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, ab_purchase_known: refused, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(rpc, purchase("cs_test_unknown"))).status, "unverified");
  assertEquals(calls.map((c) => c.fn), ["check_rate_limit", "mail_door_take", "ab_purchase_known"]);
  assertEquals(calls[2].args, { p_session_id: "cs_test_unknown" });
});

Deno.test("a purchase that names no Stripe session is unverified without a call", async () => {
  for (const ev of [
    purchase(undefined),
    purchase("pro_123"),
    // The funnel's sessionId is its own tab id, never a purchase.
    purchase(undefined, { metadata: { sessionId: "cs_test_tab" } }),
  ]) {
    const { rpc, calls } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, ab_purchase_known: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
    assertEquals((await recordEvent(rpc, ev)).status, "unverified");
    assertEquals(calls.map((c) => c.fn), ["check_rate_limit", "mail_door_take"]);
  }
});

Deno.test("a known purchase is recorded, in its own hour; product and A/B conversions are read from sessionId", async () => {
  const { rpc, calls } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, ab_purchase_known: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(rpc, purchase("cs_live_known"))).status, "recorded");
  assertEquals(calls.map((c) => c.fn), ["check_rate_limit", "mail_door_take", "ab_purchase_known", "client_write_allowed", "track_ab_event_optimized"]);
  assertEquals(calls[3].args.p_scope, PURCHASE_BUDGET_SCOPE);
  assertEquals(calls[3].args.p_ceiling, PURCHASE_CEILING_PER_HOUR);
  for (const ev of [
    { ...event(), testName: "product_conversion", variant: "fullAnalysis", eventType: "conversion", metadata: { sessionId: "cs_test_p" } },
    { ...event(), testName: "hero_layout", variant: "compact", eventType: "conversion", metadata: { productId: "fullAnalysis", sessionId: "cs_test_ab" } },
  ]) {
    const f = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, ab_purchase_known: allowed, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
    assertEquals((await recordEvent(f.rpc, ev)).status, "recorded");
    assertEquals(f.calls[2].args, { p_session_id: (ev.metadata as { sessionId: string }).sessionId });
  }
});

Deno.test("a failed purchase check fails open to the writer, like every tier", async () => {
  const { rpc, calls } = fakeRpc({ check_rate_limit: allowed, mail_door_take: allowed, ab_purchase_known: { data: null, error: { message: "Could not find the function" } }, client_write_allowed: allowed, track_ab_event_optimized: wrote("recorded") });
  assertEquals((await recordEvent(rpc, purchase("cs_test_any"))).status, "recorded");
  assertEquals(calls.at(-1)?.fn, "track_ab_event_optimized");
});

Deno.test("a full site hour refuses a view but not a known purchase, which never touches the site's bucket", async () => {
  const siteFull: Rpc = (fn, args) => {
    if (fn === "client_write_allowed") return Promise.resolve(args.p_scope === GLOBAL_BUDGET_SCOPE ? refused : allowed);
    return Promise.resolve(({ check_rate_limit: allowed, mail_door_take: allowed, ab_purchase_known: allowed, track_ab_event_optimized: wrote("recorded") } as Record<string, RpcResult>)[fn]);
  };
  assertEquals((await recordEvent(siteFull, event())).status, "rate_limited_global");
  assertEquals((await recordEvent(siteFull, purchase("cs_test_known"))).status, "recorded");
  // A conversion anyone can send (a sign-in) stays in the site's hour.
  assertEquals((await recordEvent(siteFull, { ...event(), testName: "auth_funnel", variant: "signin_success", eventType: "conversion" })).status, "rate_limited_global");
});

Deno.test("an IPv6 subscriber's /64 is one address; IPv4 addresses are counted as before", async () => {
  assertEquals(await addressBucket("2001:db8:1:2::1", "k"), await addressBucket("2001:db8:1:2:ffff::9", "k"));
  assertEquals(await addressBucket("2001:0db8:0001:0002:0000:0000:0000:0001", "k"), await addressBucket("2001:db8:1:2::1", "k"));
  assert((await addressBucket("2001:db8:1:3::1", "k")) !== (await addressBucket("2001:db8:1:2::1", "k")));
  assertEquals(addressKey("2001:db8:1:2::1"), "2001:db8:1:2::/64");
  assertEquals(addressKey("::ffff:203.0.113.7"), "203.0.113.7");
  assertEquals(addressKey("203.0.113.7"), "203.0.113.7");
  assertEquals(addressKey("unknown"), "unknown");
  assertEquals(addressKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  // An IPv4 bucket is the hash it always was.
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`k:${ADDRESS_DOOR}:${ADDRESS}`));
  const before = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  assertEquals(await addressBucket(ADDRESS, "k"), before);
});
