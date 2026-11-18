// @vitest-environment node
/**
 * A FULL ANALYSIS BOUGHT WITH A POSTING SAYS WHEN THE POSTING SECTION IS
 * MISSING (S14X-041; bug round 2026-11-12).
 *
 * WHAT WAS WRONG. The analysis is asked in parts (S13-001): the core, and a
 * call each for the posting comparison and the LinkedIn review. A section
 * call that fails is left out and the analysis is still delivered, which is
 * right, but nothing said so: hasJobDescription stayed true, the page hid the
 * posting card with no word, and the mail said nothing. A buyer who paid for
 * a comparison with a posting got none and was not told.
 *
 * NOW the delivered analysis says it: hasJobDescription is false when the
 * posting section is missing (as hasLinkedIn already was for LinkedIn), and
 * missingSections names each section the analysis went out without. The same
 * object is stored behind the share link and carried by the mail
 * (send-analysis-email names it; the page shows data-testid sections-missing,
 * src/test/the-full-analysis-page-names-a-section-it-could-not-write.test.tsx).
 * Whether a missing section should refuse the delivery instead is the owner's
 * call; this is the part that holds either way.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResumeHarness, answerFor, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";

const LINKEDIN = "Jane Doe | Senior Software Engineer at Acme. About: I build payment systems. Experience: Acme 2019-now.";
const POSTING = "Senior Financial Analyst. We need FP&A, variance analysis, forecasting and SQL for our corporate finance team in Austin.";

let h: Harness;
let mails: Array<Record<string, any>>;
const g = globalThis as Record<string, unknown>;
const asked = (opts: unknown, key: string) =>
  key in ((opts as { tools?: Array<{ function?: { parameters?: { properties?: Record<string, unknown> } } }> }).tools?.[0]?.function?.parameters?.properties ?? {});

/** The model: every call answers, except the sections named, which the gateway refuses. */
const modelFailing = (...sections: string[]) => {
  let n = 0;
  g.__fakeAI = async (opts: unknown) => {
    n++;
    if (sections.some((s) => asked(opts, s))) return { response: new Response(JSON.stringify({ error: "upstream" }), { status: 500 }), modelUsed: "fake" };
    const body = { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(answerFor(opts, `ai-call-${n}`)) } }] } }] };
    return { response: new Response(JSON.stringify(body), { status: 200 }), modelUsed: "fake" };
  };
};

beforeAll(async () => {
  h = await analyzeResumeHarness();
}, 240_000);

beforeEach(() => {
  h.reset();
  mails = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  g.fetch = async (url: string, init?: RequestInit) => {
    if (String(url).includes("/send-analysis-email")) mails.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  };
});

const buy = (id: string) => h.sessions.set(id, fullAnalysisSession(id));

describe("a section the analysis went out without is named", () => {
  it("the posting section failing: delivered, hasJobDescription false, missingSections names it, in the stored copy and the mail too", async () => {
    buy("cs_live_noposting");
    modelFailing("jobDescriptionAlignment");
    const r = await h.call({ resumeText: RESUME, jobDescriptionText: POSTING, sessionId: "cs_live_noposting" });
    expect(r.status, "a failed posting section threw away a complete analysis").toBe(200);
    expect(r.json.jobDescriptionAlignment).toBeUndefined();
    expect(r.json.hasJobDescription, "the analysis claims a posting comparison it does not have").toBe(false);
    expect(r.json.missingSections).toEqual(["jobDescription"]);
    const stored = h.db.rows("resume_analyses")[0].analysis_result as Record<string, unknown>;
    expect(stored.missingSections).toEqual(["jobDescription"]);
    expect(stored.hasJobDescription).toBe(false);
    await h.settle();
    expect(mails).toHaveLength(1);
    expect(mails[0].analysisData.missingSections).toEqual(["jobDescription"]);
  });

  it("the LinkedIn section failing: hasLinkedIn false and missingSections names it", async () => {
    buy("cs_live_nolinkedin");
    modelFailing("linkedInAnalysis");
    const r = await h.call({ resumeText: RESUME, linkedInText: LINKEDIN, jobDescriptionText: POSTING, sessionId: "cs_live_nolinkedin" });
    expect(r.status).toBe(200);
    expect(r.json.hasLinkedIn).toBe(false);
    expect(r.json.hasJobDescription).toBe(true);
    expect(r.json.missingSections).toEqual(["linkedIn"]);
  });

  it("both failing: both named, the posting first", async () => {
    buy("cs_live_coreonly");
    modelFailing("linkedInAnalysis", "jobDescriptionAlignment");
    const r = await h.call({ resumeText: RESUME, linkedInText: LINKEDIN, jobDescriptionText: POSTING, sessionId: "cs_live_coreonly" });
    expect(r.status).toBe(200);
    expect(r.json.missingSections).toEqual(["jobDescription", "linkedIn"]);
    expect(r.json.hasJobDescription).toBe(false);
    expect(r.json.hasLinkedIn).toBe(false);
  });

  it("a whole analysis names nothing missing, and one asked with no posting does not call the posting missing", async () => {
    buy("cs_live_whole");
    modelFailing();
    const whole = await h.call({ resumeText: RESUME, linkedInText: LINKEDIN, jobDescriptionText: POSTING, sessionId: "cs_live_whole" });
    expect(whole.status).toBe(200);
    expect(whole.json.missingSections).toBeUndefined();
    expect(whole.json.hasJobDescription).toBe(true);
    buy("cs_live_resumeonly");
    const alone = await h.call({ resumeText: RESUME, sessionId: "cs_live_resumeonly" });
    expect(alone.json.missingSections).toBeUndefined();
    expect(alone.json.hasJobDescription).toBe(false);
  });
});
