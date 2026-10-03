/**
 * THE CALLER'S ADDRESS, AND THE ONE KEY IT IS KNOWN BY.
 *
 * Which address to believe, and how to normalise it, so that job-board's
 * anonymous meter (job-board/anon-budget.ts) and create-checkout's country
 * block (_shared/blocked-countries.ts) can never disagree about who called.
 * Moved here from anon-budget.ts on 2026-10-03, unchanged, when the checkout
 * began reading the country from the address too.
 *
 * Measured on this platform (docs/job-board-deploy-notes.md, 2026-09-09.86):
 * cf-connecting-ip arrives and Cloudflare refuses a client that writes it
 * (403, error 1000); a client-written x-forwarded-for was ignored in every
 * shape tried.
 */

export type AddressSource = "cf" | "xff" | "none";

/** cf-connecting-ip, else the LAST x-forwarded-for hop (the one the nearest proxy appended). The first hop is whatever the client wrote. */
export function callerAddress(h: Headers): { address: string; source: AddressSource } {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return { address: cf, source: "cf" };
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const last = hops.at(-1);
  return last ? { address: last, source: "xff" } : { address: "", source: "none" };
}

function v4Parts(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

function v6Words(s: string): number[] | null {
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const words = (part: string, dottedTail: boolean): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const bits = part.split(":");
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      if (dottedTail && i === bits.length - 1 && b.includes(".")) {
        const q = v4Parts(b);
        if (!q) return null;
        out.push((q[0] << 8) | q[1], (q[2] << 8) | q[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(b)) out.push(parseInt(b, 16));
      else return null;
    }
    return out;
  };
  if (halves.length === 1) {
    const all = words(halves[0], true);
    return all && all.length === 8 ? all : null;
  }
  const head = words(halves[0], false);
  const tail = words(halves[1], true);
  if (!head || !tail) return null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

const publicV4 = ([a, b]: number[]): boolean =>
  !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));

/**
 * The address as one bucket: IPv4 as itself (an IPv4-mapped IPv6 address
 * included), IPv6 cut to its /64 because one host rotates freely inside it.
 * null for anything that is not a public address -- a gateway or internal hop
 * must never become a shared bucket that gets enforced.
 */
export function addressKey(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  s = s.replace(/%.*$/, "");
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  if (withPort) s = withPort[1];
  const q = v4Parts(s);
  if (q) return publicV4(q) ? q.join(".") : null;
  const w = v6Words(s);
  if (!w) return null;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
    const m = [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255];
    return publicV4(m) ? m.join(".") : null;
  }
  if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xff00) === 0xff00) return null;
  return `${w.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}
