// @vitest-environment node
/**
 * A CHROME-PRINTED RÉSUMÉ STILL HAS BULLETS (bug round S14X-122, M-S14-095).
 *
 * A résumé printed to PDF from Chrome loses its list glyphs: the text comes
 * through as plain lines. The tone audit and the competitor silhouette
 * counted only lines that began with a bullet mark, so such a résumé got
 * "0 active bullets", while parseResumeSections already held every
 * achievement line under its role. Both now count those lines too.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { loadScanners, resetWorld, scanPrimary } from "./helpers/free-scan-world";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

/** Three roles of four achievement lines each, with no bullet glyph anywhere. */
const PRINTED = [
  "Priya Shah | priya.shah@example.com | (312) 555-0187 | Chicago, IL",
  "SUMMARY",
  "Operations leader with ten years in distribution and fulfilment.",
  "EXPERIENCE",
  "Operations Manager, Lakeside Distribution, Jan 2021 - Present",
  "Cut order cycle time by 22% by redesigning the pick path",
  "Hired and trained 18 associates across two shifts",
  "Reduced shrink by $140,000 a year through cycle counts",
  "Launched a returns line that cleared a 9-day backlog",
  "Assistant Operations Manager, Harbor Freight Hub, Mar 2017 - Dec 2020",
  "Scheduled 60 drivers a week with a new rota tool",
  "Improved on-time dispatch from 88% to 97% in a year",
  "Negotiated carrier rates that saved $75,000 annually",
  "Built the first safety audit, closing 31 findings",
  "Shift Supervisor, Midway Fulfilment, Jun 2014 - Feb 2017",
  "Coached 12 pickers to meet a 140-units-an-hour target",
  "Organised peak staffing for three holiday seasons",
  "Streamlined receiving, cutting dock time by 30 minutes",
  "Introduced daily huddles that lowered absences by 15%",
  "EDUCATION",
  "BA Business Administration, DePaul University, 2014",
  "SKILLS",
  "WMS, Excel, labour planning, carrier management, safety audits",
].join("\n");

describe("the tone audit counts the achievement lines a printed PDF keeps", () => {
  let primary: EdgeHandler;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => { ({ primary } = await loadScanners(["primary"])); }, 240_000);
  beforeEach(() => {
    resetWorld();
    for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

  it("twelve achievement lines are twelve bullets, and their active verbs count", async () => {
    const { json } = await scanPrimary(primary, { resumeText: PRINTED });
    const tone = json.toneAudit as { bulletCount: number; activeCount: number; passiveRatio: number; verdict: string };
    expect(tone.bulletCount).toBe(12);
    expect(tone.activeCount).toBeGreaterThan(0);
    expect(tone.verdict).toBe("active");
  });
});
