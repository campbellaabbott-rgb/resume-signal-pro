// @vitest-environment node
/**
 * A COUNTRY PAGE LENGTH IS THE LENGTH THE SCAN JUDGES (bug round S14X-028,
 * M-S14-029).
 *
 * Each market's standard said its own length ("2 pages standard" for the UK,
 * "1-2 pages, tabular" for Germany), the system prompt told the model one
 * worldwide rule (1 page under 5 years, 2 to 15, 3 past it), and the page
 * verdict trusted the model's recommendation. So a two-page UK CV from four
 * years of work was "too long" against the norm the same report printed.
 *
 * Now every standard carries numeric bounds, the user prompt states the
 * market's own rule, and the server reads the verdict from the bounds.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { ANALYSIS, gatewayAnswering, loadScanners, resetWorld, scanPrimary, world } from "./helpers/free-scan-world";
import { COUNTRY_STANDARDS, lengthRuleForPrompt, pageVerdictFor } from "../../supabase/functions/free-keyword-scan/country-standards";
import { COUNTRY_STANDARDS as STREAM_STANDARDS } from "../../supabase/functions/free-keyword-scan-stream/country-standards";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

describe("every market's length is a number the server can judge", () => {
  it("each standard, in both copies, has whole-page bounds with pagesMin <= pagesMax", () => {
    for (const table of [COUNTRY_STANDARDS, STREAM_STANDARDS]) {
      for (const [code, std] of Object.entries(table)) {
        expect(Number.isInteger(std.pagesMin), code).toBe(true);
        expect(Number.isInteger(std.pagesMax), code).toBe(true);
        expect(std.pagesMin, code).toBeGreaterThanOrEqual(1);
        expect(std.pagesMin, code).toBeLessThanOrEqual(std.pagesMax);
      }
    }
  });

  it("the verdict is read from the bounds", () => {
    const gb = COUNTRY_STANDARDS.GB;
    expect(gb.pagesMax).toBeGreaterThanOrEqual(2);
    expect(pageVerdictFor(2, gb)).toBe("just_right");
    expect(pageVerdictFor(gb.pagesMax + 1, gb)).toBe("too_long");
  });

  it("the prompt's rule is the market's own note and bounds", () => {
    const rule = lengthRuleForPrompt(COUNTRY_STANDARDS.DE);
    expect(rule).toContain(COUNTRY_STANDARDS.DE.lengthNote);
    expect(rule).toContain(`${COUNTRY_STANDARDS.DE.pagesMin}-${COUNTRY_STANDARDS.DE.pagesMax}`);
  });
});

describe("the primary judges the length the market sets", () => {
  let primary: EdgeHandler;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => { ({ primary } = await loadScanners(["primary"])); }, 240_000);
  beforeEach(() => {
    resetWorld();
    for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

  // About 800 words: two pages of text from four years of work.
  const achievements = (role: string, n: number) => Array.from({ length: n }, (_, i) =>
    `- ${role}: delivered workstream ${i + 1} of the regional programme, coordinating suppliers, finance and site teams to agree scope, budget and handover dates, and reported weekly progress to the steering group`);
  const GB_CV = [
    "Alex Morgan | alex.morgan@example.co.uk | +44 7700 900456 | Manchester",
    "PROFILE",
    "Project coordinator with four years in construction and facilities programmes across the North West, trusted with supplier management, budgets and reporting.",
    "EXPERIENCE",
    "Project Coordinator, Northgate Facilities Ltd, Mar 2023 - Present",
    ...achievements("Northgate", 12),
    "Assistant Project Coordinator, Pennine Build Services, Oct 2021 - Feb 2023",
    ...achievements("Pennine", 10),
    "EDUCATION",
    "BSc Construction Management, University of Salford, 2021",
    "SKILLS",
    "Programme planning, supplier management, budgeting, risk registers, MS Project, Excel, stakeholder reporting",
  ].join("\n");

  it("a two-page UK CV from four years of work is within the UK's range, whatever the model recommended", async () => {
    world.gateway = gatewayAnswering({ ...ANALYSIS, resumeLength: { currentPages: 2, recommendedPages: 1, verdict: "too_long" } });
    const { json } = await scanPrimary(primary, { resumeText: GB_CV, targetCountry: "GB" });
    const rl = json.resumeLength as { currentPages: number; recommendedPages: number; verdict: string };
    expect(rl.currentPages).toBe(2);
    expect(rl.verdict).toBe("just_right");
    expect(rl.recommendedPages).toBeGreaterThanOrEqual(COUNTRY_STANDARDS.GB.pagesMin);
    expect(rl.recommendedPages).toBeLessThanOrEqual(COUNTRY_STANDARDS.GB.pagesMax);
  });

  it("the model is told Germany's rule, not one worldwide rule", async () => {
    await scanPrimary(primary, { resumeText: GB_CV, targetCountry: "DE" });
    const prompts = world.fetched.filter((f) => f.url.includes("ai.gateway.lovable.dev")).map((f) => f.body).join("\n");
    expect(prompts).toContain(COUNTRY_STANDARDS.DE.lengthNote);
    expect(prompts).not.toContain("3 pages 15+yrs");
  });
});
