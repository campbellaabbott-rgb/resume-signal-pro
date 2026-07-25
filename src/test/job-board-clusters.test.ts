// Location-cluster collapsing (task #217).
//
// Measured on production 2026-07-25: `driver` returned ONE employer's role 13
// times in the first 40 rows (six Colorado towns, some repeated) and
// `project manager` returned the same Ramboll role 7 times across UK/Ireland —
// 30-35% of a results page spent on a single job. Each row is a genuine,
// separately-applyable ATS posting with its own apply URL, so the rows must be
// FOLDED for readability, never deleted.
//
// The risk this pins down is over-merging: a key that is too aggressive would
// hide genuinely different jobs at the same employer, which is worse than the
// problem it fixes.
import { describe, it, expect } from "vitest";
import { clusterKey } from "../../supabase/functions/job-board/descriptions";

describe("clusterKey — folds the same role, never different roles", () => {
  it("folds the same title across different locations", () => {
    const a = clusterKey("acme", "CDL-A Drivers needed for yard driver home DAILY! $28 HOURLY");
    const b = clusterKey("acme", "CDL-A Drivers needed for yard driver home DAILY! $28 HOURLY");
    expect(a).toBe(b);
  });

  it("folds location and requisition suffixes that ride along on the title", () => {
    const base = clusterKey("acme", "Registered Nurse");
    expect(clusterKey("acme", "Registered Nurse (Boston)")).toBe(base);
    expect(clusterKey("acme", "Registered Nurse [Remote]")).toBe(base);
    expect(clusterKey("acme", "Registered Nurse R12345")).toBe(base);
    expect(clusterKey("acme", "Registered Nurse #2025-031054")).toBe(base);
    expect(clusterKey("acme", "Registered   Nurse")).toBe(base);
    expect(clusterKey("acme", "registered nurse")).toBe(base);
  });

  it("NEVER folds different seniorities or different roles", () => {
    const nurse = clusterKey("acme", "Nurse");
    expect(clusterKey("acme", "Senior Nurse")).not.toBe(nurse);
    expect(clusterKey("acme", "Nurse Manager")).not.toBe(nurse);
    expect(clusterKey("acme", "Nurse Practitioner")).not.toBe(nurse);
    expect(clusterKey("acme", "Physician")).not.toBe(nurse);
  });

  it("NEVER folds across employers, however identical the title", () => {
    expect(clusterKey("acme", "Software Engineer")).not.toBe(clusterKey("globex", "Software Engineer"));
  });

  it("keeps distinct real-world titles distinct", () => {
    const seen = new Set([
      clusterKey("ramboll3", "German Speaking Principal Project Manager"),
      clusterKey("ramboll3", "Principal Project Manager"),
      clusterKey("ramboll3", "Project Manager"),
      clusterKey("ramboll3", "Associate Project Manager"),
    ]);
    expect(seen.size).toBe(4);
  });

  it("is stable for empty-ish input rather than throwing", () => {
    expect(typeof clusterKey("", "")).toBe("string");
    expect(clusterKey("acme", "")).toBe(clusterKey("acme", "   "));
  });
});
