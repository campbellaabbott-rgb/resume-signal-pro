// @vitest-environment node
/**
 * A SCAN ORDER MAILED AGAIN SAYS THE CREDITS IT BOUGHT (S14X-224).
 *
 * "Email it again" on an account order posts the order's saved copy to
 * send-product-email. For a scan pack that copy is {credits, message}, but
 * the mail said "30 scan credits have been added" whatever was bought (a
 * buyer chooses 5 to 100), a career bundle said "75 full resume analyses",
 * both sent the buyer to "the home page" (the job board since the
 * switch-over), and a scan_credits order fell back to the Keyword Fix mail.
 *
 * The copy for those three products is now a pure module that reads the
 * saved count; the mail is checked as send-product-email renders it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service-role-harness-key-0123456789abcdef";
const sent: Array<{ subject: string; html: string }> = [];
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__sent = sent;
  handler = await loadEdgeHandler("send-product-email", {
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__sent.push(m); return { data: { id: 're_1' }, error: null }; } }; } }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return { rpc: async () => ({ data: null, error: null }) }; }",
  });
}, 120_000);

async function mail(productType: string, generatedContent: unknown) {
  sent.length = 0;
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/send-product-email", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ email: "b@example.com", productType, productName: "Scan Pack", generatedContent, sessionId: "cs_live_a1b2c3d4e5f6g7h8i9j0" }),
  }));
  expect(res.status).toBe(200);
  expect(sent).toHaveLength(1);
  return sent[0].html;
}

describe("the scan products' mail, sent again from the saved copy", () => {
  it("a 10-credit scan pack says 10 scan credits and points at the resume checker, never a fixed 30 or the home page", async () => {
    const html = await mail("scan_pack", { credits: 10, message: "10 scan credits added to your account" });
    expect(html).toMatch(/10 scan credits/);
    expect(html).not.toMatch(/30 scan/);
    expect(html).toMatch(/resumebooster\.work\/resume-checker/);
    expect(html).not.toMatch(/home page/i);
  });

  it("a scan_credits order gets the scan copy, not the Keyword Fix mail", async () => {
    const html = await mail("scan_credits", { credits: 25 });
    expect(html).toMatch(/25 scan credits/);
    expect(html).not.toMatch(/Keyword/);
  });

  it("a career bundle with no saved count names no number", async () => {
    const html = await mail("career_bundle", null);
    expect(html).not.toMatch(/\b75\b/);
    expect(html).not.toMatch(/\b30\b/);
    expect(html).toMatch(/scan credits/);
  });

  it("the copy module is pure: it imports nothing", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/send-product-email/retired-copy.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
