/**
 * THE ANONYMOUS BOARD BUDGET: how many data-bearing reads one address may make
 * in a UTC day. Pure apart from the rpc it is handed, so vitest imports it.
 * Why, the numbers and the owner's one-statement levers:
 * docs/job-board-deploy-notes.md (2026-09-09.85, .87 for the network and the
 * pass). The counter is job_board_anon_check (migrations 20261002140000 and
 * 20261003180000), its own tables, never the request budget shared with upload
 * and checkout.
 */
import { BOARD_READER_HEADER, boardReaderKey } from "../_shared/board-reader-key.ts";
import { inChina } from "./geo-cn.ts";
import { type PassState, passStateOf } from "./board-pass.ts";

/** Actions that hand out postings. A body with no action is a list. */
export const BUDGETED_ACTIONS: ReadonlySet<string> = new Set([
  "list", "detail", "facets", "company-suggest", "exists", "semantic-search", "application-questions", "verify",
]);

/**
 * ONE ROW PER ADDRESS PER UTC DAY, whatever the caller declares: the kind only
 * picks which of these caps that row is judged against, so a declared kind
 * lifts an address to the LARGEST cap at most and never adds caps together.
 */
/** Jobs.tsx mounted under vitest: an extreme human day is ~6,400 counted calls. */
export const ADDRESS_DAILY_CAP = 10_000;
/**
 * x-rb-budget: build. 21 bakes of at most 709 calls from one address: twice
 * the busiest UTC day of pushes to main since the frontend began publishing
 * from main (10), and about half the measured harvest (~29,000 a day), so the
 * public header cannot buy a harvester's day.
 */
export const BUILD_DAILY_CAP = 15_000;
/** x-rb-budget: probe. A label at the browser's cap: lower would refuse our own verify run on the owner's address after a heavy browsing day. */
export const PROBE_DAILY_CAP = ADDRESS_DAILY_CAP;
/** The counter is cancelled at this deadline and the request is served. */
export const ANON_BUDGET_DEADLINE_MS = 800;
/** Names our own tooling's cap. Not a secret: it can lift the sender's own address to BUILD_DAILY_CAP, nothing else. */
export const BOARD_BUDGET_HEADER = "x-rb-budget";
export const BOARD_BUDGET_CONTACT = "resumeboostersupp@gmail.com";

export type BudgetKind =
  | "address" | "build" | "probe" | "unproven_api" | "unproven_mcp" | "unproven_digest" | "unknown_address";
export type AddressSource = "cf" | "xff" | "none";
export type CountedCaller = {
  exempt: false;
  kind: BudgetKind;
  address: string;
  source: AddressSource;
  /** The normalised public address (IPv6 cut to its /64), or null when it is not a public address. */
  key: string | null;
  /** Its /24 (IPv4) or /48 (IPv6): what a rotating pool shares when its addresses do not. */
  net: string | null;
  country: string;
  passState: PassState;
  /** Neither Origin nor Referer: not the site's own page. */
  bare: boolean;
};
export type Caller = { exempt: true; kind: "service" | "reader" } | CountedCaller;

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (s: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

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

/**
 * The network a normalised address key sits in: IPv4 "a.b.c.d" is
 * "a.b.c.0/24", an IPv6 key "h0:h1:h2:h3::/64" is "h0:h1:h2::/48". null for
 * anything else, so a non-public address is never a network.
 */
export function networkOf(key: string | null): string | null {
  if (!key) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(key);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const v6 = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(key);
  return v6 ? `${v6[1]}:${v6[2]}:${v6[3]}::/48` : null;
}

export type CountrySource = "cf" | "registry" | "none";

/**
 * cf-ipcountry when it is a real two-letter code (Tor's T1 and XX are not).
 * Without one -- and on Supabase's edge it never arrives -- CN when the
 * address key sits in a mainland block (geo-cn.ts), else XX. So without the
 * header, XX means "not in a block we hold as mainland China, or no public
 * address" -- never proof that a caller is outside China.
 */
export function countryOf(h: Headers, key: string | null = null): { country: string; source: CountrySource } {
  const c = (h.get("cf-ipcountry") ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c) && c !== "XX") return { country: c, source: "cf" };
  return inChina(key) ? { country: "CN", source: "registry" } : { country: "XX", source: "none" };
}

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const DECLARED = new Map<string, BudgetKind>([["api", "unproven_api"], ["mcp", "unproven_mcp"], ["digest", "unproven_digest"]]);

/**
 * In order: the service key (exempt), our servers' reader proof (exempt), then
 * a counted address. A declared api/mcp/digest caller WITHOUT the proof is
 * still counted at the address cap; its kind only makes a deploy skew visible.
 * passSecret is TURNSTILE_SECRET_KEY: without it every pass state is
 * 'unconfigured', which nothing refuses.
 */
export async function classifyCaller(h: Headers, serviceKey: string, passSecret = ""): Promise<Caller> {
  if (serviceKey && (h.get("authorization") === `Bearer ${serviceKey}` || h.get("apikey") === serviceKey)) {
    return { exempt: true, kind: "service" };
  }
  const offered = h.get(BOARD_READER_HEADER) ?? "";
  if (offered && sameSecret(offered, await boardReaderKey(serviceKey))) return { exempt: true, kind: "reader" };
  const { address, source } = callerAddress(h);
  const key = address ? addressKey(address) : null;
  const base = {
    exempt: false as const, address, source, key, net: networkOf(key), country: countryOf(h, key).country,
    passState: await passStateOf(h, serviceKey, passSecret), bare: !h.get("origin") && !h.get("referer"),
  };
  if (!key) return { ...base, kind: "unknown_address" };
  const tool = (h.get(BOARD_BUDGET_HEADER) ?? "").trim().toLowerCase();
  if (tool === "build" || tool === "probe") return { ...base, kind: tool };
  const declared = (h.get("x-rsp-caller") ?? h.get("x-rb-caller") ?? "").trim().toLowerCase();
  return { ...base, kind: DECLARED.get(declared) ?? "address" };
}

/**
 * A keyed hash of the address, never the address (all of IPv4 hashes in an
 * afternoon). The same bucket for every kind: one address, one day row.
 */
export async function bucketFor(c: CountedCaller, serviceKey: string): Promise<string> {
  if (c.kind === "unknown_address" || !c.key) return "unknown";
  return `ip:${(await sha256Hex(`${serviceKey}:board-anon:${c.key}`)).slice(0, 16)}`;
}

const nextUtcMidnight = (now: number): number => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

export type RefusalCode = "address" | "country" | "network" | "pass";

const REFUSAL_MESSAGE: Record<Exclude<RefusalCode, "address">, string> = {
  country: `Anonymous job board reads from this region are paused. If you are looking for work and this is in your way, write to ${BOARD_BUDGET_CONTACT}.`,
  network: `This network is paused from reading the job board. If you are looking for work and this is in your way, write to ${BOARD_BUDGET_CONTACT}.`,
  pass: `Your browser needs to finish a quick check before the job board can load. Reload the page; if this keeps happening, write to ${BOARD_BUDGET_CONTACT}.`,
};

/**
 * The refusal: 429, never cached, with the reset time and a person to write to.
 * A pass refusal has no reset to wait for -- a fresh pass lifts it at once -- so
 * it carries resetAt null and Retry-After 1.
 */
export function budgetRefusal(
  r: { code: RefusalCode; limit: number; used: number },
  cors: Record<string, string>,
  now = Date.now(),
): Response {
  const reset = nextUtcMidnight(now);
  const message = r.code === "address"
    ? `This address has used today's allowance of ${r.limit.toLocaleString("en-US")} job board reads. It resets at 00:00 UTC. If you are a person and this is wrong, write to ${BOARD_BUDGET_CONTACT}.`
    : REFUSAL_MESSAGE[r.code];
  const pass = r.code === "pass";
  return new Response(
    JSON.stringify({ error: "board_budget", code: r.code, message, limit: r.limit, used: r.used, resetAt: pass ? null : new Date(reset).toISOString() }),
    {
      status: 429,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "Retry-After": pass ? "1" : String(Math.max(1, Math.ceil((reset - now) / 1000))),
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": "Retry-After",
      },
    },
  );
}

export type AnonCheckRpc = (
  args: Record<string, unknown>,
  signal: AbortSignal,
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

/**
 * null = serve the request; a Response = the refusal. Runs before dispatch, so
 * a refused call does no other database work. FAILS OPEN on everything -- an
 * error, an unapplied migration, the deadline, an unreadable row: the meter
 * must never take the board down. Only an explicit is_allowed false refuses.
 * Before migration 20261003180000 the counter has no p_net/p_pass (PGRST202):
 * the call is repeated with the seven arguments it does have, inside the same
 * deadline, so the rules already live keep refusing across a deploy skew.
 */
export async function anonBudgetGate(
  req: Request,
  action: string,
  opts: { rpc: AnonCheckRpc; serviceKey: string; cors: Record<string, string>; passSecret?: string },
): Promise<Response | null> {
  if (!BUDGETED_ACTIONS.has(action)) return null;
  try {
    const classified = await classifyCaller(req.headers, opts.serviceKey, opts.passSecret ?? "");
    if (classified.exempt) return null;
    const caller = classified as CountedCaller;
    const args = {
      p_bucket: await bucketFor(caller, opts.serviceKey),
      p_kind: caller.kind,
      p_country: caller.country,
      p_address_cap: ADDRESS_DAILY_CAP,
      p_build_cap: BUILD_DAILY_CAP,
      p_probe_cap: PROBE_DAILY_CAP,
      p_bare: caller.bare,
    };
    const signal = AbortSignal.timeout(ANON_BUDGET_DEADLINE_MS);
    let { data, error } = await opts.rpc({ ...args, p_net: caller.net, p_pass: caller.passState }, signal);
    if (error?.code === "PGRST202") ({ data, error } = await opts.rpc(args, signal));
    if (error) {
      console.warn("[JOB-BOARD] anon budget unavailable, serving:", error.code ?? "", String(error.message ?? "").slice(0, 120));
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
    if (!row || row.is_allowed !== false) return null;
    // A listed network or country refuses whatever pass the call carries; the
    // counter sets pass_rule only when the pass is what refuses it.
    return budgetRefusal({
      code: row.network_rule === true ? "network" : row.pass_rule === true ? "pass" : row.country_rule === true ? "country" : "address",
      limit: Number(row.cap_today) || 0,
      used: Number(row.used_today) || 0,
    }, opts.cors);
  } catch (e) {
    console.warn("[JOB-BOARD] anon budget failed, serving:", String(e).slice(0, 120));
    return null;
  }
}

/** The uncounted, zero-database echo: what the gate sees of the caller's own request, never a bucket id. */
export async function budgetEcho(h: Headers, serviceKey: string, passSecret = ""): Promise<Record<string, unknown>> {
  const c = await classifyCaller(h, serviceKey, passSecret);
  const { address, source } = callerAddress(h);
  const key = address ? addressKey(address) : null;
  const { country, source: countrySource } = countryOf(h, key);
  return {
    address: address || null, addressKey: key, net: networkOf(key), source, country, countrySource, kind: c.kind, exempt: c.exempt,
    passState: await passStateOf(h, serviceKey, passSecret),
  };
}

const listed = (x: unknown): number | "invalid" => (x === undefined ? 0 : Array.isArray(x) ? x.length : "invalid");

/** The status block: the setting ROW as stored, plus the code defaults. The effective cap is the 429's limit, from SQL. */
export function anonBudgetStatus(v: unknown, opts: { passConfigured?: boolean } = {}): Record<string, unknown> {
  const present = !!v && typeof v === "object" && !Array.isArray(v);
  const o = (present ? v : {}) as Record<string, unknown>;
  return {
    settingPresent: present,
    enforce: o.enforce !== false,
    countriesListed: listed(o.countries),
    countryCap: typeof o.countryCap === "number" ? o.countryCap : null,
    networksListed: listed(o.blockedNetworks),
    // configured: TURNSTILE_SECRET_KEY is set on this function; required: the row's requirePass.
    pass: { configured: opts.passConfigured === true, required: o.requirePass === true },
    overrides: Object.fromEntries(["addressCap", "buildCap", "probeCap"].filter((k) => typeof o[k] === "number").map((k) => [k, o[k]])),
    defaults: { address: ADDRESS_DAILY_CAP, build: BUILD_DAILY_CAP, probe: PROBE_DAILY_CAP },
  };
}
