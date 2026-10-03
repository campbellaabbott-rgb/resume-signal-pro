// A COUNTRY'S ADDRESS BLOCKS, PACKED INTO AN EDGE FUNCTION'S BUNDLE.
//
// (No shebang: vitest imports this file, see scripts/emit-lca-payload.mjs.)
//
// WHY THIS EXISTS. On this platform cf-ipcountry never reaches an edge
// function: every request in the first hour of job-board .85 telemetry read
// XX, and a client-written one is removed too. The address does arrive
// (cf-connecting-ip, which Cloudflare refuses from a client). So a country is
// looked up from the address, here, against the registries' own record of
// which blocks were delegated to it. Two modules are built with it:
//   - job-board/cn-ranges.ts, mainland China, for the board's meter (.86);
//   - _shared/blocked-country-ranges.ts, RU, NG and PK, for create-checkout's
//     country block (create-checkout.2026-10-03.1).
// It was scripts/build-cn-ranges.mjs until it built more than China.
//
// THE SOURCES. (1) The regional registries' daily statistics files, free to
// use on the condition that the registry is not held responsible for its use:
// every block a file records as the country's. They record where a block was
// FIRST delegated, not where it is in use today, and a country can appear in
// more than one registry's file (NG and PK each hold a few RIPE NCC blocks), so
// a country is the union over every file given. The CN module was built from
// APNIC's file alone. Hong Kong and Macau are their own entries (HK, MO).
// (2) For one country only, scripts/data/cn-extra-blocks.txt: the mainland
// blocks APNIC's file records under another country -- Alibaba Cloud's
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
// delegation in these files is a /48 or shorter, which this script checks).
// Each family is a run of unsigned LEB128 varints, gap-from-previous-end then
// length, base64'd. The decoder is supabase/functions/_shared/registry-blocks.ts.
//
// It writes one file and nothing else. No database, no key.
//
// USAGE
//   China, for job-board:
//   curl -s -o /tmp/delegated-apnic-latest https://ftp.apnic.net/stats/apnic/delegated-apnic-latest
//   curl -s -o /tmp/aws-ip-ranges.json https://ip-ranges.amazonaws.com/ip-ranges.json
//   node scripts/build-country-ranges.mjs --cc CN --in /tmp/delegated-apnic-latest \
//     --include scripts/data/cn-extra-blocks.txt --aws /tmp/aws-ip-ranges.json \
//     --reader geo-cn.ts --out supabase/functions/job-board/cn-ranges.ts
//
//   The checkout's blocked countries, from all five registries:
//   curl -s -o /tmp/delegated-afrinic-latest https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-latest
//   curl -s -o /tmp/delegated-apnic-latest https://ftp.apnic.net/stats/apnic/delegated-apnic-latest
//   curl -s -o /tmp/delegated-arin-extended-latest https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest
//   curl -s -o /tmp/delegated-lacnic-latest https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-latest
//   curl -s -o /tmp/delegated-ripencc-latest https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-latest
//   node scripts/build-country-ranges.mjs --cc RU,NG,PK \
//     --in /tmp/delegated-afrinic-latest --in /tmp/delegated-apnic-latest --in /tmp/delegated-arin-extended-latest \
//     --in /tmp/delegated-lacnic-latest --in /tmp/delegated-ripencc-latest \
//     --reader blocked-countries.ts --out supabase/functions/_shared/blocked-country-ranges.ts

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The five regional registries, as each statistics file's header names it. */
export const REGISTRIES = {
  afrinic: { name: "AFRINIC", file: "delegated-afrinic-latest" },
  apnic: { name: "APNIC", file: "delegated-apnic-latest" },
  arin: { name: "ARIN", file: "delegated-arin-extended-latest" },
  lacnic: { name: "LACNIC", file: "delegated-lacnic-latest" },
  ripencc: { name: "RIPE NCC", file: "delegated-ripencc-latest" },
};

/**
 * One registry file's [start, end) blocks of one country, with the file's
 * date: the header's serial when it is a YYYYMMDD date (APNIC, AFRINIC,
 * LACNIC), else its end date (RIPE NCC's and ARIN's serials are counters).
 */
export function parseDelegated(text, cc) {
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"));
  const header = lines[0]?.split("|") ?? [];
  const date = /^\d{8}$/.test(header[2] ?? "") ? header[2] : header[5];
  if (!/^2(\.\d+)?$/.test(header[0] ?? "") || !Object.hasOwn(REGISTRIES, header[1] ?? "") || !/^\d{8}$/.test(date ?? "")) {
    throw new Error(`not a registry delegated file: first record ${JSON.stringify(lines[0])}`);
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
  return { registry: header[1], serial: date, v4Records: v4.length, v6Records: v6.length, v4: merge(v4), v6: merge(v6) };
}

/**
 * One country across several registries' files: the union of their blocks.
 * `registry` names the files that held any ("afrinic+ripencc"), `serial` is
 * the oldest of their dates. A file given twice, or a country no file holds,
 * is refused.
 */
export function unionDelegated(parts, cc) {
  const seen = new Set();
  for (const p of parts) {
    if (seen.has(p.registry)) throw new Error(`two ${p.registry} files given`);
    seen.add(p.registry);
  }
  const held = parts.filter((p) => p.v4Records + p.v6Records > 0).sort((a, b) => a.registry.localeCompare(b.registry));
  if (!held.length) throw new Error(`no ${cc} block in any file given`);
  return {
    registry: held.map((p) => p.registry).join("+"),
    serial: held.map((p) => p.serial).sort()[0],
    v4Records: held.reduce((n, p) => n + p.v4Records, 0),
    v6Records: held.reduce((n, p) => n + p.v6Records, 0),
    v4: merge(held.flatMap((p) => p.v4)),
    v6: merge(held.flatMap((p) => p.v6)),
  };
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

const isoDate = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** "APNIC's delegated-apnic-latest" for one file; every file and its date for several. */
function sourcesText(files) {
  if (files.length === 1) return `${REGISTRIES[files[0].registry].name}'s ${REGISTRIES[files[0].registry].file}`;
  const named = [...files].sort((a, b) => a.registry.localeCompare(b.registry))
    .map((f) => `${REGISTRIES[f.registry].name} ${isoDate(f.serial)}`);
  return `the delegated files of ${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

/**
 * The module: per country `<CC>_RANGES_SOURCE`, `<CC>_V4`, `<CC>_V6`, in the
 * order given. `files` are the registry files read (with their dates, for the
 * header), `reader` the module that decodes this one.
 */
export function renderModule(countries, { files, reader }) {
  const out = [
    `// GENERATED by scripts/build-country-ranges.mjs from ${sourcesText(files)}. Do not edit by hand;`,
    `// regenerate. Decoded and searched by ${reader}.`,
  ];
  for (const c of countries) {
    if (!/^[A-Z]{2}$/.test(c.cc ?? "")) throw new Error(`not a country code: ${c.cc}`);
    const v4Addresses = c.v4.reduce((n, [s, e]) => n + (e - s), 0);
    out.push(
      `export const ${c.cc}_RANGES_SOURCE = {`,
      `  registry: "${c.registry}",`,
      `  serial: "${isoDate(c.serial)}",`,
      `  v4Records: ${c.v4Records},`,
      `  v4Blocks: ${c.v4.length},`,
      `  v4Addresses: ${v4Addresses},`,
      `  v6Records: ${c.v6Records},`,
      `  v6Blocks: ${c.v6.length},`,
      `  curatedBlocks: ${c.curatedBlocks ?? 0},`,
      `  aws: ${c.aws ? `{ createDate: "${c.aws.createDate}", v4Prefixes: ${c.aws.v4}, v6Prefixes: ${c.aws.v6}, v6SkippedLongerThan48: ${c.aws.v6Skipped} }` : "null"},`,
      "} as const;",
      `export const ${c.cc}_V4 = "${encodeRanges(c.v4)}";`,
      `export const ${c.cc}_V6 = "${encodeRanges(c.v6)}";`,
    );
  }
  return [...out, ""].join("\n");
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const args = (name) => process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]] : []));

// pathToFileURL, not a template: the repository sits under a path with spaces,
// which import.meta.url percent-encodes and argv does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ccs = (arg("--cc") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const inputs = args("--in"), output = arg("--out"), reader = arg("--reader"), include = arg("--include"), aws = arg("--aws");
  if (!ccs.length || !inputs.length || !output || !reader) {
    console.error("usage: node scripts/build-country-ranges.mjs --cc <CC[,CC...]> --in <delegated file> [--in ...] [--include <extra-blocks.txt>] [--aws <ip-ranges.json>] --reader <decoder module> --out <ranges.ts>");
    process.exit(2);
  }
  if ((include || aws) && ccs.length !== 1) throw new Error("--include and --aws add to one country: give a single --cc");
  if (aws && ccs[0] !== "CN") throw new Error("--aws reads AWS's cn-* regions, which are China's");
  // perFile[file][country]: every file is read for every country.
  const perFile = inputs.map((p) => readFileSync(p, "utf8")).map((t) => ccs.map((cc) => parseDelegated(t, cc)));
  const files = perFile.map(([p]) => ({ registry: p.registry, serial: p.serial }));
  const countries = ccs.map((cc, i) => ({
    cc,
    ...combine(
      unionDelegated(perFile.map((f) => f[i]), cc),
      include ? parseInclude(readFileSync(include, "utf8")) : null,
      aws ? parseAws(readFileSync(aws, "utf8")) : null,
    ),
  }));
  writeFileSync(output, renderModule(countries, { files, reader }));
  for (const c of countries) {
    console.log(`${c.cc}: ${c.registry} ${c.serial}, ${c.v4.length} IPv4 blocks (${c.v4Records} records, ${c.curatedBlocks} curated, ${c.aws?.v4 ?? 0} AWS), ${c.v6.length} IPv6 blocks (${c.v6Records} records, ${c.aws?.v6 ?? 0} AWS, ${c.aws?.v6Skipped ?? 0} AWS skipped as longer than /48)`);
  }
  console.log(`wrote ${output}`);
}
