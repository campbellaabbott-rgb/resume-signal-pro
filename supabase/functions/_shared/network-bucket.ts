/**
 * THE CALLER'S NETWORK, AS A RATE-LIMIT BUCKET THAT NAMES NO ADDRESS.
 *
 * A per-ADDRESS limit is no limit against a caller that rotates addresses,
 * and the scraper this site already knows about does exactly that inside its
 * blocks. So the mail-sending endpoints that anyone can reach (the API key
 * request, the market pulse sign-up) count per NETWORK: an IPv4 address's /24,
 * an IPv6 address's /48 -- the same cut job-board/anon-budget.ts networkOf
 * makes, which the board's live probes verify.
 *
 * The address itself comes from clientAddress (cf-connecting-ip, else the LAST
 * x-forwarded-for hop): never the first hop, which the caller writes.
 *
 * What is stored is a keyed hash of the network, never the network: all of
 * IPv4's /24s hash in seconds, so the key is what keeps it from being a list
 * of where our visitors are.
 */
import { clientAddress } from "./client-address.ts";

function v4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

/** Eight 16-bit words for an IPv6 address (with an optional dotted tail), or null. */
function v6(s: string): number[] | null {
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const words = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const bits = part.split(":");
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      if (i === bits.length - 1 && b.includes(".")) {
        const q = v4(b);
        if (!q) return null;
        out.push((q[0] << 8) | q[1], (q[2] << 8) | q[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(b)) out.push(parseInt(b, 16));
      else return null;
    }
    return out;
  };
  if (halves.length === 1) {
    const all = words(halves[0]);
    return all && all.length === 8 ? all : null;
  }
  const head = words(halves[0]);
  const tail = words(halves[1]);
  if (!head || !tail) return null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * "a.b.c.0/24" for IPv4 (an IPv4-mapped IPv6 address included), "h0:h1:h2::/48"
 * for IPv6, null for anything that does not parse.
 */
export function networkOf(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  s = s.replace(/%.*$/, "");
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  if (withPort) s = withPort[1];
  const q = v4(s);
  if (q) return `${q[0]}.${q[1]}.${q[2]}.0/24`;
  const w = v6(s);
  if (!w) return null;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
    return `${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.0/24`;
  }
  return `${w.slice(0, 3).map((x) => x.toString(16)).join(":")}::/48`;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The bucket for this request: a 32-hex keyed hash of its network, scoped to
 * `purpose` so one endpoint's counter can never be read as another's. A
 * request whose address the platform did not name shares one "unknown"
 * bucket -- conservative, since that bucket fills fastest.
 */
export async function networkBucket(h: Headers, secret: string, purpose: string): Promise<string> {
  const { address } = clientAddress(h);
  const net = (address && networkOf(address)) || (address ? `raw:${address}` : "unknown");
  return (await sha256Hex(`${secret}:${purpose}:${net}`)).slice(0, 32);
}
