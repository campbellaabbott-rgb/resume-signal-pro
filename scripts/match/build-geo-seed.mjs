#!/usr/bin/env node
// THE GEONAMES SEED FOR geo_places (résumé matching, phase 0).
//
//   node scripts/match/build-geo-seed.mjs --cities <cities5000.txt> --admin1 <admin1CodesASCII.txt>
//        [--countries US,CA,GB,...] [--min-pop 5000] [--max-bytes 900000] [--out supabase/migrations] [--dry-run]
//
// Turns the two GeoNames files (https://download.geonames.org/export/dump/,
// cities5000.zip unzipped and admin1CodesASCII.txt; CC BY 4.0, attribution
// "GeoNames, geonames.org") into idempotent migration chunks under --max-bytes
// each, stamped 20261016101100, 20261016101110, ... (ten seconds apart, after
// metro_ring's 20261016101000 and before match_candidates' 20261016102000, so
// the last part can ask metro_ring for a ring). Every chunk is INSERT ... ON CONFLICT
// (geonameid) DO UPDATE, so it is safe to run twice; the last chunk checks the
// row count and, when the US is in the seed, that the Columbus, OH ring holds
// Westerville and never Columbus, GA, and RAISEs otherwise.
//
// The download is a step for the owner or the deploy session: this script
// reads only the files it is given and never fetches anything.
//
// region: the short code the board's locations use where one exists (US
// state, Canadian province, Australian state or territory); elsewhere the
// first-level region's name. region_name: always the name. admin1_code: the
// GeoNames code, as metro_ring also accepts it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_VERSION = "geonames-cities5000";
export const FIRST_STAMP = "20261016101100";
export const LAST_STAMP_BEFORE = "20261016102000";
export const ROWS_PER_INSERT = 400;

/** Canadian provinces and territories by GeoNames admin1 name. */
export const CA_CODES = {
  "Alberta": "AB", "British Columbia": "BC", "Manitoba": "MB", "New Brunswick": "NB", "Newfoundland and Labrador": "NL",
  "Nova Scotia": "NS", "Ontario": "ON", "Prince Edward Island": "PE", "Quebec": "QC", "Saskatchewan": "SK",
  "Yukon": "YT", "Northwest Territories": "NT", "Nunavut": "NU",
};
/** Australian states and territories by GeoNames admin1 name. */
export const AU_CODES = {
  "Australian Capital Territory": "ACT", "New South Wales": "NSW", "Northern Territory": "NT", "Queensland": "QLD",
  "South Australia": "SA", "Tasmania": "TAS", "Victoria": "VIC", "Western Australia": "WA",
};

/** The i-th chunk's stamp: 10:11:00, 10:11:10 ... 10:19:50 on 2026-10-16. */
export function stampFor(i) {
  const minute = 11 + Math.floor(i / 6);
  const second = (i % 6) * 10;
  if (minute > 19) throw new Error(`more than 54 chunks: raise --max-bytes or narrow --countries`);
  return `2026101610${String(minute).padStart(2, "0")}${String(second).padStart(2, "0")}`;
}

const q = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

/** admin1CodesASCII.txt: "US.OH<TAB>Ohio<TAB>Ohio<TAB>5165418" -> Map("US.OH" -> {name, ascii}). */
export function readAdmin1(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [code, name, ascii] = line.split("\t");
    if (code && name) out.set(code.trim(), { name: name.trim(), ascii: (ascii ?? name).trim() });
  }
  return out;
}

export function regionFor(country, admin1, a1) {
  if (!admin1) return { region: null, regionName: null };
  const entry = a1.get(`${country}.${admin1}`);
  const name = entry ? (entry.ascii || entry.name) : null;
  if (country === "US") return { region: /^[A-Z]{2}$/.test(admin1) ? admin1 : name, regionName: name };
  if (country === "CA" && name && CA_CODES[name]) return { region: CA_CODES[name], regionName: name };
  if (country === "AU" && name && AU_CODES[name]) return { region: AU_CODES[name], regionName: name };
  return { region: name, regionName: name };
}

/**
 * cities5000.txt columns (tab-separated): 0 geonameid, 1 name, 2 asciiname,
 * 3 alternatenames, 4 latitude, 5 longitude, 6 feature class, 7 feature code,
 * 8 country code, 9 cc2, 10 admin1 code, ... 14 population.
 */
export function readCities(text, a1, opts = {}) {
  const countries = opts.countries ? new Set(opts.countries.map((c) => c.toUpperCase())) : null;
  const minPop = opts.minPop ?? 5000;
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    if (c.length < 15) continue;
    const id = Number(c[0]);
    const lat = Number(c[4]);
    const lon = Number(c[5]);
    const pop = Number(c[14]) || 0;
    const country = (c[8] ?? "").trim().toUpperCase();
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (!/^[A-Z]{2}$/.test(country) || (countries && !countries.has(country))) continue;
    if (c[6] && c[6] !== "P") continue;
    if (pop < minPop) continue;
    const name = c[1].trim();
    if (!name) continue;
    const admin1 = (c[10] ?? "").trim() || null;
    const { region, regionName } = regionFor(country, admin1, a1);
    rows.push({ id, name, ascii: (c[2] ?? "").trim() || name, country, admin1, region, regionName, lat, lon, pop });
  }
  rows.sort((x, y) => x.id - y.id);
  return rows;
}

const COLS = "geonameid, name, ascii_name, country, admin1_code, region, region_name, lat, lon, population, source_version";
const tuple = (r, version) => `(${r.id}, ${q(r.name)}, ${q(r.ascii)}, ${q(r.country)}, ${q(r.admin1)}, ${q(r.region)}, ${q(r.regionName)}, ${r.lat}, ${r.lon}, ${Math.min(r.pop, 2147483647)}, ${q(version)})`;
const insert = (tuples) => `INSERT INTO public.geo_places (${COLS}) VALUES\n${tuples.join(",\n")}\nON CONFLICT (geonameid) DO UPDATE SET name = EXCLUDED.name, ascii_name = EXCLUDED.ascii_name, country = EXCLUDED.country, admin1_code = EXCLUDED.admin1_code, region = EXCLUDED.region, region_name = EXCLUDED.region_name, lat = EXCLUDED.lat, lon = EXCLUDED.lon, population = EXCLUDED.population, source_version = EXCLUDED.source_version;\n`;

function header(i, n, rows, version) {
  return [
    `-- THE PLACES A COMMUTE RING IS DRAWN FROM, part ${i + 1} of ${n} (résumé matching, phase 0).`,
    `--`,
    `-- ${rows} places from GeoNames ${version} (CC BY 4.0; attribution "GeoNames,`,
    `-- geonames.org"), written by scripts/match/build-geo-seed.mjs. Each row is`,
    `-- inserted or brought up to date by geonameid, so this file is safe to run`,
    `-- twice. Depends on 20261016100000 (geo_places) and, for the last part's`,
    `-- check, 20261016101000 (metro_ring).`,
    ``,
  ].join("\n");
}

function selfCheck(total, version, hasUS) {
  const ring = hasUS
    ? `
  IF NOT EXISTS (SELECT 1 FROM public.metro_ring('Columbus', 'OH', 'US', 40, 20) r WHERE r.name = 'Westerville' AND r.region = 'OH') THEN
    RAISE EXCEPTION 'geo_places seed: the Columbus, OH ring does not hold Westerville';
  END IF;
  IF EXISTS (SELECT 1 FROM public.metro_ring('Columbus', 'OH', 'US', 40, 20) r WHERE r.region = 'GA') THEN
    RAISE EXCEPTION 'geo_places seed: the Columbus, OH ring reaches Georgia';
  END IF;`
    : "";
  return `
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.geo_places WHERE source_version = ${q(version)};
  IF n < ${total} THEN
    RAISE EXCEPTION 'geo_places seed: % rows of ${version}, want at least ${total} (an earlier part did not apply)', n;
  END IF;
  IF to_regprocedure('public.metro_ring(text, text, text, integer, integer)') IS NULL THEN
    RAISE EXCEPTION 'geo_places seed: metro_ring does not exist (apply 20261016101000 first)';
  END IF;${ring}
END $$;
`;
}

/** Chunks of SQL, each under maxBytes (UTF-8), the last one carrying the self-check. */
export function buildSeed({ citiesText, admin1Text, countries = null, minPop = 5000, maxBytes = 900_000, version = SOURCE_VERSION }) {
  const a1 = readAdmin1(admin1Text);
  const rows = readCities(citiesText, a1, { countries, minPop });
  if (!rows.length) throw new Error("no places read: check --cities, --countries and --min-pop");
  const hasUS = rows.some((r) => r.country === "US");
  const check = selfCheck(rows.length, version, hasUS);
  const budget = maxBytes - 600 - Buffer.byteLength(check);
  if (budget < 20_000) throw new Error("--max-bytes is too small");
  const bodies = [];
  let cur = [];
  let curBytes = 0;
  let curRows = 0;
  let batch = [];
  const flushBatch = () => { if (batch.length) { cur.push(insert(batch)); batch = []; } };
  for (const r of rows) {
    const t = tuple(r, version);
    const add = Buffer.byteLength(t) + 2;
    if (curBytes + add + 900 > budget && (cur.length || batch.length)) {
      flushBatch();
      bodies.push({ sql: cur.join("\n"), rows: curRows });
      cur = []; curBytes = 0; curRows = 0;
    }
    batch.push(t); curBytes += add; curRows++;
    if (batch.length >= ROWS_PER_INSERT) { flushBatch(); curBytes += 900; }
  }
  flushBatch();
  if (cur.length) bodies.push({ sql: cur.join("\n"), rows: curRows });
  const n = bodies.length;
  return bodies.map((b, i) => {
    const stamp = stampFor(i);
    const sql = header(i, n, b.rows, version) + b.sql + (i === n - 1 ? check : "");
    return { stamp, file: `${stamp}_the_places_a_commute_ring_is_drawn_from_part_${String(i + 1).padStart(2, "0")}.sql`, sql, rows: b.rows, bytes: Buffer.byteLength(sql) };
  });
}

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cities = arg("cities");
  const admin1 = arg("admin1");
  if (!cities || !admin1) {
    console.error("usage: node scripts/match/build-geo-seed.mjs --cities cities5000.txt --admin1 admin1CodesASCII.txt [--countries US,CA] [--min-pop 5000] [--max-bytes 900000] [--out supabase/migrations] [--dry-run]");
    process.exit(2);
  }
  const chunks = buildSeed({
    citiesText: readFileSync(cities, "utf8"),
    admin1Text: readFileSync(admin1, "utf8"),
    countries: arg("countries") ? arg("countries").split(",").map((s) => s.trim()).filter(Boolean) : null,
    minPop: Number(arg("min-pop", "5000")),
    maxBytes: Number(arg("max-bytes", "900000")),
  });
  const out = resolve(arg("out", "supabase/migrations"));
  for (const c of chunks) {
    console.log(`${c.file}  ${c.rows} places  ${c.bytes} bytes`);
    if (!process.argv.includes("--dry-run")) { mkdirSync(out, { recursive: true }); writeFileSync(resolve(out, c.file), c.sql); }
  }
  console.log(`${chunks.reduce((a, c) => a + c.rows, 0)} places in ${chunks.length} part(s)${process.argv.includes("--dry-run") ? " (dry run: nothing written)" : ` written to ${out}`}`);
}
