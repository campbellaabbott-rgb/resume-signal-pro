// @vitest-environment node
/**
 * A LIMITER KEYS ON THE ADDRESS THE PLATFORM STATES, NEVER ON THE ONE THE CALLER WRITES.
 *
 * Defect-sweep 1.64: about twenty public model endpoints keyed their
 * per-address limit on the FIRST x-forwarded-for hop, which is whatever the
 * client wrote. _shared/client-address.ts is the one rule every limiter uses
 * from 2026-10-04: cf-connecting-ip, else the LAST hop. It must stay the same
 * rule as job-board's callerAddress, whose forgery probes run live.
 */
import { describe, expect, it } from "vitest";
import { clientAddress, clientAddressOr } from "../../supabase/functions/_shared/client-address";
import { callerAddress } from "../../supabase/functions/job-board/anon-budget";

const H = (o: Record<string, string>) => new Headers(o);
const CASES: Record<string, string>[] = [
  { "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.9" },
  { "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
  { "x-forwarded-for": "6.6.6.6,203.0.113.9 , 198.51.100.7" },
  { "x-forwarded-for": "  " },
  { "cf-connecting-ip": "  ", "x-forwarded-for": "203.0.113.9" },
  {},
];

describe("the caller's address is the platform's word", () => {
  it("cf-connecting-ip wins; else the LAST forwarded hop, never the first; else none", () => {
    expect(clientAddress(H({ "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.9" }))).toEqual({ address: "198.51.100.1", source: "cf" });
    expect(clientAddress(H({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toEqual({ address: "203.0.113.9", source: "xff" });
    expect(clientAddress(H({}))).toEqual({ address: "", source: "none" });
    expect(clientAddressOr(H({}))).toBe("unknown");
    expect(clientAddressOr(H({}), "anon")).toBe("anon");
  });

  it("a caller writing a fresh first hop on every request stays one address", () => {
    const seen = new Set(["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((forged) => clientAddress(H({ "x-forwarded-for": `${forged}, 203.0.113.9` })).address));
    expect([...seen]).toEqual(["203.0.113.9"]);
  });

  it("is the same rule as job-board's callerAddress, whose forgery probes run live", () => {
    for (const c of CASES) expect(clientAddress(H(c)), JSON.stringify(c)).toEqual(callerAddress(H(c)));
  });
});
