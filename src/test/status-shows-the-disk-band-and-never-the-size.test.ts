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
import { execFileSync } from "node:child_process";
import { FN } from "./helpers/lift-index";
import { dbBandOf, MAX_WAL_BOUND_BYTES } from "../../supabase/functions/job-board/disk-band";

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

  it("is null with no reading, a reading without its size, or one it cannot date", () => {
    expect(dbBandOf(null)).toBeNull();
    expect(dbBandOf({ at, top: [] })).toBeNull();
    expect(dbBandOf({ ...head(20, 1), at: "yesterday" })).toBeNull();
    expect(dbBandOf({ at, db_bytes: "n/a", wal_bytes: 0 })).toBeNull();
  });

  it("bands a reading without its WAL figure with the max_wal_size bound (spec §3.1, §7 C-D6), the stamp's own or Supabase's 1 GB", () => {
    expect(MAX_WAL_BOUND_BYTES).toBe(1024 ** 3);
    expect(dbBandOf(head(26.2, null))).toEqual({ band: "28-32", at }); // 26.2 + 1.074 + 0.73 = 28.004
    expect(dbBandOf(head(26.1, null))).toEqual({ band: "<28", at }); // 27.904
    expect(dbBandOf({ ...head(26.1, null), max_wal_bytes: 4 * 1024 ** 3 })).toEqual({ band: "28-32", at });
  });

  // cost2's 20261115110000 as built stamps jsonb_build_object('at', now(), 'db_bytes', pg_database_size(...), 'top', ...)
  // and no WAL figure: the band must still read, or DS1 FAILs forever once that ring starts.
  const COST2_ENTRY = { at: "2026-11-18T11:11:00.123456+00:00", db_bytes: 26_512_345_678, top: [{ rel: "public.job_board_postings", bytes: 19_000_000_000 }] };
  it("reads the ring entry cost2's migration writes", () => {
    expect(dbBandOf(COST2_ENTRY)).toEqual({ band: "28-32", at: COST2_ENTRY.at });
  });
  const cost2 = (() => {
    try { return execFileSync("git", ["show", "cost2/db:supabase/migrations/20261115110000_the_database_size_is_written_down_once_a_night.sql"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
  })();
  it.skipIf(cost2 === null)("cost2/db's migration (when this checkout has the branch) stamps exactly the keys that entry carries, or adds wal_bytes", () => {
    const build = /SELECT jsonb_build_object\(([\s\S]*?)\)\s*INTO v_entry/.exec(cost2 ?? "")?.[1] ?? "";
    const keys = [...build.matchAll(/^\s*'([a-z_]+)',/gm)].map((m) => m[1]);
    expect(keys.slice(0, 2)).toEqual(["at", "db_bytes"]);
    expect(keys.filter((k) => !["at", "db_bytes", "top", "wal_bytes", "max_wal_bytes", "walIsBound"].includes(k))).toEqual([]);
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
