/**
 * TWO METERS BEFORE ANY OUTBOUND REQUEST (sweep S11-032, owner decision
 * 2026-10-11: "rate-limited per IP with check_rate_limit, and behind the board
 * budget").
 *
 * 1. PER ADDRESS, PER HOUR: check_rate_limit under this function's own name,
 *    FETCHES_PER_ADDRESS_HOUR an hour, keyed on the address the platform
 *    states (cf-connecting-ip, else the last forwarded hop; never the first,
 *    which the caller writes). Hourly because the limiter keeps no longer
 *    window (a-day-allowance-the-limiter-sweeps-is-an-hour). A limiter that
 *    cannot answer refuses: this function makes requests on our behalf, and
 *    a limiter that fails open is off.
 *
 * 2. THE BOARD'S DAY: one call to job_board_anon_check, the counter the job
 *    board meters its anonymous reads with, under the same bucket the board
 *    gives the same address (a keyed hash of its normalised key) and the same
 *    caps. A fetch is one read of that address's day; an address the board
 *    has refused today (its cap, a blocked network, a paused country) is
 *    refused here too. Like the board, this meter fails open: it must never
 *    take the scanner down. The browser's board pass is not asked for: this
 *    function serves no posting of ours, so it sends the pass state the
 *    counter never refuses, which its telemetry shows as such.
 *
 * The address key and the bucket are job-board/anon-budget.ts's, restated
 * here because functions deploy apart; a test keeps the two equal.
 */
import { clientAddress } from "../_shared/client-address.ts";

export const FETCHES_PER_ADDRESS_HOUR = 20;
export const RATE_WINDOW_MINUTES = 60;
/** job-board/anon-budget.ts ADDRESS_DAILY_CAP, BUILD_DAILY_CAP, PROBE_DAILY_CAP. */
export const BOARD_ADDRESS_DAILY_CAP = 10_000;
export const BOARD_BUILD_DAILY_CAP = 15_000;
export const BOARD_PROBE_DAILY_CAP = BOARD_ADDRESS_DAILY_CAP;
export const BOARD_BUDGET_DEADLINE_MS = 800;

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

const boardPublicV4 = ([a, b]: number[]): boolean =>
  !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));

/** job-board's addressKey: IPv4 as itself, IPv6 cut to its /64, null for a non-public address. */
export function boardAddressKey(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  s = s.replace(/%.*$/, "");
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  if (withPort) s = withPort[1];
  const q = v4Parts(s);
  if (q) return boardPublicV4(q) ? q.join(".") : null;
  const w = v6Words(s);
  if (!w) return null;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
    const m = [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255];
    return boardPublicV4(m) ? m.join(".") : null;
  }
  if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xff00) === 0xff00) return null;
  return `${w.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** job-board's networkOf over a key: a.b.c.0/24 or h0:h1:h2::/48. */
export function boardNetworkOf(key: string | null): string | null {
  if (!key) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(key);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const v6 = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(key);
  return v6 ? `${v6[1]}:${v6[2]}:${v6[3]}::/48` : null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** job-board's bucketFor: the same day row the board counts this address in. */
export async function boardBucket(key: string | null, serviceKey: string): Promise<string> {
  if (!key) return "unknown";
  return `ip:${(await sha256Hex(`${serviceKey}:board-anon:${key}`)).slice(0, 16)}`;
}

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

export type MeterVerdict = { ok: true } | { ok: false; status: 429 | 503; reason: "rate_limited" | "board_budget" | "limiter_unavailable"; retryAfter: number };

/** The two meters, in order. Nothing outbound happens unless both let the call through. */
export async function meterFetch(h: Headers, rpc: Rpc, serviceKey: string, now = Date.now()): Promise<MeterVerdict> {
  const { address } = clientAddress(h);
  const ip = (address || "unknown").slice(0, 45);
  const limited = await Promise.resolve(rpc("check_rate_limit", {
    p_ip: ip, p_function: "fetch-job-posting", p_max_requests: FETCHES_PER_ADDRESS_HOUR, p_window_minutes: RATE_WINDOW_MINUTES,
  })).then((r) => r, () => ({ data: null, error: { message: "rpc threw" } }));
  if (limited.error || typeof limited.data !== "boolean") {
    return { ok: false, status: 503, reason: "limiter_unavailable", retryAfter: 60 };
  }
  if (limited.data === false) return { ok: false, status: 429, reason: "rate_limited", retryAfter: 3600 };

  try {
    const key = address ? boardAddressKey(address) : null;
    const tool = (h.get("x-rb-budget") ?? "").trim().toLowerCase();
    const kind = !key ? "unknown_address" : tool === "build" || tool === "probe" ? tool : "address";
    const c = (h.get("cf-ipcountry") ?? "").trim().toUpperCase();
    const args = {
      p_bucket: await boardBucket(key, serviceKey),
      p_kind: kind,
      p_country: /^[A-Z]{2}$/.test(c) && c !== "XX" ? c : "XX",
      p_address_cap: BOARD_ADDRESS_DAILY_CAP,
      p_build_cap: BOARD_BUILD_DAILY_CAP,
      p_probe_cap: BOARD_PROBE_DAILY_CAP,
      p_bare: !h.get("origin") && !h.get("referer"),
      p_net: boardNetworkOf(key),
      p_pass: "unconfigured",
      p_pass_id: null,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), BOARD_BUDGET_DEADLINE_MS); });
    const asked = Promise.resolve(rpc("job_board_anon_check", args)).then((r) => r, () => null);
    const got = await Promise.race([asked, late]).finally(() => clearTimeout(timer));
    if (!got || got.error) return { ok: true };
    const row = (Array.isArray(got.data) ? got.data[0] : got.data) as Record<string, unknown> | null | undefined;
    if (!row || row.is_allowed !== false) return { ok: true };
    const d = new Date(now);
    const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return { ok: false, status: 429, reason: "board_budget", retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)) };
  } catch {
    return { ok: true };
  }
}
