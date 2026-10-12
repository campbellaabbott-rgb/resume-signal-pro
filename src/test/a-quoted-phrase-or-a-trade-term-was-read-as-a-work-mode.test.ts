import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { NEGATED_REMOTE_SOURCE } from "../../supabase/functions/job-board/normalize.ts";
import { liftTrailingPlace } from "../../supabase/functions/job-board/query-place.ts";
import { sanitizeTerm } from "../../supabase/functions/_shared/location-terms.ts";

/**
 * A QUOTED PHRASE, OR A TRADE TERM, WAS READ AS A WORK MODE (L8-06).
 *
 * "hybrid vehicle technician" lifted "hybrid" into a work-mode filter and
 * searched "vehicle technician" among hybrid roles: 6 rows (Records
 * Technician ...) against 104 for "vehicle technician". The quoted form was
 * lifted the same way, though the tip under the box says quotes match exact
 * phrases. "remote sensing analyst" served Data, Fraud and Finance Analysts.
 * There was no way to take a lift back.
 *
 * Now: nothing inside a balanced quoted pair is lifted; "remote" and "hybrid"
 * are not lifted as the first word of a trade term (sensing, pilot, patient,
 * monitoring, operated; vehicle, electric, car, cloud, powertrain, engine);
 * and a body carrying noIntent:true reads every word as search text (the
 * page's undo). The shipped functions are extracted from index.ts and run.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const lift = (() => {
  const pick = (re: RegExp, n: string) => { const m = re.exec(RAW)?.[0]; expect(m, `${n} has moved`).toBeTruthy(); return m!; };
  const src = [
    pick(/const INTENT_FILTERS: Array<[\s\S]*?\n\];/, "INTENT_FILTERS"),
    pick(/const INTENT_CONFLICTS: Record<string, string\[\]> = \{[\s\S]*?\n\};/, "INTENT_CONFLICTS"),
    pick(/const QUERY_FILLER = new Set\(\[[\s\S]*?\n\]\);/, "QUERY_FILLER"),
    pick(/function liftIntentFilters\([\s\S]*?\n\}/, "liftIntentFilters"),
    "return liftIntentFilters;",
  ].join("\n");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("NEGATED_REMOTE_SOURCE", "liftTrailingPlace", "sanitizeTerm", js)(NEGATED_REMOTE_SOURCE, liftTrailingPlace, sanitizeTerm) as (q: unknown, body: Record<string, unknown>) => { patch: Record<string, unknown>; labels: string[]; residualQ: string } | null;
})();

describe("a trade term keeps its first word", () => {
  it("hybrid vehicle, remote sensing and their kin are searched, not lifted", () => {
    for (const q of ["hybrid vehicle technician", "Hybrid Electric Vehicle Engineer", "remote sensing analyst", "remote pilot", "remote patient monitoring nurse", "hybrid cloud architect"]) {
      expect(lift(q, {}), q).toBeNull();
    }
  });

  it("the measured lifts stand: a work mode before a role is still a filter", () => {
    expect(lift("remote nurse", {})).toEqual({ patch: { workMode: "remote" }, labels: ["remote"], residualQ: "nurse" });
    expect(lift("hybrid data analyst", {})?.patch).toEqual({ workMode: "hybrid" });
    expect(lift("work from home customer service", {})?.residualQ).toBe("customer service");
  });
});

describe("a trailing place rides the same lift (.93)", () => {
  it("moves a known place into the location filter, names it, and yields to a location the caller set", () => {
    expect(lift("remote nurse jobs in Texas", {})).toEqual({ patch: { workMode: "remote", location: "Texas" }, labels: ["remote", "in Texas"], residualQ: "nurse jobs" });
    expect(lift("nurse jobs in Texas", { location: "Ohio" }), "the caller's own location wins").toBeNull();
    expect(lift("nurse jobs in Texas", { country: "US" })).toBeNull();
    expect(lift("nurse jobs in Texas", { noIntent: true }), "the undo reads every word as text").toBeNull();
    expect(lift('"engineer in Texas"', {}), "a quoted place is a phrase").toBeNull();
  });
});

describe("quotes mean exact", () => {
  it("nothing inside a quoted pair is lifted", () => {
    expect(lift('"hybrid vehicle technician"', {})).toBeNull();
    expect(lift('"work from home" coordinator', {})).toBeNull();
  });

  it("an unquoted lift beside a quoted phrase leaves the phrase byte for byte", () => {
    expect(lift('"remote" support remote', {})).toEqual({ patch: { workMode: "remote" }, labels: ["remote"], residualQ: '"remote" support' });
  });
});

describe("the undo", () => {
  it("noIntent:true reads every word as search text", () => {
    expect(lift("remote nurse", { noIntent: true })).toBeNull();
    expect(lift("part time barista", { noIntent: true })).toBeNull();
  });
});
