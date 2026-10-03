// @vitest-environment node
/**
 * THE CHECKOUT REFUSES RUSSIA, NIGERIA AND PAKISTAN BY THE ADDRESS, BECAUSE NO
 * COUNTRY HEADER ARRIVES.
 *
 * WHAT WAS WRONG. create-checkout's block (the owner's, 2025-12-17) read
 * cf-ipcountry, then x-vercel-ip-country. On Supabase's edge cf-ipcountry
 * never reaches a function (measured 2026-10-03 on job-board: every request
 * XX, a client-written one removed too), and x-vercel-ip-country is not a
 * header this platform sets. So for nine and a half months the block refused
 * nobody, and the only header it could act on was one a caller wrote. Now the
 * country is read from the trusted address against every regional registry's
 * RU, NG and PK delegations (_shared/blocked-countries.ts; the blocks are
 * packed by scripts/build-country-ranges.mjs).
 *
 * WHAT THIS HOLDS:
 *   - the handler that deploys, run under node with only its network stubbed
 *     (helpers/edge-harness.ts), refuses with 403 and the message the page's
 *     toast matches ("region") a request whose cf-connecting-ip sits in an
 *     RU, NG or PK block, IPv4 and IPv6 -- before it touches the database or
 *     Stripe -- and still answers its preflight; a request from anywhere else
 *     goes on to a Stripe session;
 *   - a header can add a refusal and never lift one: a written
 *     x-vercel-ip-country, or a cf-ipcountry naming another country, does not
 *     let a blocked address through; a cf-ipcountry naming a blocked country,
 *     should a platform ever send one, refuses;
 *   - the address believed is cf-connecting-ip, else the LAST
 *     x-forwarded-for hop: a first hop the client wrote changes nothing;
 *   - real networks: Yandex, VK, MTN and Airtel Nigeria, PTCL and Pakistan's
 *     research network are refused; Ukraine, Belarus, Kazakhstan, Ghana,
 *     India, China, Google and Cloudflare are not (each checked against the
 *     registries' files and RDAP on 2026-10-03);
 *   - a country is the union of every registry's records: the blocks only
 *     RIPE NCC holds for Nigeria and Pakistan are in;
 *   - the edges of the first, a middle and the last block of each country and
 *     family; the packed data is canonical, counted as its header says, the
 *     size of each country, and small;
 *   - the generator reads every registry's header, unions the files, refuses
 *     a file given twice or a country no file holds, runs end to end from its
 *     command line, and still writes job-board's CN module byte for byte.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { addressKey } from "../../supabase/functions/_shared/address-key";
import { decodeBlocks } from "../../supabase/functions/_shared/registry-blocks";
import {
  BLOCKED_COUNTRIES, blockedCountryOf, blockedCountryOfKey, type BlockedCountry,
} from "../../supabase/functions/_shared/blocked-countries";
import * as RANGES from "../../supabase/functions/_shared/blocked-country-ranges";
import { CN_RANGES_SOURCE, CN_V4, CN_V6 } from "../../supabase/functions/job-board/cn-ranges";
import {
  encodeRanges, parseDelegated, renderModule, unionDelegated, v6Top48,
} from "../../scripts/build-country-ranges.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const H = (o: Record<string, string>) => new Headers(o);
const countryAt = (ip: string) => blockedCountryOfKey(addressKey(ip));

const dotted = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
const v6Key = (top48: number) => {
  const a = Math.floor(top48 / 2 ** 32), b = Math.floor(top48 / 2 ** 16) % 65536, c = top48 % 65536;
  return `${a.toString(16)}:${b.toString(16)}:${c.toString(16)}:0::/64`;
};
const packed = (cc: BlockedCountry) => ({
  source: (RANGES as Record<string, unknown>)[`${cc}_RANGES_SOURCE`] as Record<string, unknown> & typeof RANGES.RU_RANGES_SOURCE,
  v4: (RANGES as Record<string, unknown>)[`${cc}_V4`] as string,
  v6: (RANGES as Record<string, unknown>)[`${cc}_V6`] as string,
});
const pairs = (b: ReturnType<typeof decodeBlocks>) => Array.from(b.starts, (s, i) => [s, b.ends[i]]);

// Each checked 2026-10-03 against the five registries' delegated files and RDAP.
const REFUSED: Array<[string, BlockedCountry, string]> = [
  ["77.88.8.8", "RU", "Yandex DNS (YANDEX LLC)"],
  ["94.100.180.200", "RU", "VK (mail.ru)"],
  ["2a02:6b8::feed:ff", "RU", "Yandex DNS, IPv6"],
  ["197.210.53.1", "NG", "MTN Nigeria"],
  ["105.112.0.1", "NG", "Airtel Networks Limited"],
  ["2c0f:f5c0::1", "NG", "MTN Nigeria, IPv6"],
  ["39.32.0.1", "PK", "PTCL broadband"],
  ["2400:fc00::1", "PK", "HEC PERN, IPv6"],
];
const SERVED: Array<[string, string]> = [
  ["176.36.0.1", "Ukraine (RIPE NCC UA)"],
  ["178.120.0.1", "Belarus (RIPE NCC BY)"],
  ["2.132.0.1", "Kazakhstan (RIPE NCC KZ)"],
  ["154.160.0.1", "Ghana (AFRINIC GH)"],
  ["49.36.0.1", "India (APNIC IN)"],
  ["114.114.114.114", "China (APNIC CN)"],
  ["8.8.8.8", "Google"],
  ["1.1.1.1", "Cloudflare / APNIC research"],
  ["2a00:1450:4010::1", "Google, IPv6 (RIPE NCC IE)"],
  ["203.0.113.5", "documentation space"],
];

describe("which addresses are refused", () => {
  it("Russia, Nigeria and Pakistan's own networks, IPv4 and IPv6", () => {
    for (const [ip, cc, who] of REFUSED) expect(countryAt(ip), `${ip} ${who}`).toBe(cc);
  });

  it("not their neighbours, nor China, nor the big resolvers, nor documentation space", () => {
    for (const [ip, who] of SERVED) expect(countryAt(ip), `${ip} ${who}`).toBeNull();
  });

  it("not an address that is not public, nor a key that is not one", () => {
    for (const ip of ["10.0.0.1", "192.168.1.1", "127.0.0.1", "fe80::1", "", "not-an-address"]) {
      expect(countryAt(ip), ip).toBeNull();
    }
    expect(blockedCountryOfKey(null)).toBeNull();
    expect(blockedCountryOfKey("999.1.1.1")).toBeNull();
  });

  it("a country is every registry's records: the blocks only RIPE NCC holds for Nigeria and Pakistan are in", () => {
    // ripencc|NG|ipv4|80.89.176.0|4096, ripencc|NG|ipv6|2a06:b940::|29,
    // ripencc|PK|ipv4|78.41.63.0|256, ripencc|PK|ipv6|2a14:bc80::|30.
    for (const [ip, cc] of [["80.89.176.1", "NG"], ["2a06:b940::1", "NG"], ["78.41.63.1", "PK"], ["2a14:bc80::1", "PK"]] as const) {
      expect(countryAt(ip), ip).toBe(cc);
    }
    expect(RANGES.RU_RANGES_SOURCE.registry).toBe("ripencc");
    expect(RANGES.NG_RANGES_SOURCE.registry).toBe("afrinic+ripencc");
    expect(RANGES.PK_RANGES_SOURCE.registry).toBe("apnic+ripencc");
  });
});

describe("the request's country", () => {
  it("is read from cf-connecting-ip, else the LAST x-forwarded-for hop, never the first", () => {
    expect(blockedCountryOf(H({ "cf-connecting-ip": "77.88.8.8" }))).toEqual({ blocked: true, country: "RU", source: "registry" });
    expect(blockedCountryOf(H({ "x-forwarded-for": "8.8.8.8, 77.88.8.8" }))).toEqual({ blocked: true, country: "RU", source: "registry" });
    expect(blockedCountryOf(H({ "x-forwarded-for": "77.88.8.8, 8.8.8.8" })), "the first hop is whatever the client wrote").toEqual({ blocked: false });
    expect(blockedCountryOf(H({ "cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "77.88.8.8" }))).toEqual({ blocked: false });
    expect(blockedCountryOf(H({}))).toEqual({ blocked: false });
  });

  it("a header can add a refusal and never lift one", () => {
    expect(blockedCountryOf(H({ "cf-connecting-ip": "77.88.8.8", "x-vercel-ip-country": "US" }))).toMatchObject({ blocked: true, country: "RU" });
    expect(blockedCountryOf(H({ "cf-connecting-ip": "77.88.8.8", "cf-ipcountry": "US" }))).toMatchObject({ blocked: true, country: "RU" });
    expect(blockedCountryOf(H({ "cf-connecting-ip": "8.8.8.8", "cf-ipcountry": "pk" }))).toEqual({ blocked: true, country: "PK", source: "cf" });
    expect(blockedCountryOf(H({ "cf-connecting-ip": "8.8.8.8", "x-vercel-ip-country": "RU" })), "a header this platform never sets is not read").toEqual({ blocked: false });
    expect(blockedCountryOf(H({ "cf-connecting-ip": "8.8.8.8", "cf-ipcountry": "XX" }))).toEqual({ blocked: false });
  });
});

describe("the edges of a block", () => {
  for (const cc of BLOCKED_COUNTRIES) {
    for (const [family, toKey] of [["v4", dotted], ["v6", v6Key]] as const) {
      it(`${cc} ${family}: first and last address in, the neighbours not this country, at the first, a middle and the last block`, () => {
        const b = decodeBlocks(packed(cc)[family]);
        const n = b.starts.length;
        for (const i of [0, n >> 1, n - 1]) {
          const s = b.starts[i], e = b.ends[i];
          expect(blockedCountryOfKey(toKey(s)), `${cc} ${family} block ${i} start`).toBe(cc);
          expect(blockedCountryOfKey(toKey(e - 1)), `${cc} ${family} block ${i} last`).toBe(cc);
          if (s > 0) expect(blockedCountryOfKey(toKey(s - 1)), `${cc} ${family} block ${i} start - 1`).not.toBe(cc);
          expect(blockedCountryOfKey(toKey(e)), `${cc} ${family} block ${i} end`).not.toBe(cc);
        }
      });
    }
  }
});

describe("the packed data is what it says it is", () => {
  // Bounds around the 2026-10-03 build: RU 45.2M IPv4 addresses, NG 3.2M, PK 5.6M.
  const SIZE: Record<BlockedCountry, [number, number, number]> = {
    RU: [35_000_000, 60_000_000, 1_500], NG: [1_500_000, 6_000_000, 50], PK: [3_000_000, 9_000_000, 150],
  };

  for (const cc of BLOCKED_COUNTRIES) {
    it(`${cc}: canonical, sorted and disjoint, counted as its header says, and the size of ${cc}`, () => {
      const { source, v4, v6 } = packed(cc);
      const b4 = decodeBlocks(v4), b6 = decodeBlocks(v6);
      expect(encodeRanges(pairs(b4))).toBe(v4);
      expect(encodeRanges(pairs(b6))).toBe(v6);
      for (const b of [b4, b6]) {
        for (let i = 1; i < b.starts.length; i++) expect(b.starts[i], `block ${i}`).toBeGreaterThan(b.ends[i - 1]);
      }
      expect(b4.starts.length).toBe(source.v4Blocks);
      expect(b6.starts.length).toBe(source.v6Blocks);
      expect(pairs(b4).reduce((t, [s, e]) => t + (e - s), 0)).toBe(source.v4Addresses);
      expect(b4.ends[b4.ends.length - 1]).toBeLessThanOrEqual(2 ** 32);
      expect(b6.ends[b6.ends.length - 1]).toBeLessThanOrEqual(2 ** 48);
      const [lo, hi, v6Min] = SIZE[cc];
      expect(source.v4Addresses).toBeGreaterThan(lo);
      expect(source.v4Addresses).toBeLessThan(hi);
      expect(source.v6Blocks).toBeGreaterThan(v6Min);
      expect(source.serial).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  }

  it("no address is held by two of the countries", () => {
    const all = BLOCKED_COUNTRIES.flatMap((cc) => pairs(decodeBlocks(packed(cc).v4)).map(([s, e]) => [s, e, cc] as const))
      .sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < all.length; i++) expect(all[i][0], `${all[i - 1][2]} and ${all[i][2]} overlap at ${dotted(all[i][0])}`).toBeGreaterThanOrEqual(all[i - 1][1]);
  });

  it("stays small: create-checkout's bundle carries it", () => {
    const bytes = Buffer.byteLength(read("supabase/functions/_shared/blocked-country-ranges.ts"), "utf8");
    expect(bytes, "blocked-country-ranges.ts grew past 128KB: more countries than RU, NG and PK?").toBeLessThan(128_000);
  });
});

describe("the generator", () => {
  const RIPE = [
    "2|ripencc|1790978399|5|19700101|20261002|+0200",
    "ripencc|*|ipv4|*|3|summary",
    "ripencc|RU|ipv4|77.88.0.0|16384|20060914|allocated",
    "ripencc|NG|ipv4|80.89.176.0|4096|20050530|allocated",
    "ripencc|NG|ipv6|2a06:b940::|29|20151109|allocated",
    "ripencc|UA|ipv4|176.36.0.0|262144|20110415|allocated",
  ].join("\n");
  const AFRINIC = [
    "2|afrinic|20261003|3|00000000|20261003|00000",
    "afrinic|NG|ipv4|197.210.0.0|65536|20120612|allocated",
    "afrinic|NG|ipv4|197.211.0.0|256|20120612|reserved",
    "afrinic|GH|ipv4|154.160.0.0|1048576|20140101|allocated",
  ].join("\n");
  const ARIN = [
    "2.3|arin|1791032422008|2|19700101|20261003|-0400",
    "arin|US|ipv4|8.8.8.0|256|20140303|allocated|e5e3b9c13678dfc483fb1f819d70883c",
    "arin|RU|ipv4|192.0.2.0|256|20140303|assigned|0123456789abcdef0123456789abcdef",
  ].join("\n");

  it("reads every registry's header: an 8-digit serial is the date, a counter's file is dated by its end date", () => {
    expect(parseDelegated(RIPE, "RU")).toMatchObject({ registry: "ripencc", serial: "20261002", v4Records: 1 });
    expect(parseDelegated(AFRINIC, "NG")).toMatchObject({ registry: "afrinic", serial: "20261003", v4Records: 1 });
    const arin = parseDelegated(ARIN, "RU");
    expect(arin, "the extended format's extra field is read past").toMatchObject({ registry: "arin", serial: "20261003", v4Records: 1 });
    expect(arin.v4.map(([s, e]: number[]) => [dotted(s), dotted(e)])).toEqual([["192.0.2.0", "192.0.3.0"]]);
  });

  it("unions one country across files, names the registries that held it, and dates it by the oldest", () => {
    const ng = unionDelegated([parseDelegated(RIPE, "NG"), parseDelegated(AFRINIC, "NG"), parseDelegated(ARIN, "NG")], "NG");
    expect(ng.registry).toBe("afrinic+ripencc");
    expect(ng.serial).toBe("20261002");
    expect(ng.v4Records, "the reserved record is not a delegation").toBe(2);
    expect(ng.v4.map(([s, e]: number[]) => [dotted(s), dotted(e)])).toEqual([["80.89.176.0", "80.89.192.0"], ["197.210.0.0", "197.211.0.0"]]);
    expect(ng.v6).toEqual([[v6Top48("2a06:b940::"), v6Top48("2a06:b948::")]]);
  });

  it("refuses a file given twice and a country no file holds", () => {
    expect(() => unionDelegated([parseDelegated(RIPE, "RU"), parseDelegated(RIPE, "RU")], "RU")).toThrow(/two ripencc files/);
    expect(() => unionDelegated([parseDelegated(RIPE, "PK"), parseDelegated(AFRINIC, "PK")], "PK")).toThrow(/no PK block/);
  });

  it("runs from its command line: one module, a country per block of constants, the files named in its header", () => {
    const dir = mkdtempSync(join(tmpdir(), "country-ranges-"));
    const files = { ripe: join(dir, "ripe"), afrinic: join(dir, "afrinic"), arin: join(dir, "arin") };
    writeFileSync(files.ripe, RIPE);
    writeFileSync(files.afrinic, AFRINIC);
    writeFileSync(files.arin, ARIN);
    const out = join(dir, "ranges.ts");
    execFileSync(process.execPath, [resolve(ROOT, "scripts/build-country-ranges.mjs"), "--cc", "RU,NG",
      "--in", files.ripe, "--in", files.afrinic, "--in", files.arin, "--reader", "blocked-countries.ts", "--out", out], { stdio: "pipe" });
    const text = readFileSync(out, "utf8");
    expect(text.split("\n")[0]).toBe("// GENERATED by scripts/build-country-ranges.mjs from the delegated files of AFRINIC 2026-10-03, ARIN 2026-10-03 and RIPE NCC 2026-10-02. Do not edit by hand;");
    expect(text).toMatch(/export const RU_RANGES_SOURCE = \{\n {2}registry: "arin\+ripencc",\n {2}serial: "2026-10-02",/);
    expect(text).toMatch(/export const NG_RANGES_SOURCE = \{\n {2}registry: "afrinic\+ripencc",/);
    expect(text).toMatch(/export const NG_V6 = "[A-Za-z0-9+/=]+";/);
    expect(() => execFileSync(process.execPath, [resolve(ROOT, "scripts/build-country-ranges.mjs"), "--cc", "RU",
      "--in", files.ripe, "--aws", files.ripe, "--reader", "x.ts", "--out", out], { stdio: "pipe" })).toThrow(/cn-\* regions/);
  });

  it("still writes job-board's CN module byte for byte, from that module's own data", () => {
    const b4 = decodeBlocks(CN_V4), b6 = decodeBlocks(CN_V6);
    const s = CN_RANGES_SOURCE;
    const serial = s.serial.replace(/-/g, "");
    const cn = {
      cc: "CN", registry: s.registry, serial, v4Records: s.v4Records, v6Records: s.v6Records, v4: pairs(b4), v6: pairs(b6),
      curatedBlocks: s.curatedBlocks, aws: { createDate: s.aws.createDate, v4: s.aws.v4Prefixes, v6: s.aws.v6Prefixes, v6Skipped: s.aws.v6SkippedLongerThan48 },
    };
    expect(renderModule([cn], { files: [{ registry: "apnic", serial }], reader: "geo-cn.ts" })).toBe(read("supabase/functions/job-board/cn-ranges.ts"));
  });

  it("and the checkout's module byte for byte, from its own data and the dates its header names", () => {
    const text = read("supabase/functions/_shared/blocked-country-ranges.ts");
    const REG: Record<string, string> = { AFRINIC: "afrinic", APNIC: "apnic", ARIN: "arin", LACNIC: "lacnic", "RIPE NCC": "ripencc" };
    const files = [...text.split("\n")[0].matchAll(/(AFRINIC|APNIC|ARIN|LACNIC|RIPE NCC) (\d{4})-(\d{2})-(\d{2})/g)]
      .map((m) => ({ registry: REG[m[1]], serial: m[2] + m[3] + m[4] }));
    expect(files.map((f) => f.registry), "built from all five registries").toEqual(["afrinic", "apnic", "arin", "lacnic", "ripencc"]);
    const countries = BLOCKED_COUNTRIES.map((cc) => {
      const { source, v4, v6 } = packed(cc);
      return {
        cc, registry: source.registry, serial: source.serial.replace(/-/g, ""), v4Records: source.v4Records, v6Records: source.v6Records,
        v4: pairs(decodeBlocks(v4)), v6: pairs(decodeBlocks(v6)), curatedBlocks: source.curatedBlocks, aws: null,
      };
    });
    expect(renderModule(countries, { files, reader: "blocked-countries.ts" })).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// The handler that deploys.
// ---------------------------------------------------------------------------

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": `export default class Stripe {
    constructor() {
      this.checkout = { sessions: { create: async (p) => { globalThis.__stripeCalls.push(p); return { id: "cs_test_geo", url: "https://checkout.stripe.com/c/pay/cs_test_geo", amount_total: 500, currency: "usd", mode: "payment" }; } } };
      this.promotionCodes = { list: async () => { globalThis.__stripeCalls.push("promotionCodes.list"); return { data: [] }; } };
    }
  }`,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase; export class SupabaseClient {}",
};

let handler: EdgeHandler;
const db = new FakeDb();
const rpcCalls: string[] = [];
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_test_harness",
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness",
    SUPABASE_ANON_KEY: "anon_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
  g.__fakeSupabase = db;
  g.__stripeCalls = [];
  for (const name of ["check_rate_limit", "check_global_rate_limit"]) {
    db.rpcs[name] = () => { rpcCalls.push(name); return { data: true, error: null }; };
  }
  db.rpcs.record_checkout_start = () => { rpcCalls.push("record_checkout_start"); return { data: true, error: null }; };
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  handler = await loadEdgeHandler("create-checkout", STUBS);
}, 60_000);

afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  rpcCalls.length = 0;
  (g.__stripeCalls as unknown[]).length = 0;
});

const BUILD = /const FN_BUILD = "([^"]+)";/.exec(read("supabase/functions/create-checkout/index.ts"))?.[1];

async function checkout(headers: Record<string, string>, body: unknown = { currency: "usd" }, method = "POST") {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/create-checkout", {
    method,
    headers: { "content-type": "application/json", origin: "https://resumebooster.work", ...headers },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
  return { status: res.status, json: res.status === 200 && method === "OPTIONS" ? null : await res.json(), build: res.headers.get("x-fn-build") };
}

describe("create-checkout, run", () => {
  it("carries a build named for this change on every response", () => {
    expect(BUILD).toBe("create-checkout.2026-10-03.1");
  });

  it("refuses an RU, NG or PK address with 403 and the region message, before the database or Stripe", async () => {
    for (const [ip, cc, who] of REFUSED) {
      const r = await checkout({ "cf-connecting-ip": ip });
      expect(r.status, `${ip} ${who} (${cc})`).toBe(403);
      expect(r.json).toEqual({ error: "Service not available in your region." });
      expect(r.build).toBe(BUILD);
    }
    expect(rpcCalls, "a refused request reached the rate limiter").toEqual([]);
    expect(g.__stripeCalls, "a refused request reached Stripe").toEqual([]);
  });

  it("refuses through a written x-vercel-ip-country or a cf-ipcountry naming another country", async () => {
    expect((await checkout({ "cf-connecting-ip": "77.88.8.8", "x-vercel-ip-country": "US" })).status).toBe(403);
    expect((await checkout({ "cf-connecting-ip": "105.112.0.1", "cf-ipcountry": "GB" })).status).toBe(403);
    expect((await checkout({ "x-forwarded-for": "8.8.8.8, 39.32.0.1" })).status, "the last hop is the proxy's").toBe(403);
  });

  it("serves a buyer anywhere else through to a Stripe session, a written blocked country included", async () => {
    for (const headers of [
      { "cf-connecting-ip": "176.36.0.1" },
      { "cf-connecting-ip": "8.8.8.8", "x-vercel-ip-country": "RU" },
      { "x-forwarded-for": "77.88.8.8, 8.8.8.8" },
    ]) {
      (g.__stripeCalls as unknown[]).length = 0;
      const r = await checkout(headers);
      expect(r.status, JSON.stringify(headers)).toBe(200);
      expect(r.json).toMatchObject({ url: "https://checkout.stripe.com/c/pay/cs_test_geo", sessionId: "cs_test_geo" });
      expect(g.__stripeCalls).toHaveLength(1);
    }
  });

  it("still answers the preflight from a blocked address, so the page can read the refusal", async () => {
    const r = await checkout({ "cf-connecting-ip": "77.88.8.8" }, undefined, "OPTIONS");
    expect(r.status).toBe(200);
    expect(r.build).toBe(BUILD);
  });

  it("the page's toast matches the refusal it is sent", () => {
    expect(read("src/pages/Index.tsx")).toMatch(/errorMessage\.includes\('region'\) \|\| errorContext\.includes\('region'\)/);
  });
});
