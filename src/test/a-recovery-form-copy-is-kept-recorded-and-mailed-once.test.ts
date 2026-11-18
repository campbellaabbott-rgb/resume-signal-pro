// @vitest-environment node
/**
 * A COPY THE RECOVERY FORM MAKES IS KEPT, RECORDED AND MAILED ONCE (RC-S12-007).
 *
 * A buyer whose checkout bound no résumé gets the product only from the
 * success page's recovery form, which asks the generator from the browser.
 * The generator answered the page and nothing else: no copy was saved (a
 * refresh showed the form again and spent another model call), the order
 * never left "payment received", so the owner's paid-not-delivered alarm
 * counted a buyer who had their product, and no mail was sent, so the link
 * in the purchase email led back to the form.
 *
 * Run against the five shipped generators with only their network faked: a
 * browser's first copy is saved once, the order is marked generated, and the
 * mail is asked for once. A copy already saved, an order already mailed, our
 * own servers (which save and mail themselves), a refunded order and an
 * Apply Assistant's letter are each left alone.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { chatReply, loadWriter, post, WritingWorld, type AiCall } from "./helpers/writing-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const RESUME = "Maria Lopez\nRegistered Nurse (RN), BSN\nSt. Mary's Hospital, Staff Nurse, 2018-2024: cared for 6 patients a shift on a medical-surgical floor; trained 4 new hires.\nSkills: patient assessment, EHR charting, IV therapy.";
const POSTING = "We are looking for an experienced ICU nurse to join our team in Denver. You will care for critically ill patients and work closely with physicians.";

const SNAPSHOT = {
  careerSignalScore: {
    overall: "Strong",
    performanceSignal: { score: "Strong", summary: "Clear patient load." },
    trajectorySignal: { score: "Growth", summary: "Trains new hires." },
    credibilitySignal: { score: "High", summary: "Six years in one unit." },
    seniorityAlignment: { currentLevel: "Mid", targetFit: "Aligned", summary: "Fits." },
  },
  recruiterPerception: { summary: "A steady floor nurse." },
  topStrengths: [{ strength: "Patient care", evidence: "6 patients a shift." }],
  careerRisks: [{ risk: "No ICU time", recruiterQuestion: "ICU?", mitigation: "Name the acuity." }],
  positioningGuidance: { idealPositioning: "Floor RN.", rolesToTarget: ["Staff RN"], rolesToAvoid: ["Manager"], companyStages: ["Hospital"], storyFraming: "Steady." },
  priorityFixes: [{ fix: "Add acuity", impact: "High", timeEstimate: "15 minutes" }],
};
const WEEK = { focus: "Focus", tasks: ["Task"] };
const GAMEPLAN = {
  resumeReadinessGate: { verdict: "Ready to Apply", confidence: "High", summary: "Ready.", quickFixes: [] },
  roleTargetingMap: { summary: "Staff RN.", priorityRoles: [{ title: "Staff RN", whyFit: "BSN." }], rolesToAvoid: [] },
  applicationStrategy: { weeklyTarget: "10", whereToApply: [{ channel: "Hospital sites", priority: "High", tip: "Apply early." }], whatToAvoid: [], keyInsight: "Referrals." },
  networkingPlaybook: { approach: "Alumni.", outreachScript: { scenario: "Cold", script: "Hi" }, linkedInTips: [] },
  interviewReadiness: { summary: "STAR.", storiesToPrepare: [], whyThisRole: "Care.", projectTalkingPoints: [] },
  thirtyDayPlan: { week1: WEEK, week2: WEEK, week3: WEEK, week4: WEEK },
};
const LETTER = "Dear Hiring Manager,\n\nI cared for 6 patients a shift at St. Mary's Hospital and trained 4 new hires.\n\nMaria";
const letterJson = { coverLetter: LETTER, openingLine: "x", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "x", alternateOpenings: [] };
const HONEST_RESUME = "Maria Lopez\nRegistered Nurse (RN), BSN\nSt. Mary's Hospital, Staff Nurse, 2018-2024\n- Cared for 6 patients a shift\n- Trained 4 new hires";
const premiumReply = (call: AiCall) => {
  const system = String((call.body.messages as Array<{ content: string }>)[0]?.content ?? "");
  const isLetter = /cover letter/i.test(system) && !/resume writer|rewrite/i.test(system.slice(0, 200));
  return chatReply(JSON.stringify(isLetter
    ? { coverLetter: LETTER, openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" }
    : { rewrittenResume: HONEST_RESUME, professionalSummary: "", keyChanges: [], addedKeywords: [], atsScore: { before: 50, after: 80, improvement: "" }, highlights: [] }));
};

type Case = { fn: string; productType: string; reply: (c: AiCall) => Response; body: Record<string, unknown> };
const CASES: Case[] = [
  { fn: "generate-keyword-fix", productType: "basic_keyword_fix", reply: () => chatReply(JSON.stringify({ missingKeywords: [{ keyword: "ICU" }], overallScore: 61 })), body: { jobDescription: POSTING, jobTitle: "ICU Nurse" } },
  { fn: "generate-career-snapshot", productType: "career_snapshot", reply: () => chatReply(JSON.stringify(SNAPSHOT)), body: {} },
  { fn: "generate-graduate-gameplan", productType: "graduate_gameplan", reply: () => chatReply(JSON.stringify(GAMEPLAN)), body: {} },
  { fn: "generate-premium-package", productType: "premium_package", reply: premiumReply, body: { jobDescription: POSTING, jobTitle: "ICU Nurse", jobCompany: "Denver Health" } },
  { fn: "generate-cover-letter", productType: "cover_letter", reply: () => chatReply(JSON.stringify(letterJson)), body: { jobDescription: POSTING, jobTitle: "ICU Nurse" } },
];

const SESSION = "cs_live_recovery_form_order";
const handlers = new Map<string, EdgeHandler>();
let world: WritingWorld;
let saves: Array<Record<string, unknown>>;
let steps: Array<Record<string, unknown>>;
let mails: Array<Record<string, unknown>>;

beforeAll(async () => {
  new WritingWorld().install();
  for (const c of CASES) handlers.set(c.fn, await loadWriter(c.fn));
}, 240_000);

function open(c: Case, order: Record<string, unknown> | null = {}, claimProduct = c.productType) {
  world = new WritingWorld();
  world.install();
  const g = globalThis as Record<string, unknown>;
  const gateway = g.fetch as (u: string, i?: { body?: string }) => Promise<Response>;
  mails = [];
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith("/functions/v1/send-product-email")) {
      mails.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response("{}", { status: 200 });
    }
    return gateway(url, init);
  };
  saves = [];
  steps = [];
  world.db.rows("used_stripe_sessions").push({ session_id: SESSION, product_type: claimProduct });
  if (order) world.db.rows("product_deliveries").push({ stripe_session_id: SESSION, status: "payment_received", customer_email: "buyer@example.com", email_sent_at: null, product_name: null, metadata: { language: "es" }, ...order });
  world.db.rpcs.get_purchased_content_by_session = () => ({ data: saves.map((s) => ({ generated_content: s.p_generated_content })), error: null });
  world.db.rpcs.save_purchased_content = (a) => { saves.push(a); return { data: "pc-1", error: null }; };
  world.db.rpcs.log_delivery_step = (a) => { steps.push(a); return { data: "d-1", error: null }; };
  world.reply = c.reply;
}

const generate = (c: Case, who = "anon") =>
  post(handlers.get(c.fn)!, c.fn, { resumeText: RESUME, sessionId: SESSION, ...c.body }, who);

beforeEach(() => { saves = []; steps = []; mails = []; });

describe.each(CASES)("$fn, asked by the recovery form", (c) => {
  it("saves the first copy once, marks the order generated, and asks for the mail once", async () => {
    open(c);
    const r = await generate(c);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ p_stripe_session_id: SESSION, p_product_type: c.productType, p_customer_email: "buyer@example.com" });
    expect(saves[0].p_generated_content).toEqual(r.body.data);
    expect(steps.map((s) => [s.p_step, s.p_success])).toEqual([["generation_completed", true], ["email_sent", true]]);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ email: "buyer@example.com", productType: c.productType, sessionId: SESSION, language: "es" });
    expect(mails[0].generatedContent).toEqual(r.body.data);
  });
});

describe("what is left alone", () => {
  const fix = CASES[0];

  it("a copy already saved is the buyer's: a second press neither overwrites it nor mails again", async () => {
    open(fix);
    await generate(fix);
    await generate(fix);
    expect(saves).toHaveLength(1);
    expect(mails).toHaveLength(1);
  });

  it("an order whose mail was already sent is saved and recorded, never mailed twice", async () => {
    open(fix, { email_sent_at: "2026-11-10T10:00:00Z" });
    expect((await generate(fix)).status).toBe(200);
    expect(saves).toHaveLength(1);
    expect(steps.map((s) => s.p_step)).toEqual(["generation_completed"]);
    expect(mails).toEqual([]);
  });

  it("our own servers save and mail what they make themselves, so their call is not kept again", async () => {
    open(fix);
    expect((await generate(fix, "service")).status).toBe(200);
    expect(saves).toEqual([]);
    expect(steps).toEqual([]);
    expect(mails).toEqual([]);
  });

  it("a refunded order is not delivered", async () => {
    open(fix, { status: "refunded" });
    await generate(fix);
    expect(saves).toEqual([]);
    expect(mails).toEqual([]);
  });

  it("an older sale with no order row keeps its copy and invents no order", async () => {
    open(fix, null);
    expect((await generate(fix)).status).toBe(200);
    expect(saves).toHaveLength(1);
    expect(steps).toEqual([]);
    expect(mails).toEqual([]);
  });

  it("an Apply Assistant's letter is half of its package, not a Cover Letter order", async () => {
    const letter = CASES[4];
    open(letter, {}, "apply_assistant");
    expect((await generate(letter)).status).toBe(200);
    expect(saves).toEqual([]);
    expect(mails).toEqual([]);
  });

  it("a save that fails still answers the buyer their copy", async () => {
    open(fix);
    world.db.rpcs.save_purchased_content = () => ({ data: null, error: { message: "statement timeout" } });
    const r = await generate(fix);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeTruthy();
    expect(mails).toEqual([]);
  });
});
