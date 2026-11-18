// @vitest-environment node
/**
 * A "TRIGGERED BY" QUOTE IS ON THE RÉSUMÉ (bug round S14X-269, C-S14-115).
 *
 * Each triggered interview question prints "Triggered by: …" as the résumé's
 * own words, and the prompt asks the model to quote. dropUngrounded checked
 * every other quoted field and skipped this one, so a trigger quoting a line
 * the résumé does not have, or naming a "19-month gap" the dates do not
 * show, reached the page as the candidate's own content.
 *
 * groundTrigger (grounding.ts) now checks it: every quoted part must be on
 * the résumé, a gap or a role's length it states must be one the dates show
 * (employment-gaps.ts timelineFactsOf, the gap detector's reading), and any
 * other figure must be one the résumé has. The primary drops a question
 * whose trigger fails.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { ANALYSIS, gatewayAnswering, loadScanners, resetWorld, scanPrimary, world } from "./helpers/free-scan-world";
import { groundTrigger } from "../../supabase/functions/free-keyword-scan/grounding";
import { detectEmploymentGaps, timelineFactsOf } from "../../supabase/functions/free-keyword-scan/employment-gaps";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const NOW = new Date("2026-11-15T12:00:00Z");
const WITH_GAP = [
  "Dana Reyes | dana.reyes@example.com",
  "EXPERIENCE",
  "Engineer, BetaCo, Aug 2018 - Present",
  "- Managed a $5M platform budget across three regions",
  "Analyst, Acme Corp, Jan 2015 - Dec 2016",
  "- Built the weekly revenue report used by 40 managers",
].join("\n");
const NO_GAP = WITH_GAP.replace("Aug 2018", "Jan 2017");

describe("groundTrigger", () => {
  const facts = timelineFactsOf(WITH_GAP, NOW);

  it("drops a trigger quoting a line the résumé does not have, and keeps one quoting a real line", () => {
    expect(groundTrigger("'Led a 200-person sales organisation'", WITH_GAP, facts)).toBe(false);
    expect(groundTrigger("'Managed a $9M platform budget'", WITH_GAP, facts)).toBe(false);
    expect(groundTrigger("'Managed a $5M platform budget across three regions'", WITH_GAP, facts)).toBe(true);
    expect(groundTrigger("“Built the weekly revenue report”", WITH_GAP, facts)).toBe(true);
  });

  it("keeps a '19-month gap' only when the gap detector finds that gap", () => {
    expect(detectEmploymentGaps(WITH_GAP, NOW).gaps.map((g) => g.gapMonths)).toEqual([20]);
    expect(groundTrigger("The 19-month gap between Acme Corp and BetaCo", WITH_GAP, facts)).toBe(true);
    expect(groundTrigger("The 7-month gap between Acme Corp and BetaCo", WITH_GAP, facts)).toBe(false);
    expect(detectEmploymentGaps(NO_GAP, NOW).gaps).toEqual([]);
    expect(groundTrigger("The 19-month gap between Acme Corp and BetaCo", NO_GAP, timelineFactsOf(NO_GAP, NOW))).toBe(false);
    expect(groundTrigger("An unexplained gap after Acme Corp", NO_GAP, timelineFactsOf(NO_GAP, NOW))).toBe(false);
  });

  it("a figure outside a quote must be the résumé's, and a description with none is kept", () => {
    expect(groundTrigger("Managed $12M across regions", WITH_GAP, facts)).toBe(false);
    expect(groundTrigger("Report used by 40 managers", WITH_GAP, facts)).toBe(true);
    expect(groundTrigger("No metrics in the Acme Corp role", WITH_GAP, facts)).toBe(true);
    expect(groundTrigger("Only 1 of 2 bullets has a number", WITH_GAP, facts)).toBe(true);
    expect(groundTrigger("", WITH_GAP, facts)).toBe(false);
  });
});

describe("the primary drops a question whose trigger is not on the résumé", () => {
  let primary: EdgeHandler;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => { ({ primary } = await loadScanners(["primary"])); }, 240_000);
  beforeEach(() => {
    resetWorld();
    for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

  it("the invented quote and the invented gap are dropped; the real one stays", async () => {
    const q = (trigger: string, question: string) => ({ question, trigger, whyTheyAsk: "Screening", howToAnswer: "Be specific" });
    world.gateway = gatewayAnswering({
      ...ANALYSIS,
      resumeTriggeredQuestions: [
        q("'Led a 200-person sales organisation'", "Tell me about leading 200 people."),
        q("The 7-month gap between Acme Corp and BetaCo", "What happened in those seven months?"),
        q("'Managed a $5M platform budget across three regions'", "How did you allocate the $5M?"),
      ],
    });
    const { json } = await scanPrimary(primary, { resumeText: WITH_GAP });
    const kept = (json.resumeTriggeredQuestions as Array<{ trigger: string }>).map((x) => x.trigger);
    expect(kept).toEqual(["'Managed a $5M platform budget across three regions'"]);
  });
});
