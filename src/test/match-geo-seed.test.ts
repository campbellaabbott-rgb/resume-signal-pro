// @vitest-environment node
/**
 * THE GEONAMES SEED BUILDER WRITES CHUNKS THAT APPLY TWICE AND CHECK THEIR RING.
 *
 * scripts/match/build-geo-seed.mjs turns cities5000.txt and admin1CodesASCII.txt
 * (GeoNames' own formats) into geo_places migration chunks. The real files are
 * an owner download; this test feeds a few lines in the same formats (rounded
 * public coordinates) and applies the chunks in pglite on top of the shipped
 * 20261016 migrations (geo_places empty):
 *   - every chunk is under --max-bytes, stamped after metro_ring and before
 *     match_candidates, in order;
 *   - regions read as the board writes them (OH, ON, NSW) and elsewhere by
 *     name (England), with the name always in region_name;
 *   - applying every chunk twice leaves the same rows;
 *   - metro_ring then holds Westerville in the Columbus, OH ring and never
 *     Columbus, GA;
 *   - the last chunk RAISEs when a part did not apply, and when the US is in
 *     the seed but the Columbus, OH ring lacks Westerville (positive controls);
 *   - the builder fetches nothing: it reads only the text it is handed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { bootMatchDb } from "./fixtures/match-bench/db";
import { buildSeed, stampFor, regionFor, readAdmin1 } from "../../scripts/match/build-geo-seed.mjs";

type Chunk = { stamp: string; file: string; sql: string; rows: number; bytes: number };

/** geonameid, name, asciiname, alternatenames, lat, lon, class, code, country, cc2, admin1, admin2, admin3, admin4, population, elevation, dem, tz, modified */
const city = (id: number, name: string, lat: number, lon: number, country: string, admin1: string, pop: number, ascii = name) =>
  [id, name, ascii, "", lat, lon, "P", "PPL", country, "", admin1, "", "", "", pop, "", "200", "UTC", "2026-01-01"].join("\t");

const CITIES = [
  city(4509177, "Columbus", 39.9612, -82.9988, "US", "OH", 905748),
  city(5176937, "Westerville", 40.1262, -82.9291, "US", "OH", 39190),
  city(4152820, "Dublin", 40.0992, -83.1141, "US", "OH", 49328),
  city(4513583, "Grove City", 39.8815, -83.093, "US", "OH", 41252),
  city(4192205, "Columbus", 32.461, -84.9877, "US", "GA", 206922),
  city(4078964, "Phenix City", 32.4709, -85.0008, "US", "AL", 38816),
  city(6167865, "Toronto", 43.7064, -79.3986, "CA", "08", 2731571),
  city(6075357, "Mississauga", 43.5789, -79.6583, "CA", "08", 721599),
  city(6077243, "Montréal", 45.5088, -73.5878, "CA", "10", 1762949, "Montreal"),
  city(6058560, "L'Assomption", 45.8233, -73.4291, "CA", "10", 22429, "L'Assomption"),
  city(2147714, "Sydney", -33.8679, 151.2073, "AU", "02", 4627345),
  city(2643743, "London", 51.5085, -0.1257, "GB", "ENG", 8961989),
  city(2950159, "Berlin", 52.5244, 13.4105, "DE", "16", 3426354),
  city(9999901, "Tinyville", 40.0, -83.0, "US", "OH", 1200),
].join("\n");

const ADMIN1 = [
  "US.OH\tOhio\tOhio\t5165418", "US.GA\tGeorgia\tGeorgia\t4197000", "US.AL\tAlabama\tAlabama\t4829764",
  "CA.08\tOntario\tOntario\t6093943", "CA.10\tQuebec\tQuebec\t6115047", "AU.02\tNew South Wales\tNew South Wales\t2155400",
  "GB.ENG\tEngland\tEngland\t6269131", "DE.16\tBerlin\tBerlin\t2950157",
].join("\n");

/** Supabase's roles and default grants, the board's postings table and the four shipped 20261016 migrations; geo_places empty. */
const boot = (): Promise<PGlite> => bootMatchDb({ places: false });

describe("build-geo-seed", () => {
  it("writes chunks under the byte budget, stamped after metro_ring and before match_candidates, in order", () => {
    const chunks = buildSeed({ citiesText: CITIES, admin1Text: ADMIN1, maxBytes: 22_000 }) as Chunk[];
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.map((c) => c.stamp)).toEqual(chunks.map((_, i) => stampFor(i)));
    for (const c of chunks) {
      expect(c.stamp > "20261016101000" && c.stamp < "20261016102000", c.stamp).toBe(true);
      expect(c.bytes).toBeLessThanOrEqual(22_000);
      expect(c.file).toMatch(/^\d{14}_the_places_a_commute_ring_is_drawn_from_part_\d\d\.sql$/);
    }
    expect(chunks.reduce((a, c) => a + c.rows, 0)).toBe(13); // Tinyville is under 5,000 people
    expect(stampFor(0)).toBe("20261016101100");
    expect(stampFor(7)).toBe("20261016101210");
    expect(() => stampFor(54)).toThrow(/more than 54 chunks/);
  });

  it("splits a large seed into several chunks, each a complete statement list", () => {
    const many = Array.from({ length: 900 }, (_, i) => city(10_000_000 + i, `Place ${i}`, 10 + i / 100, 20, "DE", "16", 6000 + i)).join("\n");
    const chunks = buildSeed({ citiesText: `${CITIES}\n${many}`, admin1Text: ADMIN1, maxBytes: 40_000 }) as Chunk[];
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.bytes).toBeLessThanOrEqual(40_000);
    expect(chunks.reduce((a, c) => a + c.rows, 0)).toBe(913);
    expect(chunks.slice(0, -1).every((c) => !/DO \$\$/.test(c.sql))).toBe(true);
    expect(chunks[chunks.length - 1].sql).toMatch(/DO \$\$/);
  });

  it("reads regions as the board writes them, and elsewhere by name", () => {
    const a1 = readAdmin1(ADMIN1);
    expect(regionFor("US", "OH", a1)).toEqual({ region: "OH", regionName: "Ohio" });
    expect(regionFor("CA", "08", a1)).toEqual({ region: "ON", regionName: "Ontario" });
    expect(regionFor("CA", "10", a1)).toEqual({ region: "QC", regionName: "Quebec" });
    expect(regionFor("AU", "02", a1)).toEqual({ region: "NSW", regionName: "New South Wales" });
    expect(regionFor("GB", "ENG", a1)).toEqual({ region: "England", regionName: "England" });
    expect(regionFor("DE", "16", a1)).toEqual({ region: "Berlin", regionName: "Berlin" });
    expect(regionFor("FR", null, a1)).toEqual({ region: null, regionName: null });
  });

  it("applies twice to the same rows, and metro_ring then reaches Westerville and never Columbus, GA", async () => {
    const chunks = buildSeed({ citiesText: CITIES, admin1Text: ADMIN1, maxBytes: 22_000 }) as Chunk[];
    const db = await boot();
    for (const c of chunks) await db.exec(c.sql);
    for (const c of chunks) await db.exec(c.sql);
    const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.geo_places");
    expect(n.rows[0].n).toBe(13);
    const q = await db.query<{ name: string; region: string; region_name: string; ascii_name: string }>(
      "SELECT name, region, region_name, ascii_name FROM public.geo_places WHERE geonameid IN (6167865, 6077243, 6058560, 2147714, 2643743) ORDER BY geonameid");
    expect(q.rows).toEqual([
      { name: "Sydney", region: "NSW", region_name: "New South Wales", ascii_name: "Sydney" },
      { name: "London", region: "England", region_name: "England", ascii_name: "London" },
      { name: "L'Assomption", region: "QC", region_name: "Quebec", ascii_name: "L'Assomption" },
      { name: "Montréal", region: "QC", region_name: "Quebec", ascii_name: "Montreal" },
      { name: "Toronto", region: "ON", region_name: "Ontario", ascii_name: "Toronto" },
    ]);
    const ring = await db.query<{ name: string; region: string }>("SELECT name, region FROM public.metro_ring('Columbus', 'OH', 'US', 40, 20)");
    expect(ring.rows.map((r) => `${r.name}, ${r.region}`)).toEqual(expect.arrayContaining(["Columbus, OH", "Westerville, OH", "Dublin, OH", "Grove City, OH"]));
    expect(ring.rows.some((r) => r.region === "GA")).toBe(false);
    const montreal = await db.query<{ name: string }>("SELECT name FROM public.metro_ring('Montreal', 'QC', 'CA', 40, 20)");
    expect(montreal.rows.map((r) => r.name)).toEqual(["Montréal", "L'Assomption"]);
    await db.close();
  });

  it("the last chunk RAISEs when an earlier part did not apply", async () => {
    const many = Array.from({ length: 900 }, (_, i) => city(10_000_000 + i, `Place ${i}`, 10 + i / 100, 20, "DE", "16", 6000 + i)).join("\n");
    const chunks = buildSeed({ citiesText: `${CITIES}\n${many}`, admin1Text: ADMIN1, maxBytes: 40_000 }) as Chunk[];
    const db = await boot();
    await expect(db.exec(chunks[chunks.length - 1].sql)).rejects.toThrow(/an earlier part did not apply/);
    await db.close();
  });

  it("the last chunk RAISEs when the US is seeded but the Columbus, OH ring lacks Westerville", async () => {
    const withoutWesterville = CITIES.split("\n").filter((l) => !l.includes("Westerville")).join("\n");
    const chunks = buildSeed({ citiesText: withoutWesterville, admin1Text: ADMIN1, maxBytes: 22_000 }) as Chunk[];
    const db = await boot();
    let err = "";
    try { for (const c of chunks) await db.exec(c.sql); } catch (e) { err = String((e as Error).message); }
    expect(err).toMatch(/Columbus, OH ring does not hold Westerville/);
    await db.close();
    // Without the US in the seed there is no Columbus, OH ring to ask for.
    const noUs = buildSeed({ citiesText: CITIES, admin1Text: ADMIN1, countries: ["CA", "GB"], maxBytes: 22_000 }) as Chunk[];
    expect(noUs.reduce((a, c) => a + c.rows, 0)).toBe(5);
    expect(noUs[noUs.length - 1].sql).not.toMatch(/Westerville/);
  });

  it("fetches nothing: the script has no network call", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/match/build-geo-seed.mjs"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bfetch\s*\(|node:https?|require\(["']https?["']\)/);
  });
});
