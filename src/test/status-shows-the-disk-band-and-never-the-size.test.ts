// @vitest-environment node
/**
 * Board .103 (spec §3.1 and §7, T-20): STATUS SHOWS THE DISK BAND AND NEVER
 * THE SIZE.
 *
 * The add gate reads Lovable's "used" figure as (db_bytes + wal_bytes) / 1e9
 * + 0.73 GB from cost2's nightly ring, and DS1 fails when status carries no
 * band 26 hours after that ring starts. Status gains dbBand {band, at}, from
 * the ring's newest stamp alone; the size stays in the service-only ring.
 */
import { describe, expect, it } from "vitest";
import { FN } from "./helpers/lift-index";
import { dbBandOf } from "../../supabase/functions/job-board/disk-band";

const at = "2026-11-18T11:11:00.000Z";
const GB = 1e9;
const head = (dbGb: number, walGb: number | null) => ({ at, db_bytes: dbGb * GB, ...(walGb === null ? {} : { wal_bytes: walGb * GB }), top: [{ rel: "public.job_board_postings", bytes: 1 }] });

describe("the band", () => {
  it("falls where the reading does, with the 0.73 GB offset and the WAL counted", () => {
    expect(dbBandOf(head(26, 1))).toEqual({ band: "<28", at }); // 27.73
    expect(dbBandOf(head(26.3, 1))).toEqual({ band: "28-32", at }); // 28.03
    expect(dbBandOf(head(30.3, 1))).toEqual({ band: "32-34", at }); // 32.03
    expect(dbBandOf(head(32.3, 1))).toEqual({ band: "≥34", at }); // 34.03
    expect(dbBandOf(head(27.2, 0.1))).toEqual({ band: "28-32", at }); // 28.03: the WAL alone tips it
  });

  it("is null with no reading, a reading without its WAL figure, or one it cannot date", () => {
    expect(dbBandOf(null)).toBeNull();
    expect(dbBandOf(head(20, null))).toBeNull();
    expect(dbBandOf({ ...head(20, 1), at: "yesterday" })).toBeNull();
    expect(dbBandOf({ at, db_bytes: "n/a", wal_bytes: 0 })).toBeNull();
  });

  it("names the band and the time only, never a byte count", () => {
    expect(Object.keys(dbBandOf(head(20, 1))!).sort()).toEqual(["at", "band"]);
  });
});

describe("status", () => {
  const status = FN().slice(FN().indexOf('if (action === "status") {'), FN().indexOf('if (action === "vendor-health") {'));
  it("reads the ring's newest stamp alone, not the ring", () => {
    expect(status).toMatch(/\.select\("head:v->entries->0"\)\.eq\("k", "storage_size_ring"\)\.maybeSingle\(\)/);
    expect(status).not.toMatch(/\.select\("v[^"]*"\)\.eq\("k", "storage_size_ring"\)/);
  });
  it("answers dbBand from it", () => {
    expect(status).toMatch(/dbBand: dbBandOf\(\(\(await ringRead\) as \{ data\?: \{ head\?: unknown \} \} \| null\)\?\.data\?\.head\),/);
  });
});
