/**
 * THE CHECKOUT'S COUNTRY BLOCK, READ FROM THE ADDRESS.
 *
 * WHAT IT IS. The owner asked on 2025-12-17 for checkout, the free scan and
 * lead capture to refuse Russia, Nigeria and Pakistan (Lovable edit "Add geo
 * block Russia NG PK"). All three read cf-ipcountry. Two days later the free
 * scan and lead capture gained an ipinfo.io fallback "when headers missing";
 * create-checkout did not.
 *
 * WHAT WAS WRONG. On Supabase's edge cf-ipcountry never reaches a function
 * (docs/job-board-deploy-notes.md, 2026-09-09.86: every job-board request read
 * XX, and a client-written one is removed too), so the checkout block never
 * refused anyone. Its other header, x-vercel-ip-country, is not one this
 * platform sets: when it arrives, the caller wrote it.
 *
 * WHAT IT DOES. A request is refused when the platform's cf-ipcountry names a
 * blocked country, OR the trusted address (_shared/address-key.ts) sits in a
 * block a regional registry delegated to one. Either, not cf-first as the
 * board's meter does: a header can add a refusal but never lift one, so the
 * block does not depend on the platform going on stripping forged headers.
 * The blocks are every registry's RU, NG and PK delegations (NG and PK each
 * hold a few RIPE NCC blocks), packed by scripts/build-country-ranges.mjs into
 * blocked-country-ranges.ts.
 *
 * WHAT IT IS NOT. A registry records where a block was first delegated, not
 * where its user sits; anyone on a VPN or proxy elsewhere passes. It refuses
 * people, it does not judge payments -- Stripe does that for each card.
 */
import { addressKey, callerAddress } from "./address-key.ts";
import { type Blocks, decodeBlocks, inBlocks, keyPoint } from "./registry-blocks.ts";
import { NG_V4, NG_V6, PK_V4, PK_V6, RU_V4, RU_V6 } from "./blocked-country-ranges.ts";

/** ISO 3166-1 alpha-2. */
export const BLOCKED_COUNTRIES = ["RU", "NG", "PK"] as const;
export type BlockedCountry = typeof BLOCKED_COUNTRIES[number];

const PACKED: Record<BlockedCountry, Record<"v4" | "v6", string>> = {
  RU: { v4: RU_V4, v6: RU_V6 },
  NG: { v4: NG_V4, v6: NG_V6 },
  PK: { v4: PK_V4, v6: PK_V6 },
};
/** Decoded on first use, once per isolate. */
const decoded = new Map<string, Blocks>();
function blocksOf(cc: BlockedCountry, family: "v4" | "v6"): Blocks {
  let b = decoded.get(cc + family);
  if (!b) {
    b = decodeBlocks(PACKED[cc][family]);
    decoded.set(cc + family, b);
  }
  return b;
}

/** The blocked country a registry delegated this key's block to, or null. */
export function blockedCountryOfKey(key: string | null): BlockedCountry | null {
  const p = keyPoint(key);
  if (!p) return null;
  return BLOCKED_COUNTRIES.find((cc) => inBlocks(blocksOf(cc, p.family), p.n)) ?? null;
}

export type BlockVerdict =
  | { blocked: false }
  | { blocked: true; country: BlockedCountry; source: "cf" | "registry" };

/** Refused when cf-ipcountry names a blocked country or the caller's address sits in one's blocks. */
export function blockedCountryOf(h: Headers): BlockVerdict {
  const cf = (h.get("cf-ipcountry") ?? "").trim().toUpperCase();
  const named = BLOCKED_COUNTRIES.find((cc) => cc === cf);
  if (named) return { blocked: true, country: named, source: "cf" };
  const { address } = callerAddress(h);
  const cc = blockedCountryOfKey(address ? addressKey(address) : null);
  return cc ? { blocked: true, country: cc, source: "registry" } : { blocked: false };
}
