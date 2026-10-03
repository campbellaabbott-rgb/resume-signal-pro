// CHINA'S ADDRESS BLOCKS, PACKED INTO THE JOB-BOARD BUNDLE.
//
// (No shebang: vitest imports this file, see scripts/emit-lca-payload.mjs.)
//
// WHY THIS EXISTS. The country switch in job-board .85 read cf-ipcountry, and
// on this platform that header never reaches the function: every request in
// the first hour of telemetry read XX, and a client-written one is removed
// too. The address does arrive (cf-connecting-ip, which Cloudflare refuses
// from a client). So the country is looked up from the address, here, against
// the registry's own record of which blocks were delegated to China.
//
// THE SOURCES. (1) APNIC's delegated-apnic-latest, the regional registry's
// daily statistics file, free to use on the condition that APNIC is not held
// responsible for its use: every block it records as CN. It records where a
// block was FIRST delegated, not where it is in use today; Hong Kong and Macau
// are their own entries (HK, MO). (2) scripts/data/cn-extra-blocks.txt, the
// mainland blocks that file records under another country -- Alibaba Cloud's
// mainland pools sit inside delegations filed as Singapore, and a scraper on
// Alibaba's mainland servers would otherwise read as not China. (3)
// Optionally, AWS's published ip-ranges.json: every prefix in a cn-* region
// (Beijing and Ningxia), some of them registered at ARIN to Amazon. IPv6
// prefixes longer than /48 cannot be held in this format and are skipped and
// counted. The other direction is NOT corrected: a few CN-delegated blocks
// are sub-assigned to cloud regions in Hong Kong or the US (Tencent Cloud HK
// 119.28.0.0/15, for one) and read as CN.
//
// THE FORMAT. Overlapping and touching delegations are merged. IPv4 blocks are
// [start, end) over the 32-bit space; IPv6 blocks over the top 48 bits (every
// China delegation is a /48 or shorter, which this script checks). Each
// family is a run of unsigned LEB128 varints, gap-from-previous-end then
// length, base64'd. The decoder is supabase/functions/job-board/geo-cn.ts.
//
// It writes one file and nothing else. No database, no key.
//
// USAGE
//   curl -s -o /tmp/delegated-apnic-latest https://ftp.apnic.net/stats/apnic/delegated-apnic-latest
//   curl -s -o /tmp/aws-ip-ranges.json https://ip-ranges.amazonaws.com/ip-ranges.json
//   node scripts/build-cn-ranges.mjs --in /tmp/delegated-apnic-latest \
//     --include scripts/data/cn-extra-blocks.txt --aws /tmp/aws-ip-ranges.json \
//     --out supabase/functions/job-board/cn-ranges.ts

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The header line's serial (YYYYMMDD) and the [start, end) blocks of one country. */
export function parseDelegated(text, cc) {
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"));
  const header = lines[0]?.split("|") ?? [];
  if (header[0] !== "2" || header[1] !== "apnic" || !/^\d{8}$/.test(header[2] ?? "")) {
    throw new Error(`not an APNIC delegated file: first record ${JSON.stringify(lines[0])}`);
  }
  const v4 = [], v6 = [];
  for (const l of lines) {
    const f = l.split("|");
    if (f[1] !== cc || (f[6] !== "allocated" && f[6] !== "assigned")) continue;
    if (f[2] === "ipv4") {
      const start = v4Number(f[3]);
      const count = Number(f[4]);
      if (!Number.isInteger(count) || count < 1 || start + count > 2 ** 32) throw new Error(`bad ipv4 record ${l}`);
      v4.push([start, start + count]);
    } else if (f[2] === "ipv6") {
      const len = Number(f[4]);
      if (!Number.isInteger(len) || len < 1 || len > 48) throw new Error(`ipv6 record longer than /48: ${l}`);
      const start = v6Top48(f[3]);
      const size = 2 ** (48 - len);
      if (start % size !== 0) throw new Error(`ipv6 record not aligned to its prefix: ${l}`);
      v6.push([start, start + size]);
    }
  }
  return { serial: header[2], v4Records: v4.length, v6Records: v6.length, v4: merge(v4), v6: merge(v6) };
}

function v4Number(s) {
  const p = s.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error(`bad ipv4 ${s}`);
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

/** The top 48 bits of an IPv6 address, as a safe integer. */
export function v6Top48(s) {
  const [head, tail = ""] = s.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const words = s.includes("::") ? [...h, ...new Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (words.length !== 8 || words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) throw new Error(`bad ipv6 ${s}`);
  const [a, b, c] = words.map((w) => parseInt(w, 16));
  return (a * 65536 + b) * 65536 + c;
}

/** One CIDR as [family, start, end): IPv4 over 32 bits, IPv6 over the top 48 (null when longer than /48). */
export function parseCidr(cidr) {
  const [addr, lenText] = String(cidr).trim().split("/");
  const len = Number(lenText);
  if (!addr || !Number.isInteger(len)) throw new Error(`bad CIDR ${cidr}`);
  if (addr.includes(":")) {
    if (len < 1 || len > 128) throw new Error(`bad CIDR ${cidr}`);
    if (len > 48) return null;
    const start = v6Top48(addr), size = 2 ** (48 - len);
    if (start % size !== 0) throw new Error(`CIDR not aligned to its prefix: ${cidr}`);
    return ["v6", start, start + size];
  }
  if (len < 1 || len > 32) throw new Error(`bad CIDR ${cidr}`);
  const start = v4Number(addr), size = 2 ** (32 - len);
  if (start % size !== 0) throw new Error(`CIDR not aligned to its prefix: ${cidr}`);
  return ["v4", start, start + size];
}

/** The curated list: a CIDR, then free-text evidence; # comments and blank lines skipped. Nothing may be skipped silently. */
export function parseInclude(text) {
  const v4 = [], v6 = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const r = parseCidr(line.split(/\s+/)[0]);
    if (!r) throw new Error(`curated IPv6 entry longer than /48: ${line}`);
    (r[0] === "v4" ? v4 : v6).push([r[1], r[2]]);
  }
  return { v4, v6 };
}

/** AWS ip-ranges.json: every prefix in a cn-* region. */
export function parseAws(json) {
  const j = typeof json === "string" ? JSON.parse(json) : json;
  if (!Array.isArray(j?.prefixes) || !Array.isArray(j?.ipv6_prefixes)) throw new Error("not an AWS ip-ranges.json");
  const inCn = (p) => typeof p.region === "string" && p.region.startsWith("cn-");
  const v4 = [], v6 = [];
  let v6Skipped = 0;
  for (const p of new Set(j.prefixes.filter(inCn).map((p) => p.ip_prefix))) {
    const r = parseCidr(p);
    v4.push([r[1], r[2]]);
  }
  for (const p of new Set(j.ipv6_prefixes.filter(inCn).map((p) => p.ipv6_prefix))) {
    const r = parseCidr(p);
    if (r) v6.push([r[1], r[2]]); else v6Skipped++;
  }
  return { createDate: String(j.createDate ?? ""), v4, v6, v6Skipped };
}

/** The registry's blocks plus the curated and AWS ones, merged. */
export function combine(delegated, include, aws) {
  return {
    ...delegated,
    curatedBlocks: include ? include.v4.length + include.v6.length : 0,
    aws: aws ? { createDate: aws.createDate, v4: aws.v4.length, v6: aws.v6.length, v6Skipped: aws.v6Skipped } : null,
    v4: merge([...delegated.v4, ...(include?.v4 ?? []), ...(aws?.v4 ?? [])]),
    v6: merge([...delegated.v6, ...(include?.v6 ?? []), ...(aws?.v6 ?? [])]),
  };
}

export function merge(ranges) {
  const out = [];
  for (const [s, e] of [...ranges].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Gap from the previous end, then length, as unsigned LEB128, base64'd. */
export function encodeRanges(ranges) {
  const bytes = [];
  const varint = (n) => {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`cannot encode ${n}`);
    while (n >= 128) { bytes.push((n % 128) + 128); n = Math.floor(n / 128); }
    bytes.push(n);
  };
  let prev = 0;
  for (const [s, e] of ranges) {
    if (s < prev || e <= s) throw new Error(`ranges must be sorted, disjoint and non-empty at [${s}, ${e})`);
    varint(s - prev);
    varint(e - s);
    prev = e;
  }
  return Buffer.from(bytes).toString("base64");
}

export function renderModule(parsed) {
  const v4Addresses = parsed.v4.reduce((n, [s, e]) => n + (e - s), 0);
  const d = parsed.serial;
  return [
    "// GENERATED by scripts/build-cn-ranges.mjs from APNIC's delegated-apnic-latest. Do not edit by hand;",
    "// regenerate. Decoded and searched by geo-cn.ts.",
    "export const CN_RANGES_SOURCE = {",
    `  registry: "apnic",`,
    `  serial: "${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}",`,
    `  v4Records: ${parsed.v4Records},`,
    `  v4Blocks: ${parsed.v4.length},`,
    `  v4Addresses: ${v4Addresses},`,
    `  v6Records: ${parsed.v6Records},`,
    `  v6Blocks: ${parsed.v6.length},`,
    `  curatedBlocks: ${parsed.curatedBlocks ?? 0},`,
    `  aws: ${parsed.aws ? `{ createDate: "${parsed.aws.createDate}", v4Prefixes: ${parsed.aws.v4}, v6Prefixes: ${parsed.aws.v6}, v6SkippedLongerThan48: ${parsed.aws.v6Skipped} }` : "null"},`,
    "} as const;",
    `export const CN_V4 = "${encodeRanges(parsed.v4)}";`,
    `export const CN_V6 = "${encodeRanges(parsed.v6)}";`,
    "",
  ].join("\n");
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

// pathToFileURL, not a template: the repository sits under a path with spaces,
// which import.meta.url percent-encodes and argv does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = arg("--in"), output = arg("--out"), include = arg("--include"), aws = arg("--aws");
  if (!input || !output) {
    console.error("usage: node scripts/build-cn-ranges.mjs --in <delegated-apnic-latest> [--include <cn-extra-blocks.txt>] [--aws <ip-ranges.json>] --out <cn-ranges.ts>");
    process.exit(2);
  }
  const parsed = combine(
    parseDelegated(readFileSync(input, "utf8"), "CN"),
    include ? parseInclude(readFileSync(include, "utf8")) : null,
    aws ? parseAws(readFileSync(aws, "utf8")) : null,
  );
  writeFileSync(output, renderModule(parsed));
  console.log(`wrote ${output}: serial ${parsed.serial}, ${parsed.v4.length} IPv4 blocks (${parsed.v4Records} records, ${parsed.curatedBlocks} curated, ${parsed.aws?.v4 ?? 0} AWS), ${parsed.v6.length} IPv6 blocks (${parsed.v6Records} records, ${parsed.aws?.v6 ?? 0} AWS, ${parsed.aws?.v6Skipped ?? 0} AWS skipped as longer than /48)`);
}
