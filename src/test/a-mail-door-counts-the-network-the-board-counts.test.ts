// @vitest-environment node
/**
 * A MAIL DOOR COUNTS THE NETWORK THE BOARD COUNTS.
 *
 * The two public endpoints that send mail to an address someone typed -- the
 * API key request and the market-pulse sign-up -- limit per NETWORK, because a
 * caller that rotates addresses inside a block walks straight through a
 * per-address limit. _shared/network-bucket.ts cuts an address to its /24 or
 * /48 exactly as job-board/anon-budget.ts does for the board's meter (whose
 * forgery probes run live), and reads the address only through clientAddress:
 * never the first forwarded hop, which the caller writes.
 */
import { describe, expect, it } from "vitest";
import { networkBucket, networkOf } from "../../supabase/functions/_shared/network-bucket";
import { addressKey, networkOf as boardNetworkOf } from "../../supabase/functions/job-board/anon-budget";

const PUBLIC = ["203.0.113.9", "198.51.100.254", "8.8.4.4", "2001:db8:abcd:12:1:2:3:4", "2606:4700:4700::1111", "::ffff:203.0.113.9", "[2001:db8::1]:443", "203.0.113.9:8080"];

describe("the network of an address", () => {
  it("is the board's network for every public address", () => {
    for (const a of PUBLIC) expect(networkOf(a), a).toBe(boardNetworkOf(addressKey(a)));
  });

  it("is null for what does not parse", () => {
    for (const a of ["", "not-an-ip", "999.1.1.1", "1:2:3"]) expect(networkOf(a), a).toBeNull();
  });
});

describe("the bucket", () => {
  const H = (o: Record<string, string>) => new Headers(o);
  it("is a 32-hex keyed hash that names no address", async () => {
    const b = await networkBucket(H({ "cf-connecting-ip": "203.0.113.9" }), "secret", "api-key");
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(b).not.toContain("203");
  });

  it("is shared across one /24, and a forged first hop changes nothing", async () => {
    const a = await networkBucket(H({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }), "s", "p");
    const b = await networkBucket(H({ "x-forwarded-for": "9.9.9.9, 203.0.113.200" }), "s", "p");
    const c = await networkBucket(H({ "x-forwarded-for": "203.0.113.9, 198.51.100.1" }), "s", "p");
    expect(a).toBe(b);
    expect(c, "the caller's own first hop picked the bucket").not.toBe(a);
  });

  it("differs by purpose and by secret, so one endpoint's counter is never another's", async () => {
    const h = H({ "cf-connecting-ip": "203.0.113.9" });
    expect(await networkBucket(h, "s", "api-key")).not.toBe(await networkBucket(h, "s", "market-pulse"));
    expect(await networkBucket(h, "s1", "api-key")).not.toBe(await networkBucket(h, "s2", "api-key"));
  });
});
