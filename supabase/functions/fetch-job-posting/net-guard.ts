/**
 * THE FETCH ITSELF, FENCED (sweep S11-032, owner decision 2026-10-11): the
 * second half of the safe fetcher, after hosts.ts.
 *
 * A host on the list is still only a name. Before every request, and again
 * after its headers arrive, the name is resolved and every address it has
 * must be a public unicast one: never private, loopback, link-local,
 * carrier-grade NAT, multicast, documentation, an IPv6 unique-local or
 * link-local address, or an IPv4 address dressed as IPv6. The second look is
 * the rebinding check: a name that resolved publicly for the first look and
 * privately by the second gets nothing back, and its body is never read.
 *
 * Redirects are never followed by the runtime. Each Location is a new hop,
 * held to the whole rule again (https, a listed host, public addresses), at
 * most MAX_REDIRECTS of them. Every body has a byte cap and every request a
 * deadline that covers the body as well as the headers, so a page that sends
 * its headers and then trickles, or never ends, costs at most the deadline.
 *
 * Pure apart from the fetch and the resolver it is handed, so the tests drive
 * it with fakes.
 */
import { checkFetchUrl } from "./hosts.ts";

export const MAX_REDIRECTS = 3;
export const MAX_BODY_BYTES = 3_000_000;
export const FETCH_DEADLINE_MS = 9_000;
export const FETCH_USER_AGENT = "ResumeBoosterJobFetcher/1.0 (+https://resumebooster.work)";

// ── addresses ────────────────────────────────────────────────────────────────

function v4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

/** Eight 16-bit words for an IPv6 address (with an optional dotted tail), or null. */
function v6(raw: string): number[] | null {
  const s = raw.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
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
        const q = v4(b);
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

/** A public unicast IPv4 address: none of the special-purpose blocks (RFC 6890 and kin). */
function publicV4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/**
 * Is this a public unicast address the fetcher may connect to? Anything that
 * does not parse as an address is not one.
 */
export function isPublicAddress(raw: string): boolean {
  const q = v4(raw.trim());
  if (q) return publicV4(q);
  const w = v6(raw.trim());
  if (!w) return false;
  // ::, ::1, and every IPv4 address dressed as IPv6 (mapped ::ffff:a.b.c.d,
  // the deprecated compatible ::a.b.c.d, and the translated ::ffff:0:a.b.c.d)
  // are judged as the IPv4 address they carry, or refused.
  if (w.slice(0, 5).every((x) => x === 0)) {
    if (w[5] === 0xffff || (w[5] === 0 && (w[6] !== 0 || w[7] > 1))) {
      return publicV4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255]);
    }
    return false;
  }
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0xffff && w[5] === 0) {
    return publicV4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255]);
  }
  // NAT64 (64:ff9b::/96 and the local-use 64:ff9b:1::/48) reaches the IPv4 address it embeds.
  if (w[0] === 0x64 && w[1] === 0xff9b) {
    if (w[2] === 1) return false;
    return w.slice(2, 6).every((x) => x === 0) && publicV4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255]);
  }
  if ((w[0] & 0xe000) !== 0x2000) return false; // only global unicast 2000::/3
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false; // documentation
  if (w[0] === 0x2001 && w[1] < 0x0200) return false; // Teredo, benchmarking, ORCHID and other IETF blocks
  if (w[0] === 0x2002) return false; // 6to4: the IPv4 address it tunnels to is not ours to judge here
  if (w[0] === 0x3fff && w[1] < 0x1000) return false; // the new documentation block 3fff::/20
  return true;
}

// ── resolution ───────────────────────────────────────────────────────────────

/** Every address a name has (A and AAAA); throws when the name does not resolve. */
export type Resolver = (host: string) => Promise<string[]>;

export type Refusal =
  | "dns_failed" | "blocked_address" | "not_https" | "unsupported_host" | "bad_url"
  | "too_many_redirects" | "http_error" | "too_large" | "timeout" | "fetch_failed";

class Refused extends Error {
  constructor(readonly reason: Refusal, readonly status?: number) { super(reason); }
}

/** All of a name's addresses, each one public, or a refusal. */
async function publicAddresses(host: string, resolve: Resolver): Promise<string[]> {
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch {
    throw new Refused("dns_failed");
  }
  if (!addrs.length) throw new Refused("dns_failed");
  if (!addrs.every(isPublicAddress)) throw new Refused("blocked_address");
  return addrs;
}

// ── the fetch ────────────────────────────────────────────────────────────────

export type SafeFetchDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  resolve: Resolver;
  /** Milliseconds for the whole fetch, every hop and every body byte included. */
  deadlineMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

export type SafeFetchResult =
  | { ok: true; status: number; url: string; contentType: string; body: string }
  | { ok: false; reason: Refusal; status?: number };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Read a body to its end under a byte cap and a deadline; a slow or endless body is a timeout. */
async function readCapped(res: Response, maxBytes: number, deadline: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Refused("too_large");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Refused("timeout");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), left); });
      const next = await Promise.race([reader.read(), tick]).finally(() => clearTimeout(timer));
      if (next === "timeout") throw new Refused("timeout");
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Refused("too_large");
      chunks.push(next.value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (e instanceof Refused) throw e;
    throw new Refused(Date.now() >= deadline ? "timeout" : "fetch_failed");
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder("utf-8").decode(all);
}

/**
 * GET one URL under the fence: every hop checked (https, a listed host,
 * public addresses before AND after the request), redirects followed by hand,
 * the body capped in bytes and time. Never throws.
 */
export async function safeFetch(start: string, deps: SafeFetchDeps, accept = "text/html,application/json;q=0.9,*/*;q=0.5"): Promise<SafeFetchResult> {
  const deadline = Date.now() + (deps.deadlineMs ?? FETCH_DEADLINE_MS);
  const maxBytes = deps.maxBytes ?? MAX_BODY_BYTES;
  const maxRedirects = deps.maxRedirects ?? MAX_REDIRECTS;
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), Math.max(0, deadline - Date.now()));
  try {
    let url: URL;
    try { url = new URL(start); } catch { return { ok: false, reason: "bad_url" }; }
    for (let hop = 0; ; hop++) {
      const checked = checkFetchUrl(url);
      if (checked.ok === false) return { ok: false, reason: checked.reason };
      await publicAddresses(url.hostname, deps.resolve);
      let res: Response;
      let headersTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        // The headers race the same deadline as the body: a fetch that ignores
        // its abort signal still cannot hold the request past it. The losing
        // side resolves to a sentinel, never a rejection nobody awaits.
        const late = new Promise<"timeout">((r) => { headersTimer = setTimeout(() => r("timeout"), Math.max(0, deadline - Date.now())); });
        const asked = deps.fetch(url.toString(), {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: { accept, "user-agent": FETCH_USER_AGENT },
        });
        // A fetch that loses the race and is then aborted rejects later; that
        // rejection is handled here rather than left to end the isolate.
        asked.then((r) => { if (Date.now() >= deadline) r.body?.cancel().catch(() => {}); }, () => {});
        const got = await Promise.race([asked, late]);
        if (got === "timeout") throw new Refused("timeout");
        res = got;
      } catch (e) {
        if (e instanceof Refused) throw e;
        throw new Refused(Date.now() >= deadline ? "timeout" : "fetch_failed");
      } finally {
        clearTimeout(headersTimer);
      }
      // THE REBINDING CHECK: the name is asked again now the request has gone.
      // An answer that turned private since the first look gets nothing read.
      try {
        await publicAddresses(url.hostname, deps.resolve);
      } catch (e) {
        await res.body?.cancel().catch(() => {});
        throw e;
      }
      if (REDIRECTS.has(res.status)) {
        await res.body?.cancel().catch(() => {});
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: "http_error", status: res.status };
        if (hop >= maxRedirects) return { ok: false, reason: "too_many_redirects" };
        try { url = new URL(loc, url); } catch { return { ok: false, reason: "bad_url" }; }
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: "http_error", status: res.status };
      }
      const body = await readCapped(res, maxBytes, deadline);
      return { ok: true, status: res.status, url: url.toString(), contentType: res.headers.get("content-type") ?? "", body };
    }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, reason: e.reason, ...(e.status ? { status: e.status } : {}) };
    return { ok: false, reason: "fetch_failed" };
  } finally {
    clearTimeout(killer);
  }
}

// ── the runtime's resolver ───────────────────────────────────────────────────

type DnsApi = { resolveDns?: (name: string, type: "A" | "AAAA") => Promise<string[]> };

/**
 * The edge runtime's own resolver (Deno.resolveDns), A and AAAA together. A
 * type the name lacks answers nothing; a name with neither is a failure.
 * Where the runtime offers no resolver at all, Cloudflare's DNS-over-HTTPS
 * answers instead (a fixed host, never one a caller names).
 */
export function runtimeResolver(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): Resolver {
  const deno = (globalThis as { Deno?: DnsApi }).Deno;
  const viaDoh = async (host: string): Promise<string[]> => {
    const ask = async (type: "A" | "AAAA"): Promise<string[]> => {
      const res = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) throw new Error(`doh ${res.status}`);
      const j = await res.json() as { Answer?: Array<{ type?: number; data?: string }> };
      const want = type === "A" ? 1 : 28;
      return (j.Answer ?? []).filter((a) => a.type === want && typeof a.data === "string").map((a) => a.data as string);
    };
    const [a, aaaa] = await Promise.all([ask("A"), ask("AAAA")]);
    return [...a, ...aaaa];
  };
  return async (host: string): Promise<string[]> => {
    if (typeof deno?.resolveDns !== "function") return await viaDoh(host);
    const one = async (type: "A" | "AAAA"): Promise<string[] | Error> => {
      try { return await deno.resolveDns!(host, type); } catch (e) { return e instanceof Error ? e : new Error(String(e)); }
    };
    const [a, aaaa] = await Promise.all([one("A"), one("AAAA")]);
    const got = [...(Array.isArray(a) ? a : []), ...(Array.isArray(aaaa) ? aaaa : [])];
    if (got.length) return got;
    // Neither type answered. A runtime that refuses to resolve (no permission,
    // not implemented) is asked through DNS-over-HTTPS; a name that does not
    // exist stays a failure.
    const errs = [a, aaaa].filter((x): x is Error => x instanceof Error);
    if (errs.length && errs.every((e) => !/NotFound|no data|not found|NXDOMAIN/i.test(`${e.name} ${e.message}`))) return await viaDoh(host);
    throw new Error("name does not resolve");
  };
}
