// @vitest-environment node
/**
 * A PRO MEMBER'S ANALYSIS MAIL SPEAKS THE LANGUAGE OF THE PAGE THEY ASKED ON
 * (FA-1, the audit-rest fixer's review; analyze-resume 2026-11-03.1).
 *
 * WHAT WAS WRONG. send-analysis-email picks its language from the request's
 * `language`, then the purchase's delivery row (metadata.language), then
 * English. analyze-resume sent no language, and the delivery row it opens for
 * a Pro member's included analysis carried none either (only the webhook's
 * row for a Stripe sale does). So a German Pro member, on the German page,
 * with a German report, got the mail in English.
 *
 * WHAT HOLDS NOW (the shipped handler; Stripe, the model and the database
 * faked): the mail is asked for in the page's language, and the row this
 * function opens records it where the mailer looks next. A language the site
 * does not carry is asked for as none, so the mailer still falls back as
 * before.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";

const GRANT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

let h: Harness;
const posts: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  h = await analyzeResumeHarness();
  (globalThis as Record<string, unknown>).fetch = async (url: string | URL, init?: RequestInit) => {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body ?? "{}")); } catch { body = {}; }
    posts.push({ url: String(url), body });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
}, 60_000);

beforeEach(() => {
  h.reset();
  posts.length = 0;
  h.db.rpcs.pro_entitlement_rows = () => ({ data: [{ tier: "pro", status: "active", current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(), bound: true }], error: null });
  h.db.rows("pro_grants").push({ id: GRANT, email: "member@example.com", user_id: ACCOUNT, product_type: "full_analysis", consumed_at: null, revoked_at: null });
});

const mailPost = () => posts.find((p) => p.url.endsWith("/functions/v1/send-analysis-email"));

describe("a Pro member's included analysis", () => {
  it("asks for the mail in the page's language and records it on the delivery row it opens", async () => {
    const r = await h.call({ resumeText: RESUME, sessionId: `pro_${GRANT}`, language: "de" });
    expect(r.status, JSON.stringify(r.json).slice(0, 200)).toBe(200);
    await h.settle();
    expect(mailPost()?.body.language).toBe("de");
    const row = h.db.rows("product_deliveries").find((d) => d.stripe_session_id === `pro_${GRANT}`);
    expect((row?.metadata as Record<string, unknown> | undefined)?.language).toBe("de");
  });

  it("a regional page code is the site's language it names", async () => {
    await h.call({ resumeText: RESUME, sessionId: `pro_${GRANT}`, language: "pt-BR" });
    await h.settle();
    expect(mailPost()?.body.language).toBe("pt");
  });

  it("a language the site does not carry is asked for as none, so the mailer falls back as before", async () => {
    await h.call({ resumeText: RESUME, sessionId: `pro_${GRANT}`, language: "it" });
    await h.settle();
    expect(mailPost()).toBeTruthy();
    expect(mailPost()!.body).not.toHaveProperty("language");
    const row = h.db.rows("product_deliveries").find((d) => d.stripe_session_id === `pro_${GRANT}`);
    expect(row?.metadata as Record<string, unknown>).not.toHaveProperty("language");
  });
});

describe("a $5 sale", () => {
  it("asks for the mail in the page's language too", async () => {
    const s = fullAnalysisSession("cs_live_fa1_spanish_buyer");
    h.sessions.set(s.id, s);
    const r = await h.call({ resumeText: RESUME, sessionId: s.id, language: "es" });
    expect(r.status).toBe(200);
    await h.settle();
    expect(mailPost()?.body.language).toBe("es");
  });
});
