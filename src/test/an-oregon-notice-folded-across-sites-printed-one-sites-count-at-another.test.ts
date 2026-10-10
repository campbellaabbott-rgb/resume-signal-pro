// @vitest-environment node
/**
 * AN OREGON NOTICE FOLDED ACROSS SITES PRINTED ONE SITE'S COUNT AT ANOTHER
 * (review of sweep S8-106, 2026-10-10).
 *
 * The S8-106 fix folded every line sharing a WARN# into the first line,
 * keeping only that line's site. Oregon splits a notice by site as well as by
 * phase: WARN# 9556 is 105 positions in New York plus one Oregon remote worker
 * and read "106 positions at New York, NY"; 9509 is six lines at five sites
 * and read as 160 positions at Portland. The card's sentence is "N positions
 * at SITE" against a single-site bar, so lines fold only where their Location
 * agrees. "Company - Site" filers ("Amentum - Hillsboro, OR") match on the
 * company. The map also claimed verifiedAgainstSample with no saved copy of
 * the file; this test reads the one saved on 2026-10-10.
 *
 * Facility-named filers ("Medford Delivery Facility", "Portland Truck
 * Manufacturing Facility") get their counts but still match no board: that
 * needs a facility-to-employer alias, which nothing here invents.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapTable, tableFromCsv } from "../../supabase/functions/layoff-filings/warn";
import { OR } from "../../supabase/functions/layoff-filings/warn-maps/or";

const csv = readFileSync(resolve(__dirname, "../../scripts/data/layoff-samples/bln-raw-or.csv"), "utf8");
const mapped = mapTable(OR, tableFromCsv(csv, OR), "bln_raw");
const records = mapped.ok ? mapped.records : [];
const named = (filer: string) => records.filter((r) => r.filerRaw === filer);

describe("Oregon's saved file, read by its map", () => {
  it("the map recognises the saved header and reads a count from every line that states one", () => {
    expect(mapped.ok, mapped.ok === false ? mapped.reason : "").toBe(true);
    expect(records.filter((r) => r.workers != null).length).toBeGreaterThan(1000);
  });

  it("a notice split across sites stays one count per site", () => {
    const jenius = named("JeniusBank");
    expect(jenius.length).toBe(1);
    expect(jenius[0].workers, "an Oregon remote worker was counted at New York").toBe(105);
    expect(jenius[0].siteRaw).toBe("New York, NY");
    const portland = records.filter((r) => r.filerRaw === "Portland Facility" && r.visibleDate === "2026-05-18");
    expect(portland.map((r) => r.workers), "five sites of WARN# 9509 were printed as one Portland count").toEqual([102]);
    expect(named("Bend Depot Facility").map((r) => r.workers)).toContain(10);
  });

  it("positive control: the phases of one notice at one site still fold", () => {
    const tualatin = named("Tualatin Oregon Facility");
    expect(tualatin.length).toBe(1);
    expect(tualatin[0].workers).toBe(87);
  });

  it("a filer written as Company - Site matches on the company and keeps its verbatim name", () => {
    const amentum = named("Amentum - Hillsboro, OR");
    expect(amentum.length).toBe(1);
    expect(amentum[0].filerForNorm).toBe("Amentum");
    expect(amentum[0].workers).toBe(74);
  });
});
