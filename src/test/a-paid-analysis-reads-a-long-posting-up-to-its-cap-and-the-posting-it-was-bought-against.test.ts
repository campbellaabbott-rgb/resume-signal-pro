// @vitest-environment node
/**
 * A PAID ANALYSIS READS A LONG POSTING UP TO ITS CAP, AND THE POSTING IT WAS
 * BOUGHT AGAINST (hotfix 2026-11-10: H4, C-S14-012 and C-S14-010).
 *
 * What was wrong, run against the shipped handler:
 *   - a posting over 20,000 characters (LinkedIn text over 30,000) was
 *     refused 400 AFTER payment, and Try again read the same stored text into
 *     the same refusal for 24 hours;
 *   - a buyer whose page had lost its pointer to the stored copy (another
 *     device, a cleared browser, a return more than an hour later) was asked
 *     for the résumé alone, and the purchase was redeemed by an analysis
 *     without the posting it was sold against.
 * What holds now: the analysis reads the first 20,000 (30,000) characters and
 * says so in inputsClipped; a request without a posting or LinkedIn text is
 * given the ones stored at checkout; a request naming only the purchase is
 * told what is stored (and runs from it with fromStored), or, once the copy
 * is gone, whether the checkout was made with a posting.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";
import { checkoutHadPosting, clipText, storedInputsFor } from "../../supabase/functions/analyze-resume/paid-run";
import { FakeDb } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });

let h: Harness;
let asked: string[];
let realAI: (opts: unknown) => Promise<unknown>;
const g = globalThis as unknown as { __fakeAI: (opts: unknown) => Promise<unknown> };

beforeAll(async () => {
  h = await analyzeResumeHarness();
  realAI = g.__fakeAI;
}, 60_000);
beforeEach(() => {
  h.reset();
  asked = [];
  g.__fakeAI = (opts: unknown) => {
    const messages = (opts as { messages?: Array<{ role: string; content: string }> }).messages ?? [];
    asked.push(messages.filter((m) => m.role === "user").map((m) => m.content).join("\n"));
    return realAI(opts);
  };
});
afterEach(() => { g.__fakeAI = realAI; });

const buy = (id: string) => { h.sessions.set(id, fullAnalysisSession(id)); return id; };
const TEMP = "8a6f7d3e-1b2c-4d5e-9f00-112233445566";
const POSTING = "Senior Platform Engineer at Example Corp. You will run Kubernetes clusters and own Terraform modules. ".repeat(4);

/** The purchase recorded against a stored copy, as create-checkout now records it. */
function storeAtCheckout(id: string, copy: { resume?: string; posting?: string; linkedIn?: string }) {
  h.db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: TEMP });
  h.db.rpcs.get_temp_resume = (a) => ({
    data: a.p_session_id === TEMP
      ? [{ resume_text: copy.resume ?? RESUME, linkedin_text: copy.linkedIn ?? "", job_description_text: copy.posting ?? "" }]
      : [],
    error: null,
  });
}

describe("a long posting or profile is read up to its cap, never refused after payment", () => {
  it("a 25,000-character posting is analysed from its first 20,000, and the report says so", async () => {
    const posting = `${"Responsibilities include shipping reliable services. ".repeat(400).slice(0, 20_000)}TAIL-PAST-THE-CAP ${"x".repeat(4_982)}`;
    expect(posting.length).toBe(25_000);
    const r = await h.call({ resumeText: RESUME, jobDescriptionText: posting, sessionId: buy("cs_live_long_posting") });
    expect(r.status, JSON.stringify(r.json).slice(0, 200)).toBe(200);
    expect(r.json.inputsClipped).toEqual({ jobDescription: { from: 25_000, to: 20_000 } });
    expect(r.json.hasJobDescription).toBe(true);
    expect(asked.join("\n")).toContain("Responsibilities include shipping reliable services.");
    expect(asked.join("\n"), "the model was sent the text past the cap").not.toContain("TAIL-PAST-THE-CAP");
  });

  it("31,000 characters of LinkedIn text are analysed from their first 30,000, and the report says so", async () => {
    const linkedIn = "About me: I build data platforms. ".repeat(1_000).slice(0, 31_000);
    const r = await h.call({ resumeText: RESUME, linkedInText: linkedIn, sessionId: buy("cs_live_long_profile") });
    expect(r.status, JSON.stringify(r.json).slice(0, 200)).toBe(200);
    expect(r.json.inputsClipped).toEqual({ linkedIn: { from: 31_000, to: 30_000 } });
  });

  it("text within the caps is sent whole and the report claims no clipping", async () => {
    const r = await h.call({ resumeText: RESUME, jobDescriptionText: POSTING, sessionId: buy("cs_live_short_posting") });
    expect(r.status).toBe(200);
    expect(r.json.inputsClipped).toBeUndefined();
  });

  it("a cut never splits a character in two", () => {
    const text = `${"a".repeat(9)}😀tail`;
    const { text: cut, clip } = clipText(text, 10);
    expect(cut).toBe("a".repeat(9));
    expect(clip).toEqual({ from: text.length, to: 9 });
  });
});

describe("the purchase reads what it was bought against", () => {
  it("a request without a posting is given the posting stored at checkout", async () => {
    const id = buy("cs_live_other_device");
    storeAtCheckout(id, { posting: POSTING });
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status, JSON.stringify(r.json).slice(0, 200)).toBe(200);
    expect(r.json.hasJobDescription, "the analysis ran without the posting the purchase was bought against").toBe(true);
    expect(asked.join("\n")).toContain("Senior Platform Engineer at Example Corp.");
  });

  it("a posting the request sends is the one analysed, not the stored one", async () => {
    const id = buy("cs_live_sent_posting");
    storeAtCheckout(id, { posting: POSTING });
    const r = await h.call({ resumeText: RESUME, jobDescriptionText: "Data Analyst at Other Org. SQL, dashboards and stakeholder reporting every week.", sessionId: id });
    expect(r.status).toBe(200);
    expect(asked.join("\n")).toContain("Data Analyst at Other Org.");
    expect(asked.join("\n")).not.toContain("Senior Platform Engineer at Example Corp.");
  });

  it("asked by the purchase alone, the page is told what is stored, and fromStored runs the analysis from it", async () => {
    const id = buy("cs_live_session_only");
    storeAtCheckout(id, { resume: `${RESUME} STORED-RESUME-MARK`, posting: POSTING });
    const told = await h.call({ resumeText: "", sessionId: id });
    expect(told.status).toBe(400);
    expect(told.json.storedInputs).toEqual({ resume: true, posting: true, linkedIn: false });
    expect(h.aiCalls()).toBe(0);
    const run = await h.call({ resumeText: "", sessionId: id, fromStored: true });
    expect(run.status, JSON.stringify(run.json).slice(0, 200)).toBe(200);
    expect(run.json.hasJobDescription).toBe(true);
    expect(asked.join("\n")).toContain("STORED-RESUME-MARK");
  });

  it("once the stored copy is gone, the page is told the checkout was made with a posting", async () => {
    const id = buy("cs_live_copy_expired");
    h.db.rows("checkout_starts").push({ stripe_session_id: id, metadata: { promo: false, hasPosting: true } });
    const told = await h.call({ resumeText: "", sessionId: id });
    expect(told.status).toBe(400);
    expect(told.json.storedInputs).toBeUndefined();
    expect(told.json.checkoutHadPosting).toBe(true);
  });

  it("a checkout that recorded nothing says nothing, as before", async () => {
    const told = await h.call({ resumeText: "", sessionId: buy("cs_live_nothing_recorded") });
    expect(told.status).toBe(400);
    expect(told.json).toEqual({ error: "Resume text is required" });
  });
});

describe("the stored-copy readers", () => {
  it("a Pro member's grant reads the copy its checkout named", async () => {
    const db = new FakeDb();
    db.rows("pro_grants").push({ id: "11111111-2222-4333-8444-555555555555", resume_session_id: TEMP });
    db.rpcs.get_temp_resume = () => ({ data: [{ resume_text: RESUME, linkedin_text: "", job_description_text: POSTING }], error: null });
    const ref = { kind: "pro" as const, id: "pro_11111111-2222-4333-8444-555555555555", grantId: "11111111-2222-4333-8444-555555555555" };
    expect(await storedInputsFor(db, ref)).toEqual({ resume: RESUME, linkedIn: "", jobDescription: POSTING });
    expect(await checkoutHadPosting(db, ref)).toBeNull();
  });

  it("an expired copy, or a reference that is no id, reads as nothing", async () => {
    const db = new FakeDb();
    db.rows("checkout_resume_refs").push({ stripe_session_id: "cs_live_a", resume_session_id: TEMP });
    db.rows("checkout_resume_refs").push({ stripe_session_id: "cs_live_b", resume_session_id: "not-an-id" });
    db.rpcs.get_temp_resume = () => ({ data: [], error: null });
    expect(await storedInputsFor(db, { kind: "checkout", id: "cs_live_a" })).toBeNull();
    expect(await storedInputsFor(db, { kind: "checkout", id: "cs_live_b" })).toBeNull();
    expect(await storedInputsFor(db, { kind: "checkout", id: "cs_live_none" })).toBeNull();
  });
});
