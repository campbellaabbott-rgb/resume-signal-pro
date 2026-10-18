// @vitest-environment node
/**
 * THE HEARTBEAT COUNTS THE SCANS THE HOURLY CEILING REFUSED (wave 4 round 2
 * review, coverage lens; S12-142's alarm half).
 *
 * WHAT WAS WRONG. free-keyword-scan records a refused hour on the scan's
 * metric (metadata.ceilingRefused) "for an absolute alarm to count", and no
 * code read it: a day of visitors getting the rule-based report was
 * invisible to the owner.
 *
 * WHAT HOLDS NOW.
 *   - ceilingRefusalCheck fails above CEILING_REFUSALS_ALARM refused scans in
 *     an hour, passes at or under, and says nothing without a count;
 *   - scan-heartbeat runs it over the last hour's scan_metrics rows whose
 *     metadata->>ceilingRefused is set, the key the scanner writes, and a
 *     failure makes the run degraded.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CEILING_REFUSALS_ALARM, ceilingRefusalCheck } from "../../supabase/functions/scan-heartbeat/watch";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("the ceiling alarm", () => {
  it("fails above the alarm, passes at or under it, and says nothing without a count", () => {
    expect(ceilingRefusalCheck(CEILING_REFUSALS_ALARM + 1)).toMatchObject({ passed: false });
    expect(ceilingRefusalCheck(CEILING_REFUSALS_ALARM + 1)?.error).toMatch(/hourly ceiling/);
    expect(ceilingRefusalCheck(CEILING_REFUSALS_ALARM)).toEqual({ passed: true });
    expect(ceilingRefusalCheck(0)).toEqual({ passed: true });
    expect(ceilingRefusalCheck(null)).toBeNull();
  });

  it("the heartbeat counts the key the scanner writes, over the last hour, and degrades on a failure", () => {
    const hb = read("supabase/functions/scan-heartbeat/index.ts");
    const block = hb.slice(hb.indexOf("Check 2e"), hb.indexOf("Check 3: Cache system"));
    expect(block).toMatch(/from\('scan_metrics'\)/);
    expect(block).toMatch(/\.not\('metadata->>ceilingRefused', 'is', null\)/);
    expect(block).toMatch(/Date\.now\(\) - 3600_000/);
    expect(block).toMatch(/ceilingRefusalCheck\(count\)/);
    expect(block).toMatch(/overallStatus = 'degraded'/);
    expect(read("supabase/functions/free-keyword-scan/index.ts")).toMatch(/ceilingRefused: hourCeiling \? hourCeiling\.code : null/);
  });
});
