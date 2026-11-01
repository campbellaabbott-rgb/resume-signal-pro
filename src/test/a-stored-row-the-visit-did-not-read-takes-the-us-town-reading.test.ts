// @vitest-environment node
/**
 * A STORED ROW THE VISIT DID NOT READ STILL TAKES THE US-TOWN READING
 * (job-board 2026-09-09.98).
 *
 * Trust round 3 (COUNTRY_MAP_VERSION 12) reads "NY - Greece", "FL - Lake Wales"
 * and "Store0006 Greece NY" as US towns. A stored row took that reading only
 * when a list visit READ it, and a Workday visit reads 250 postings of its
 * feed from a cursor (MAX_POSTINGS_PER_VISIT): a feed is re-read over a lap.
 * Live on .96, five hours after its first slice: J.B. Hunt's two Lake Wales
 * rows at feed positions 119 and 234 were still GB while its row at 281 (the
 * window read since) was US; CVS Health's four "NY - Greece" rows were GR on a
 * 19,143-posting feed, a lap of 77 visits. The backfill sweep the map version
 * kicks fills rows with NO country only. So the visit now re-files every
 * stored row of the board it holds, read or not, where the stored country is
 * the foreign reading of one of the words the map moved and the location now
 * reads US (townRefilePatches, n1399).
 *
 * CORPUS-FIRST. The fixture is every distinct (location, stored country,
 * vendor) triple of 45 live location searches on 2026-10-31
 * (src/test/fixtures/stored-country-refile/live-rows-2026-10-31.json; 1,917
 * triples, 1,536 strings): US towns named after countries or regions (Greece
 * NY, Lake Wales FL, Peru IN/IL, North Wales PA, Georgia, Jersey City,
 * Lebanon, Mexico, Poland, Norway, Holland, Denmark, Brazil, Jordan, Dublin,
 * Paris, Athens, Naples, Florence, Toledo ...) and the real places abroad
 * (Cardiff, Athens, Lima, Istanbul, Tbilisi, Beirut, Warsaw, Oslo ...). The
 * re-file fires on exactly the six misfiled strings below, each one main's
 * own reader already files US on the row's next read: the outcome is main's,
 * a lap sooner, and every other row is left exactly as stored.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectCountry, detectRegion, townCountryRefile, townRefilePatches } from "../../supabase/functions/job-board/normalize";
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";
import { codeOf } from "./helpers/strip-comments";

const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/stored-country-refile/live-rows-2026-10-31.json"), "utf8")) as {
  basis: string;
  rows: Array<[string, string | null, string]>;
};

/** The misfiled rows the re-file moves, each with the state its reader reads in the string, where it reads one. */
const REFILED: Record<string, { stored: string; why: string }> = {
  "601095 Greece, NY - West Ridge Road": { stored: "GR", why: "Panera Bread, the string names New York" },
  "606371 Lake Wales, FL - US Highway 27": { stored: "GB", why: "Panera Bread, the string names Florida" },
  "FL - Lake Wales": { stored: "GB", why: "CVS Health, the string names Florida" },
  "Lake Wales, FL - 1900 Old Bartow Rd": { stored: "GB", why: "J.B. Hunt, the string names Florida" },
  "NY - Greece": { stored: "GR", why: "CVS Health R1075322 and three more, Workday alpha2Code US" },
  "Store0006 Greece NY": { stored: "GR", why: "Dick's Sporting Goods 202641368, Workday alpha2Code US; no state the reader reads, so the country only" },
};

describe("the corpus: the re-file moves only the misfiled US towns, and only to main's own reading", () => {
  it("holds the real rows it was measured on: towns named after places abroad, and the places", () => {
    expect(CORPUS.basis).toMatch(/45 location searches/);
    expect(new Set(CORPUS.rows.map(([l]) => l)).size).toBeGreaterThanOrEqual(300);
    const has = (re: RegExp, country: string) => CORPUS.rows.some(([l, c]) => re.test(l) && c === country);
    for (const [re, c] of [
      [/Greece,? NY|NY - Greece/, "US"], [/Lake Wales/, "US"], [/Peru,? ?(?:IN|IL)\b/, "US"], [/North Wales/, "US"],
      [/Jersey City/, "US"], [/Lebanon, (?:PA|VA)/, "US"], [/New Mexico/, "US"], [/Athens, GA/, "US"], [/Lima Road/, "US"], [/Georgia/, "US"],
      [/Cardiff/, "GB"], [/Athens/, "GR"], [/Lima/, "PE"], [/Istanbul/, "TR"], [/Tbilisi/, "GE"],
      [/Beirut/, "LB"], [/Warsaw/, "PL"], [/Oslo/, "NO"], [/Mexico/, "MX"], [/North Wales/, "GB"], [/New South Wales/, "AU"],
    ] as Array<[RegExp, string]>) expect(has(re, c), `${re} filed ${c}`).toBe(true);
  });

  it("fires on exactly the measured misfiled strings, never on any other row", () => {
    const fired = new Map<string, string>();
    for (const [loc, stored] of CORPUS.rows) {
      const c = townCountryRefile(loc, stored);
      if (c !== null) fired.set(loc, `${stored}->${c}`);
    }
    expect(Object.fromEntries(fired)).toEqual(Object.fromEntries(Object.entries(REFILED).map(([l, r]) => [l, `${r.stored}->US`])));
  });

  it("never worse than main: every move is to the country main's reader gives the same string on its next read", () => {
    for (const loc of Object.keys(REFILED)) expect(detectCountry(loc), loc).toBe("US");
    // And the re-file is narrower than main's reader: these rows' vendors state
    // a country that reader would overwrite, and the re-file leaves each alone.
    const vendorStated = CORPUS.rows.filter(([l, c]) => { const d = detectCountry(l); return d !== null && c !== null && d !== c && !(l in REFILED); });
    expect(vendorStated.length, "the corpus no longer shows why the re-file is narrow").toBeGreaterThan(10);
    for (const [l, c] of vendorStated) expect(townCountryRefile(l, c), `${l} stored ${c}`).toBeNull();
    for (const [l, c] of [["North Wales, Pennsylvania", "US"], ["DUBLIN, Georgia", "US"], ["Peru, Illinois", "US"], ["Brazil, Indiana", "US"]]) {
      expect(CORPUS.rows.some(([x, y]) => x === l && y === c), `${l} is in the corpus filed ${c}`).toBe(true);
      expect(townCountryRefile(l, c), l).toBeNull();
    }
  });

  it("the places abroad keep their countries, and a row filed US or nowhere is never touched", () => {
    for (const [l, c] of [["Cardiff, Wales", "GB"], ["Athens, Greece", "GR"], ["Lima, Peru", "PE"], ["Istanbul, Turkey", "TR"], ["Sydney, New South Wales", "AU"], ["Turkey - Istanbul", "TR"], ["GR - Greece", "GR"], ["Peru", "PE"]]) {
      expect(townCountryRefile(l, c), l).toBeNull();
    }
    expect(townCountryRefile("NY - Greece", "US")).toBeNull();
    expect(townCountryRefile("NY - Greece", null)).toBeNull();
    expect(townCountryRefile(null, "GR")).toBeNull();
    // The word must be the one whose country is stored: a Greece row filed GB is not this rule's.
    expect(townCountryRefile("NY - Greece", "GB")).toBeNull();
    // Strings main's reader still files abroad stay as they are (a later round's: the state spelled out, or a ZIP after it).
    for (const [l, c] of [["Storm Lake Turkey Plant - Storm Lake, Iowa", "TR"], ["Turkey TX 79261", "TR"], ["North Wales, Pennsylvania", "GB"]]) {
      expect(CORPUS.rows.some(([x, y]) => x === l && y === c), `${l} is in the corpus filed ${c}`).toBe(true);
      expect(townCountryRefile(l, c), l).toBeNull();
    }
  });
});

describe("townRefilePatches: the board's stored rows the visit did not read", () => {
  type R = { id: string; location: string | null; country: string | null; region_code?: string | null };
  const rows: R[] = [
    { id: "workday:cvshealth~wd1~CVS_Health_Careers:R1075322", location: "NY - Greece", country: "GR", region_code: null },
    { id: "workday:cvshealth~wd1~CVS_Health_Careers:R1086454", location: "FL - Lake Wales", country: "GB", region_code: null },
    { id: "workday:cvshealth~wd1~CVS_Health_Careers:R1", location: "Athens, Greece", country: "GR", region_code: null },
    { id: "workday:cvshealth~wd1~CVS_Health_Careers:R2", location: "Greece, NY", country: "US", region_code: "NY" },
    { id: "workday:cvshealth~wd1~CVS_Health_Careers:R3", location: "NY - Greece", country: "GR", region_code: null },
  ];

  it("re-files each unread misfiled row with its state, and leaves read rows to the visit's own patch", () => {
    const read = new Set(["workday:cvshealth~wd1~CVS_Health_Careers:R3"]);
    const out = townRefilePatches(rows, read, "workday", true);
    expect(out).toEqual([
      { id: "workday:cvshealth~wd1~CVS_Health_Careers:R1075322", country: "US", region_code: detectRegion("NY - Greece", "US") },
      { id: "workday:cvshealth~wd1~CVS_Health_Careers:R1086454", country: "US", region_code: detectRegion("FL - Lake Wales", "US") },
    ]);
    expect(detectRegion("NY - Greece", "US"), "the region is the state the string names").toBe("US-NY");
    expect(detectRegion("FL - Lake Wales", "US")).toBe("US-FL");
  });

  it("writes no region while the column is unknown, and none that is already stored", () => {
    expect(townRefilePatches(rows.slice(0, 1), new Set(), "workday", false)).toEqual([{ id: rows[0].id, country: "US" }]);
    expect(townRefilePatches([{ ...rows[0], region_code: "US-NY" }], new Set(), "workday", true)).toEqual([{ id: rows[0].id, country: "US" }]);
  });

  it("writes no region where the reader reads no state in the string: Store0006 Greece NY gets the country only, as main's reader gives it", () => {
    const store = { id: "workday:dickssportinggoods~wd1~DSG:202641368", location: "Store0006 Greece NY", country: "GR", region_code: null };
    expect(detectRegion("Store0006 Greece NY", "US"), "main's reader writes no region for it either").toBeNull();
    expect(townRefilePatches([store], new Set(), "workday", true)).toEqual([{ id: store.id, country: "US" }]);
    // The other five measured strings each get the state the reader reads.
    const regions = Object.keys(REFILED).filter((s) => s !== "Store0006 Greece NY").map((s) => detectRegion(s, "US"));
    expect(regions).toEqual(["US-NY", "US-FL", "US-FL", "US-FL", "US-NY"]);
  });

  it("touches only the visited vendor's rows: a shared token's twin is its own board's", () => {
    const twin = { id: "greenhouse:cvshealth~wd1~CVS_Health_Careers:9", location: "NY - Greece", country: "GR", region_code: null };
    expect(townRefilePatches([twin], new Set(), "workday", true)).toEqual([]);
    expect(townRefilePatches([twin], new Set(), "greenhouse", true).map((p) => p.id)).toEqual([twin.id]);
  });

  it("is idempotent: once re-filed, a row yields nothing on the next visit", () => {
    const after = rows.map((r) => ({ ...r, ...(townRefilePatches([r], new Set(), "workday", true)[0] ?? {}) }));
    expect(townRefilePatches(after, new Set(), "workday", true)).toEqual([]);
  });

  // The pay columns follow the country (n1393), and once the row reads US a later
  // visit sees no country move, so the re-file is the only chance to re-read them.
  it("re-reads the stored pay as US where the country changed its reading, and leaves it where it did not", () => {
    const TOWN: Record<string, string> = { GR: "NY - Greece", PE: "IN - Peru", TR: "TX - Turkey", GB: "FL - Lake Wales" };
    const at = (salary: string, country = "GR") => townRefilePatches([{ ...rows[0], location: TOWN[country], country, title: "Pharmacy Technician", salary }], new Set(), "workday", false)[0];
    const us = parseSalaryStructured("17.500 - 22.750 per hour", "US", { title: "Pharmacy Technician", description: null })!;
    expect(parseSalaryStructured("17.500 - 22.750 per hour", "GR", { title: "Pharmacy Technician", description: null })?.annualMin, "filed GR, the rate read as thousands").toBeNull();
    expect(at("17.500 - 22.750 per hour")).toEqual({ id: rows[0].id, country: "US", salary_min_annual: us.annualMin, salary_max_annual: us.annualMax, salary_period: "hour", salary_currency: null });
    expect(us.annualMin).toBe(36_400);
    for (const pay of ["$60.00 - $76.00", "$18.50 - $22.00 per hour", "$45,000 - $55,000", "$17/hr", "$17.500 - $22.750 per hour"]) {
      for (const c of ["GR", "PE", "TR", "GB"]) expect(at(pay, c), `${pay} filed ${c}`).toEqual({ id: rows[0].id, country: "US" });
    }
    expect(at("  ")).toEqual({ id: rows[0].id, country: "US" });
  });
});

describe("the visit applies it", () => {
  const IDX = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8"));
  const NORM = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/normalize.ts"), "utf8"));

  it("after the read rows' own patches and before the caps, as corrections with their marks", () => {
    const call = IDX.indexOf("townRefilePatches(existingRows, rowsById, s.source, !regionColUnknown)");
    expect(call, "index.ts does not call townRefilePatches over the board's stored rows").toBeGreaterThan(0);
    const readLoop = IDX.indexOf("for (const [id, row] of rowsById)");
    const cap = IDX.indexOf("if (changeCapAt >= 0)", readLoop);
    expect(readLoop).toBeGreaterThan(0);
    expect(call, "the re-file must follow the read rows' patches, so the cap keeps theirs first").toBeGreaterThan(readLoop);
    expect(call, "the re-file must queue before the caps cut the corrections").toBeLessThan(cap);
    const body = IDX.slice(call, cap);
    expect(body).toMatch(/corrections\.push\(/);
    expect(body).toMatch(/changeMarks\.push\(changeLog\.length\)/);
  });

  it("re-files exactly the words the map reads as US towns", () => {
    // P_COUNTRY_WORD_US_TOWN's words and the GB pattern's Lake Wales: each has its foreign country here.
    const town = /const P_COUNTRY_WORD_US_TOWN = \/(.*)\/i;/.exec(NORM)?.[1] ?? "";
    const words = new Set([...town.matchAll(/\(\?:([a-z |]+)\)/g)].flatMap((m) => m[1].split("|")));
    expect([...words].sort()).toEqual(["greece", "lake wales", "peru", "turkey"]);
    for (const [w, c] of [["greece", "GR"], ["lake wales", "GB"], ["peru", "PE"], ["turkey", "TR"]]) {
      const s = w === "lake wales" ? "FL - Lake Wales" : `NY - ${w[0].toUpperCase()}${w.slice(1)}`;
      expect(townCountryRefile(s, c), `${w} -> ${c}`).toBe("US");
    }
  });
});
