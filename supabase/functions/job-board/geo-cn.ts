/**
 * IS THIS ADDRESS IN CHINA? The registry's answer, read from the address the
 * platform hands us, because the platform does not hand us a country: on
 * Supabase's edge cf-ipcountry never reaches the function (all of the first
 * hour of .85 telemetry read XX). The blocks are APNIC's CN delegations plus
 * the mainland clouds filed elsewhere (Alibaba's pools under Singapore, AWS
 * Beijing/Ningxia), packed by scripts/build-country-ranges.mjs, which
 * describes the format and the sources. Hong Kong and Macau are delegated
 * separately, though a few CN-delegated blocks serve Hong Kong cloud regions
 * and read as CN.
 *
 * Takes the normalised key anon-budget.ts's addressKey makes ("a.b.c.d", or an
 * IPv6 /64 written "h:h:h:h::/64"), so it never parses raw header text itself.
 * The decoder and the search are _shared/registry-blocks.ts.
 */
import { CN_V4, CN_V6 } from "./cn-ranges.ts";
import { type Blocks, decodeBlocks, inBlocks, keyPoint } from "../_shared/registry-blocks.ts";

export { decodeBlocks };

let v4: Blocks | null = null;
let v6: Blocks | null = null;

/** true when the key's address sits in a block APNIC delegated to CN. */
export function inChina(key: string | null): boolean {
  const p = keyPoint(key);
  if (!p) return false;
  if (p.family === "v4") return inBlocks(v4 ??= decodeBlocks(CN_V4), p.n);
  return inBlocks(v6 ??= decodeBlocks(CN_V6), p.n);
}
