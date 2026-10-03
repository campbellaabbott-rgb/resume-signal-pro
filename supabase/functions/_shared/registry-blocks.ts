/**
 * A REGISTRY'S ADDRESS BLOCKS, DECODED AND SEARCHED.
 *
 * The packed format scripts/build-country-ranges.mjs writes: per family, a
 * run of unsigned LEB128 pairs (gap from the previous end, then length),
 * base64'd; IPv4 over the 32-bit space, IPv6 over the top 48 bits. Shared by
 * job-board/geo-cn.ts (mainland China) and _shared/blocked-countries.ts (the
 * checkout's RU, NG and PK). Moved here from geo-cn.ts on 2026-10-03,
 * unchanged.
 *
 * Searched by the normalised key _shared/address-key.ts's addressKey makes
 * ("a.b.c.d", or an IPv6 /64 written "h:h:h:h::/64"), so nothing here parses
 * raw header text.
 */

export type Blocks = { starts: Float64Array; ends: Float64Array };

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

export function inBlocks(b: Blocks, x: number): boolean {
  let lo = 0, hi = b.starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (x < b.starts[mid]) hi = mid - 1;
    else if (x >= b.ends[mid]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The point a key is searched at: IPv4 over 32 bits, an IPv6 /64 key over its top 48. null for anything else. */
export function keyPoint(key: string | null): { family: "v4" | "v6"; n: number } | null {
  if (!key) return null;
  const q = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(key);
  if (q) {
    const p = q.slice(1).map(Number);
    if (p.some((n) => n > 255)) return null;
    return { family: "v4", n: ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3] };
  }
  const w = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(key);
  if (!w) return null;
  return { family: "v6", n: (parseInt(w[1], 16) * 65536 + parseInt(w[2], 16)) * 65536 + parseInt(w[3], 16) };
}
