// @vitest-environment node
/**
 * BR-08, index half (board .102): the description sweep fills a placeless
 * row's location from the vendor's detail ("3 Locations" becomes "Remote,
 * United States") and, in the same write, read the work mode from the STORED
 * location, the placeholder it was replacing. The mode was read from a place
 * the row no longer had, so a posting the vendor placed as remote stayed
 * unread. The sweep now reads the mode from the place it is writing.
 *
 * This runs the shipped lines (placeWrite, then the work-mode read) lifted
 * from index.ts, with the real normalize helpers.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { detectRegion, detectWorkMode, isPlacelessLocation } from "../../supabase/functions/job-board/normalize";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const pw = FN.indexOf("\nfunction placeWrite(");
const PLACE_WRITE = FN.slice(pw + 1, FN.indexOf("\n}\n", pw) + 2);
const line = (re: RegExp) => { const m = re.exec(FN); if (!m) throw new Error(`${re} moved in index.ts; re-point this test`); return m[0]; };
const PATCH = line(/const placePatch = placeWrite\(row, vCountry, vLocation, additionalSites\);/);
const WM = line(/const wm = wmVendor \?\? \(row\.work_mode \? null : detectWorkMode\([^\n]*\);/);

type Row = { location: string | null; country: string | null; work_mode: string | null; title: string | null };
const sweep = new Function("detectRegion", "detectWorkMode", "isPlacelessLocation",
  ts.transpileModule(`${PLACE_WRITE}\nreturn (row, vCountry, vLocation, additionalSites, wmVendor) => { ${PATCH}\n${WM}\nreturn { placePatch, wm }; };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
)(detectRegion, detectWorkMode, isPlacelessLocation) as (row: Row, vCountry: string | null, vLocation: string | null, additionalSites: number, wmVendor: string | null) =>
  { placePatch: Record<string, unknown>; wm: string | null };

describe("a sweep reads the mode from the place it just wrote", () => {
  it("a placeless row the vendor places as remote is written remote in the same sweep", () => {
    const r = sweep({ location: "3 Locations", country: null, work_mode: null, title: "Data Engineer" }, "US", "Remote, United States", 0, null);
    expect(r.placePatch.location).toBe("Remote, United States");
    expect(r.wm).toBe("remote");
  });

  it("an empty stored location is read through the place the sweep writes", () => {
    expect(sweep({ location: null, country: null, work_mode: null, title: "Analyst" }, null, "Hybrid - London", 0, null).wm).toBe("hybrid");
  });

  it("a row that keeps its own place is read from that place, and the vendor's stated mode still wins", () => {
    expect(sweep({ location: "Remote", country: "US", work_mode: null, title: "Analyst" }, "US", "Austin, TX", 0, null).wm).toBe("remote");
    expect(sweep({ location: "3 Locations", country: null, work_mode: null, title: "Analyst" }, null, "Remote, United States", 0, "onsite").wm).toBe("onsite");
  });

  it("a row with a stored mode is not read again", () => {
    expect(sweep({ location: "3 Locations", country: null, work_mode: "onsite", title: "Analyst" }, null, "Remote", 0, null).wm).toBeNull();
  });
});
