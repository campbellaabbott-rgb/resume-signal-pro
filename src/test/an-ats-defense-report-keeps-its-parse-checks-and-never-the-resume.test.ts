// @vitest-environment node
/**
 * AN ATS DEFENSE REPORT KEEPS ITS PARSE CHECKS, AND NEVER THE RÉSUMÉ (RC-S12-031).
 *
 * The ATS Parse Simulation was run by the success page on the résumé its own
 * tab held, so a buyer who opened the report later (the link in the mail,
 * another device, a closed tab) got the report without it, and its PDF
 * without that section. generate-ats-defense now runs the same simulation on
 * the résumé it was sent and saves only the result with the report. The
 * résumé text itself is never saved: the privacy page promises it is kept for
 * a day only.
 *
 * The generator bundles a copy of src/lib/ats-parse-simulator.ts, which must
 * stay byte for byte the page's, so the saved checks are the page's checks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { post, toolReply, WritingWorld, WRITING_STUBS } from "./helpers/writing-harness";
import { simulateAtsParse } from "@/lib/ats-parse-simulator";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("the generator's simulator", () => {
  it("is the page's file, byte for byte", () => {
    expect(read("supabase/functions/generate-ats-defense/ats-parse-simulator.ts")).toBe(read("src/lib/ats-parse-simulator.ts"));
  });
});

const RESUME = [
  "Priya Raman | priya.raman@example.com | 555-010-0142",
  "PROFESSIONAL SUMMARY",
  "Data analyst who rebuilt the Northwind churn dashboard used by 40 regional managers.",
  "EXPERIENCE",
  "Data Analyst, Northwind Traders, Jan 2020 - Present",
  "- Rebuilt the churn dashboard in Looker",
  "EDUCATION",
  "BSc Statistics, 2019",
  "SKILLS",
  "SQL, Python, Looker",
].join("\n");
const REPORT = { beforeScore: { overall: 60 }, afterScore: { overall: 80 }, actionPlan: [], redFlagsSummary: [] };

let handler: EdgeHandler;
let world: WritingWorld;
let saved: Array<Record<string, unknown>>;

beforeAll(async () => {
  new WritingWorld().install();
  handler = await loadEdgeHandler("generate-ats-defense", {
    ...WRITING_STUBS,
    "https://esm.sh/stripe@18.5.0":
      "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', status: 'complete', amount_total: 1500, customer_details: { email: 'b@example.com' }, metadata: { product_type: 'ats_defense' } }) } }; } }",
  });
}, 180_000);

beforeEach(() => {
  world = new WritingWorld();
  world.install();
  saved = [];
  world.db.rpcs.save_purchased_content = (a) => { saved.push(a); return { data: "pc-1", error: null }; };
  world.reply = () => toolReply("submit_ats_defense", REPORT);
});

describe("generate-ats-defense", () => {
  it("saves the parse checks with the report, the same checks the page runs, and no line of the résumé", async () => {
    const r = await post(handler, "generate-ats-defense", { sessionId: "cs_live_ats_saves", resumeText: RESUME }, "service");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(saved).toHaveLength(1);
    const content = saved[0].p_generated_content as { parseSimulation?: { overallConfidence: number; checks: unknown[] } };
    const page = simulateAtsParse(RESUME, { multiColumnDetected: false });
    expect(content.parseSimulation).toEqual({ overallConfidence: page.overallConfidence, checks: page.checks });
    expect((r.body.data as { parseSimulation?: unknown }).parseSimulation).toEqual(content.parseSimulation);
    const kept = JSON.stringify(content);
    for (const line of RESUME.split("\n").filter((l) => l.length > 12)) expect(kept).not.toContain(line);
    expect(kept).not.toContain("priya.raman@example.com");
    expect(kept).not.toContain("Northwind");
  });

  it("a layout the page measured as two columns is checked as two columns", async () => {
    await post(handler, "generate-ats-defense", { sessionId: "cs_live_ats_columns", resumeText: RESUME, multiColumnDetected: true }, "service");
    const sim = (saved[0].p_generated_content as { parseSimulation: { checks: Array<{ status: string; label: string }> } }).parseSimulation;
    expect(sim).toEqual(JSON.parse(JSON.stringify(simulateAtsParse(RESUME, { multiColumnDetected: true }))));
  });

  it("a parseSimulation the model writes is replaced by the measured one", async () => {
    world.reply = () => toolReply("submit_ats_defense", { ...REPORT, parseSimulation: { overallConfidence: 100, checks: [] } });
    await post(handler, "generate-ats-defense", { sessionId: "cs_live_ats_model", resumeText: RESUME }, "service");
    const sim = (saved[0].p_generated_content as { parseSimulation: { overallConfidence: number; checks: unknown[] } }).parseSimulation;
    expect(sim.checks.length).toBeGreaterThan(0);
    expect(sim.overallConfidence).toBe(simulateAtsParse(RESUME).overallConfidence);
  });
});
