import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * STATUS ANSWERED A BARE 500 WHILE THE BOARD WAS PERFECTLY HEALTHY.
 *
 * 2026-09-01. Every serving path was fine — search, faceted list, counts and
 * vendor filters all returned normally, and the site rendered 819,374 openings
 * — but `action: "status"` threw. It gathers ~30 reads plus post-processing
 * under one try, so anything that throws takes the whole answer, and the
 * generic outer catch replaced the reason with "Job board temporarily
 * unavailable".
 *
 * Two things were wrong with that, and only the second is about uptime:
 *
 *   1. This endpoint's PRIMARY job is answering "did my deploy land?" — the
 *      heartbeat's deploy check reads it, and so does a human after every
 *      publish. That answer is a CONSTANT baked into the bundle. It needs no
 *      database, and it should never be lost to a slow rollup or a bad meta
 *      row.
 *   2. The one endpoint built for diagnosis became undiagnosable. A caller
 *      learned only that something broke, in the place whose entire purpose is
 *      explaining what broke.
 *
 * So the deploy identity is answered from constants, and a failure below
 * degrades to that skeleton plus the reason, at 200. Degrading loudly beats
 * failing silently for an endpoint nobody's users depend on.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
const STATUS = (() => {
  const i = FN.indexOf('if (action === "status")');
  const j = FN.indexOf('if (action === "vendor-health")', i);
  return i >= 0 && j > i ? FN.slice(i, j) : "";
})();

describe("the endpoint that explains outages must not be silent", () => {
  it("has its own catch, so a bad read cannot reach the generic one", () => {
    expect(STATUS, "the status block could not be located").not.toBe("");
    expect(STATUS).toMatch(/\} catch \(statusErr\) \{/);
  });

  it("still names the deployed bundle when everything else fails", () => {
    // The question this endpoint exists to answer is a constant in this file.
    // Losing it to a database problem is the failure that made the outage
    // undiagnosable.
    const tail = STATUS.slice(STATUS.indexOf("} catch (statusErr) {"));
    expect(tail).toMatch(/version: BUILD_VERSION/);
    expect(tail).toMatch(/catalogSize: JOB_SOURCES\.length/);
  });

  it("says WHY it degraded, and says so at 200", () => {
    const tail = STATUS.slice(STATUS.indexOf("} catch (statusErr) {"));
    expect(tail).toMatch(/statusDegraded: true/);
    expect(tail).toMatch(/statusError: String\(/);
    // json() defaults to 200; a status argument here would re-hide the answer
    // behind the error code that started this.
    expect(tail, "the degraded answer must not be served as an error code").not.toMatch(/\}, 5\d\d\)/);
  });

  it("marks the healthy answer too, so a consumer can tell them apart", () => {
    // Absent-vs-false is exactly the ambiguity that makes a flag useless when
    // an old bundle is still serving.
    expect(STATUS).toMatch(/statusDegraded: false/);
  });
});
