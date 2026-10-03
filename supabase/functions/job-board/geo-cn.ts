/**
 * IS THIS ADDRESS IN CHINA? The registry's answer, read from the address the
 * platform hands us, because the platform does not hand us a country: on
 * Supabase's edge cf-ipcountry never reaches the function (all of the first
 * hour of .85 telemetry read XX). The blocks are APNIC's CN delegations plus
 * the mainland clouds filed elsewhere (Alibaba's pools under Singapore, AWS
 * Beijing/Ningxia), packed by scripts/build-cn-ranges.mjs, which describes the
 * format and the sources. Hong Kong and Macau are delegated separately, though
 * a few CN-delegated blocks serve Hong Kong cloud regions and read as CN.
 *
 * Takes the normalised key anon-budget.ts's addressKey makes ("a.b.c.d", or an
 * IPv6 /64 written "h:h:h:h::/64"), so it never parses raw header text itself.
 */
import { CN_V4, CN_V6 } from "./cn-ranges.ts";

type Blocks = { starts: Float64Array; ends: Float64Array };

/** Unsigned LEB128 pairs: gap from the previous end, then length. */
export function decodeBlocks(b64: string): Blocks {
  const raw = atob(b64);
  const starts: number[] = [], ends: number[] = [];
  let i = 0, prev = 0;
  const varint = (): number => {
    let n = 0, scale = 1;
    for (;;) {
      if (i >= raw.length) throw new Error("truncated block data");
      const b = raw.charCodeAt(i++);
      n += (b & 127) * scale;
      if (b < 128) return n;
      scale *= 128;
    }
  };
  while (i < raw.length) {
    const s = prev + varint();
    const e = s + varint();
    starts.push(s);
    ends.push(e);
    prev = e;
  }
  return { starts: Float64Array.from(starts), ends: Float64Array.from(ends) };
}

let v4: Blocks | null = null;
let v6: Blocks | null = null;

function inBlocks(b: Blocks, x: number): boolean {
  let lo = 0, hi = b.starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (x < b.starts[mid]) hi = mid - 1;
    else if (x >= b.ends[mid]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** true when the key's address sits in a block APNIC delegated to CN. */
export function inChina(key: string | null): boolean {
  if (!key) return false;
  const q = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(key);
  if (q) {
    const p = q.slice(1).map(Number);
    if (p.some((n) => n > 255)) return false;
    v4 ??= decodeBlocks(CN_V4);
    return inBlocks(v4, ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3]);
  }
  const w = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(key);
  if (!w) return false;
  v6 ??= decodeBlocks(CN_V6);
  return inBlocks(v6, (parseInt(w[1], 16) * 65536 + parseInt(w[2], 16)) * 65536 + parseInt(w[3], 16));
}
