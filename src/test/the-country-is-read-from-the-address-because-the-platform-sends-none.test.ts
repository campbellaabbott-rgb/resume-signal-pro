// @vitest-environment node
/**
 * THE COUNTRY IS READ FROM THE ADDRESS, BECAUSE THE PLATFORM SENDS NONE.
 *
 * WHAT WAS WRONG (measured 2026-10-03, the first hour of job-board .85). The
 * country switch read cf-ipcountry, and on Supabase's edge that header never
 * reaches the function: every telemetry row read XX (695 browser requests from
 * 124 addresses), a client-written one was removed too, and so listing CN would
 * have refused nobody. The address does arrive -- cf-connecting-ip, which
 * Cloudflare refuses from a client with a 403 -- so the country is now looked
 * up from it, against APNIC's record of the blocks delegated to China
 * (scripts/build-country-ranges.mjs packs them into job-board/cn-ranges.ts;
 * job-board/geo-cn.ts searches them). Review the same day found the registry
 * file alone files Alibaba Cloud's mainland pools (8.4M addresses) under
 * Singapore and AWS Beijing partly under ARIN, so a scraper on either cloud
 * would have read XX; those are added from scripts/data/cn-extra-blocks.txt
 * and AWS's published ranges.
 *
 * WHAT THIS HOLDS:
 *   - known mainland resolvers (114DNS, AliDNS, CNNIC, Baidu, DNSPod), the
 *     three carriers' IPv6 blocks, Alibaba Cloud's mainland pools and AWS
 *     Beijing are CN; Google, Cloudflare/APNIC research, a Hong Kong block,
 *     Alibaba's Singapore half and documentation space are not;
 *   - the edges: the first and last address of a block are in, the addresses
 *     either side are out, for the first, a middle and the last block of each
 *     family -- an off-by-one in the search or the decoder fails here;
 *   - the packed data is the encoder's own canonical output, sorted and
 *     disjoint, with the counts its header claims, and it is the size of
 *     China: a file cut for the wrong country, or a truncated one, fails;
 *   - the generator parses, filters and merges a synthetic delegation file,
 *     a curated list and an AWS file, and refuses what it cannot represent;
 *   - cf-ipcountry still wins when a platform does send it, so moving runtimes
 *     never makes this lookup overrule a better source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeBlocks, inChina } from "../../supabase/functions/job-board/geo-cn";
import { CN_RANGES_SOURCE, CN_V4, CN_V6 } from "../../supabase/functions/job-board/cn-ranges";
import { addressKey, classifyCaller, countryOf } from "../../supabase/functions/job-board/anon-budget";
import { combine, encodeRanges, merge, parseAws, parseCidr, parseDelegated, parseInclude, v6Top48 } from "../../scripts/build-country-ranges.mjs";

const ROOT = resolve(__dirname, "../..");
const key = (ip: string) => addressKey(ip);
const H = (o: Record<string, string>) => new Headers(o);

const dotted = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
const v6Key = (top48: number) => {
  const a = Math.floor(top48 / 2 ** 32), b = Math.floor(top48 / 2 ** 16) % 65536, c = top48 % 65536;
  return `${a.toString(16)}:${b.toString(16)}:${c.toString(16)}:0::/64`;
};

describe("a mainland address is CN, and nothing else is", () => {
  it("known mainland IPv4 resolvers are in China", () => {
    for (const ip of ["114.114.114.114", "223.5.5.5", "1.2.4.8", "180.76.76.76", "119.29.29.29"]) {
      expect(inChina(key(ip)), ip).toBe(true);
    }
  });

  it("Alibaba Cloud's mainland pools, filed by the registry under Singapore, and AWS Beijing, filed at ARIN, are in China", () => {
    for (const ip of ["8.136.1.1", "8.150.1.1", "8.170.1.1", "43.32.1.1", "107.176.0.1"]) expect(inChina(key(ip)), ip).toBe(true);
    expect(inChina(key("43.70.1.1")), "the upper half of Alibaba's 43.0.0.0/9 is its Singapore entity").toBe(false);
    expect(CN_RANGES_SOURCE.curatedBlocks).toBeGreaterThanOrEqual(2);
    expect(CN_RANGES_SOURCE.aws?.v4Prefixes ?? 0).toBeGreaterThan(100);
  });

  it("the curated list in the repository is what the data was built from", () => {
    const curated = parseInclude(readFileSync(resolve(ROOT, "scripts/data/cn-extra-blocks.txt"), "utf8"));
    expect(curated.v4.length + curated.v6.length).toBe(CN_RANGES_SOURCE.curatedBlocks);
    const v4 = decodeBlocks(CN_V4);
    for (const [s, e] of curated.v4) {
      const i = Array.from(v4.starts).findIndex((st, j) => st <= s && v4.ends[j] >= e);
      expect(i, `curated ${s}-${e} is not inside one packed block`).toBeGreaterThanOrEqual(0);
    }
  });

  it("the three carriers' and CERNET's IPv6 blocks are in China, through the /64 key the meter makes", () => {
    for (const ip of ["240e:3b0::1", "2408:8456:1:2::5", "2409:8a00:aaaa:bbbb::1", "2001:da8:8000:1::1", "2400:3200::1"]) {
      expect(key(ip), ip).toMatch(/::\/64$/);
      expect(inChina(key(ip)), ip).toBe(true);
    }
  });

  it("Google, APNIC's 1.1.1.0/24, Hong Kong, documentation space and foreign IPv6 are not", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "1.36.0.1", "203.0.113.5", "2001:4860:4860::8888", "2606:4700::1111"]) {
      expect(inChina(key(ip)), ip).toBe(false);
    }
    expect(inChina(null)).toBe(false);
    expect(inChina("not-a-key")).toBe(false);
    expect(inChina("999.1.1.1")).toBe(false);
  });
});

describe("the edges of a block", () => {
  for (const [family, b64, toKey] of [["IPv4", CN_V4, dotted], ["IPv6", CN_V6, v6Key]] as const) {
    it(`${family}: first and last address in, the neighbours out, at the first, a middle and the last block`, () => {
      const b = decodeBlocks(b64);
      const n = b.starts.length;
      for (const i of [0, n >> 1, n - 1]) {
        const s = b.starts[i], e = b.ends[i];
        expect(inChina(toKey(s)), `${family} block ${i} start`).toBe(true);
        expect(inChina(toKey(e - 1)), `${family} block ${i} last`).toBe(true);
        if (s > 0) expect(inChina(toKey(s - 1)), `${family} block ${i} start - 1`).toBe(false);
        expect(inChina(toKey(e)), `${family} block ${i} end`).toBe(false);
      }
    });
  }
});

describe("the packed data is what it says it is", () => {
  const v4 = decodeBlocks(CN_V4), v6 = decodeBlocks(CN_V6);
  const pairs = (b: ReturnType<typeof decodeBlocks>) => Array.from(b.starts, (s, i) => [s, b.ends[i]]);

  it("is the encoder's own canonical output: re-encoding the decoded blocks gives the same bytes", () => {
    expect(encodeRanges(pairs(v4))).toBe(CN_V4);
    expect(encodeRanges(pairs(v6))).toBe(CN_V6);
  });

  it("is sorted and disjoint, with the counts its header claims", () => {
    for (const b of [v4, v6]) {
      for (let i = 1; i < b.starts.length; i++) expect(b.starts[i], `block ${i}`).toBeGreaterThan(b.ends[i - 1]);
    }
    expect(v4.starts.length).toBe(CN_RANGES_SOURCE.v4Blocks);
    expect(v6.starts.length).toBe(CN_RANGES_SOURCE.v6Blocks);
    expect(pairs(v4).reduce((t, [s, e]) => t + (e - s), 0)).toBe(CN_RANGES_SOURCE.v4Addresses);
    expect(v4.ends[v4.ends.length - 1]).toBeLessThanOrEqual(2 ** 32);
    expect(v6.ends[v6.ends.length - 1]).toBeLessThanOrEqual(2 ** 48);
  });

  it("is the size of China (about 343M IPv4 addresses on 2026-10-03), not another country or a truncated file", () => {
    expect(CN_RANGES_SOURCE.registry).toBe("apnic");
    expect(CN_RANGES_SOURCE.v4Addresses).toBeGreaterThan(300_000_000);
    expect(CN_RANGES_SOURCE.v4Addresses).toBeLessThan(400_000_000);
    expect(CN_RANGES_SOURCE.v6Blocks).toBeGreaterThan(1_500);
    expect(CN_RANGES_SOURCE.serial).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("stays small enough for a bundle that sits near the 4.5MB deploy cliff", () => {
    const bytes = Buffer.byteLength(readFileSync(resolve(ROOT, "supabase/functions/job-board/cn-ranges.ts"), "utf8"));
    expect(bytes, "cn-ranges.ts grew past 64KB: regenerated for more than one country?").toBeLessThan(64_000);
  });
});

describe("the generator", () => {
  const FILE = [
    "# comment",
    "2|apnic|20261003|9|19830613|20261002|+1000",
    "apnic|*|ipv4|*|5|summary",
    "apnic|CN|ipv4|1.0.1.0|256|20110414|allocated",
    "apnic|CN|ipv4|1.0.2.0|512|20110414|allocated",
    "apnic|CN|ipv4|1.0.8.0|1024|20110412|assigned",
    "apnic|CN|ipv4|9.9.9.0|256|20110412|reserved",
    "apnic|HK|ipv4|1.36.0.0|65536|20100629|allocated",
    "apnic|CN|ipv6|240e::|20|20100520|allocated",
    "apnic|CN|ipv6|240e:1000::|24|20100520|allocated",
    "apnic|CN|asn|4134|1|20020801|allocated",
  ].join("\n");

  it("keeps one country's allocated and assigned blocks, and merges touching ones", () => {
    const p = parseDelegated(FILE, "CN");
    expect(p.serial).toBe("20261003");
    expect(p.v4Records).toBe(3);
    expect(p.v4.map(([s, e]: number[]) => [dotted(s), dotted(e)])).toEqual([["1.0.1.0", "1.0.4.0"], ["1.0.8.0", "1.0.12.0"]]);
    expect(p.v6Records).toBe(2);
    expect(p.v6, "240e::/20 ends where 240e:1000::/24 begins, so one block").toEqual([[v6Top48("240e::"), v6Top48("240e:1100::")]]);
  });

  it("round-trips through the decoder", () => {
    const p = parseDelegated(FILE, "CN");
    const back = decodeBlocks(encodeRanges(p.v4));
    expect(Array.from(back.starts, (s, i) => [s, back.ends[i]])).toEqual(p.v4);
  });

  it("adds a curated list and AWS's cn-* prefixes, and counts the IPv6 it cannot hold", () => {
    const include = parseInclude("# evidence lines\n\n8.128.0.0/10   Aliyun, delegated SG\n2001:db8::/32 example\n");
    expect(include.v4).toEqual([[parseCidr("8.128.0.0/10")[1], parseCidr("8.128.0.0/10")[2]]]);
    expect(include.v6).toHaveLength(1);
    const aws = parseAws({
      createDate: "2026-10-03-00-00-00",
      prefixes: [
        { ip_prefix: "107.176.0.0/15", region: "cn-north-1", service: "AMAZON" },
        { ip_prefix: "107.176.0.0/15", region: "cn-north-1", service: "EC2" },
        { ip_prefix: "3.5.0.0/16", region: "us-east-1", service: "AMAZON" },
      ],
      ipv6_prefixes: [
        { ipv6_prefix: "2404:c2c0::/40", region: "cn-northwest-1", service: "AMAZON" },
        { ipv6_prefix: "2404:c2c0:1::/56", region: "cn-northwest-1", service: "AMAZON" },
      ],
    });
    expect(aws.v4, "one cn prefix, listed twice for two services; us-east-1 left out").toHaveLength(1);
    expect(aws.v6).toHaveLength(1);
    expect(aws.v6Skipped, "a /56 cannot be held over 48 bits and is counted, not rounded").toBe(1);
    const all = combine(parseDelegated(FILE, "CN"), include, aws);
    expect(all.curatedBlocks).toBe(2);
    expect(all.aws).toEqual({ createDate: "2026-10-03-00-00-00", v4: 1, v6: 1, v6Skipped: 1 });
    expect(all.v4).toHaveLength(4);
  });

  it("refuses what it cannot represent", () => {
    expect(() => parseDelegated("2|example|20261003|1|1|1|-0500\n", "CN")).toThrow(/not a registry delegated file/);
    expect(() => parseDelegated("3|apnic|20261003|1|1|1|+1000\n", "CN")).toThrow(/not a registry delegated file/);
    expect(() => parseDelegated("2|apnic|20261003|1|1|1|+1000\napnic|CN|ipv6|2400::|64|20100101|allocated", "CN")).toThrow(/longer than \/48/);
    expect(() => encodeRanges([[5, 10], [8, 12]])).toThrow(/sorted, disjoint/);
    expect(() => parseInclude("2400::/64 too long")).toThrow(/longer than \/48/);
    expect(() => parseCidr("8.128.0.1/10")).toThrow(/not aligned/);
    expect(() => parseAws({ prefixes: [] })).toThrow(/not an AWS/);
    expect(merge([[0, 4], [4, 8], [10, 12]])).toEqual([[0, 8], [10, 12]]);
  });
});

describe("the meter's country", () => {
  it("cf-ipcountry wins when a platform sends it; the registry answers only without one", () => {
    expect(countryOf(H({ "cf-ipcountry": "US" }), key("114.114.114.114"))).toEqual({ country: "US", source: "cf" });
    expect(countryOf(H({}), key("114.114.114.114"))).toEqual({ country: "CN", source: "registry" });
    expect(countryOf(H({ "cf-ipcountry": "XX" }), key("114.114.114.114"))).toEqual({ country: "CN", source: "registry" });
    expect(countryOf(H({}), key("8.8.8.8"))).toEqual({ country: "XX", source: "none" });
    expect(countryOf(H({}), null)).toEqual({ country: "XX", source: "none" });
  });

  it("a counted caller carries the address's country; an address that is not public stays XX", async () => {
    expect(await classifyCaller(H({ "cf-connecting-ip": "223.5.5.5" }), "svc")).toMatchObject({ kind: "address", country: "CN" });
    expect(await classifyCaller(H({ "cf-connecting-ip": "8.8.8.8" }), "svc")).toMatchObject({ kind: "address", country: "XX" });
    expect(await classifyCaller(H({ "x-forwarded-for": "114.114.114.114, 10.0.0.7" }), "svc"))
      .toMatchObject({ kind: "unknown_address", country: "XX" });
  });
});
