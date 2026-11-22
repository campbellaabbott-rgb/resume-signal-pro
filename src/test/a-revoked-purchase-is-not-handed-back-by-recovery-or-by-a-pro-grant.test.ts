// @vitest-environment node
/**
 * A REVOKED PURCHASE IS NOT HANDED BACK BY RECOVERY, OR BY A PRO GRANT (S9-030).
 *
 * WHAT WAS WRONG. A refund in full or a dispute is recorded in
 * payment_revocations, and a refunded month of Pro revokes the grants it paid
 * for. Every generator then refuses the purchase. Two doors still handed its
 * saved copy back:
 *   - recover-purchase read only the saved copy, by the reference the buyer
 *     pasted, and never asked whether the payment behind it was taken back;
 *   - analyze-resume asks sessionWasRefunded, which reads only Checkout
 *     session and payment ids: a pro_ grant read as clear, and a revoked
 *     grant's stored analysis was handed back before its revoked_at was read.
 *
 * WHAT HOLDS NOW, on the shipped handlers with the database faked:
 *   - recovery refuses a refunded session (pasted bare or as the email's
 *     order line) and a revoked grant, with the refund's message and code,
 *     and reads no copy for them;
 *   - analyze-resume refuses a revoked grant's stored analysis the same way;
 *   - a purchase nothing took back is handed back as before, at both doors;
 *   - a revocation read that fails refuses nobody: the copy is handed back,
 *     as analyze-resume already does for a session.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { analyzeResumeHarness, type Harness } from "./helpers/analyze-resume-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { REFUNDED_PURCHASE_MESSAGE } from "../../supabase/functions/_shared/payment-revocation";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SESSION = "cs_live_a1B2c3D4e5F6g7H8i9J0refunded";
const GRANT = "7c0e6a51-2b9d-4f3e-8a1c-5d6e7f8a9b0c";
const PRO = `pro_${GRANT}`;
const COPY = { coverLetter: "Dear Hiring Manager, the letter this purchase bought." };

describe("recover-purchase", () => {
  let recover: EdgeHandler;
  let db: FakeDb;
  let contentReads: string[] = [];

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.__recoverDb = () => db;
    recover = await loadEdgeHandler("recover-purchase", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__recoverDb();",
    });
  }, 120_000);

  beforeEach(() => {
    contentReads = [];
    db = new FakeDb();
    db.rpcs.get_purchased_content_by_session = (a) => {
      contentReads.push(String(a.p_session_id));
      return { data: [{ id: "pc-1", product_type: "cover_letter", product_name: "Cover Letter", generated_content: COPY, created_at: "2026-11-20T10:00:00Z" }], error: null };
    };
    for (const k of ["log", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const ask = async (sessionId: string) => {
    const res = await recover(new Request("https://harness.supabase.co/functions/v1/recover-purchase", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }),
    }));
    return { status: res.status, build: res.headers.get("x-fn-build"), text: await res.clone().text(), body: await res.json() as Record<string, unknown> };
  };

  it("refuses a refunded session with the refund's message and code, and reads no copy for it", async () => {
    db.rows("payment_revocations").push({ stripe_session_id: SESSION, payment_intent_id: "pi_refunded", reason: "refund" });
    const r = await ask(SESSION);
    expect(r.status, "a refunded purchase was handed back").toBe(402);
    expect(r.body).toMatchObject({ error: REFUNDED_PURCHASE_MESSAGE, code: "purchase_refunded" });
    expect(r.text).not.toContain("Dear Hiring Manager");
    expect(contentReads).toEqual([]);
    expect(buildIsAtLeast(r.build, "recover-purchase", "2026-11-21"), String(r.build)).toBe(true);
  });

  it("refuses it pasted as the purchase email's order line too", async () => {
    db.rows("payment_revocations").push({ stripe_session_id: SESSION, reason: "dispute" });
    const r = await ask(`Order reference: ${SESSION}`);
    expect(r.status).toBe(402);
    expect(r.text).not.toContain("Dear Hiring Manager");
  });

  it("refuses a Pro grant its refund took back", async () => {
    db.rows("pro_grants").push({ id: GRANT, email: "member@example.com", product_type: "cover_letter", consumed_at: "2026-11-01T10:00:00Z", revoked_at: "2026-11-15T10:00:00Z" });
    const r = await ask(PRO);
    expect(r.status, "a revoked grant's copy was handed back").toBe(402);
    expect(r.body).toMatchObject({ code: "purchase_refunded" });
    expect(r.text).not.toContain("Dear Hiring Manager");
    expect(contentReads).toEqual([]);
  });

  it("hands back a purchase nothing took back, and a grant that stands", async () => {
    db.rows("payment_revocations").push({ stripe_session_id: "cs_live_someoneelse0000000000000", reason: "refund" });
    db.rows("pro_grants").push({ id: GRANT, email: "member@example.com", product_type: "cover_letter", consumed_at: "2026-11-01T10:00:00Z", revoked_at: null });
    for (const ref of [SESSION, PRO]) {
      const r = await ask(ref);
      expect(r.status, ref).toBe(200);
      expect(r.body).toMatchObject({ found: true, purchases: [expect.objectContaining({ generatedContent: COPY })] });
    }
    expect(contentReads).toEqual([SESSION, PRO]);
  });

  it("a revocation read that fails refuses nobody: the copy is handed back", async () => {
    db.faults.push({ table: "payment_revocations", op: "select", error: { message: "canceling statement due to statement timeout" } });
    db.faults.push({ table: "pro_grants", op: "select", error: { message: "canceling statement due to statement timeout" } });
    for (const ref of [SESSION, PRO]) {
      const r = await ask(ref);
      expect(r.status, ref).toBe(200);
      expect(r.body).toMatchObject({ found: true });
    }
  });
});

describe("analyze-resume, asked again for a Pro grant's stored analysis", () => {
  let h: Harness;
  beforeAll(async () => { h = await analyzeResumeHarness(); }, 120_000);
  beforeEach(() => {
    h.reset();
    // The grant was redeemed: its analysis is stored and pointed to under the grant's id.
    h.db.rows("purchased_content").push({ stripe_session_id: PRO, product_type: "full_analysis", generated_content: { shareId: "share_revoked_grant" } });
    h.db.rows("resume_analyses").push({ share_id: "share_revoked_grant", analysis_result: { marker: "the stored analysis", atsScore: { score: 71 } },
      created_at: "2026-11-01T10:00:00Z", expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });
    for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const grant = (revokedAt: string | null) => h.db.rows("pro_grants").push({
    id: GRANT, email: "member@example.com", user_id: "00000000-0000-4000-8000-00000000a11c", product_type: "full_analysis",
    consumed_at: "2026-11-01T10:00:00Z", revoked_at: revokedAt,
  });

  it("refuses it once the grant was revoked, with the refund's code, and hands back nothing", async () => {
    grant("2026-11-15T10:00:00Z");
    const r = await h.call({ sessionId: PRO });
    expect(r.status, "a revoked grant's stored analysis was handed back").toBe(402);
    expect(r.json).toMatchObject({ error: REFUNDED_PURCHASE_MESSAGE, code: "purchase_refunded" });
    expect(JSON.stringify(r.json)).not.toContain("the stored analysis");
    expect(h.aiCalls()).toBe(0);
  });

  it("hands it back while the grant stands", async () => {
    grant(null);
    const r = await h.call({ sessionId: PRO });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ marker: "the stored analysis", alreadyDelivered: true });
  });

  it("hands it back when the grant cannot be read: a hiccup refuses no member", async () => {
    grant("2026-11-15T10:00:00Z");
    h.db.faults.push({ table: "pro_grants", op: "select", error: { message: "canceling statement due to statement timeout" } });
    const r = await h.call({ sessionId: PRO });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ alreadyDelivered: true });
  });
});
