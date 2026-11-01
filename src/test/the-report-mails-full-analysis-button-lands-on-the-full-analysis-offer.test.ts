// @vitest-environment node
/**
 * THE REPORT MAIL'S "GET THE FULL ANALYSIS" BUTTON LANDS ON THE FULL
 * ANALYSIS OFFER (register S13-099).
 *
 * The free report mail's button went to /resume-checker#pricing. That page
 * has no element with id "pricing": the reader landed at the top of the
 * scanner, with an upload box and no Full Analysis offer anywhere in view.
 * It now goes to /pricing#full-analysis, the $5 Full Analysis card on the
 * pricing page (PlanCards' section id), keeping the campaign tags. The mail
 * is rendered by the shipped handler with only its network faked; the
 * destination is checked against the page's own source.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const ROOT = resolve(__dirname, "../..");
const sent: Array<{ html: string }> = [];
const db = new FakeDb();
let send: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_role_key_for_the_harness_0123456789abcdef", RESEND_API_KEY: "re_harness" };
  g.__s099Sent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  send = await loadEdgeHandler("send-scan-report", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__s099Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
    "_shared/scan-mail-seal.ts": "export async function scanMailSealValid() { return true; }",
  });
}, 120_000);

afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

const button = (html: string) => {
  const m = /<a href="([^"]+)"[^>]*>Get the full analysis/.exec(html);
  expect(m, "the mail carries the Full Analysis button").not.toBeNull();
  return new URL(m![1].replace(/&amp;/g, "&"));
};

describe("the report mail's Full Analysis button", () => {
  it("goes to the Full Analysis card on the pricing page", async () => {
    db.rpcs.mail_door_take = () => ({ data: true, error: null });
    db.rpcs.save_free_scan_lead = () => ({ data: null, error: null });
    const res = await send(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" },
      body: JSON.stringify({ email: "jane@example.com", score: 61, reportId: "A1B2C3D4E5F6", mailSeal: "stood-in" }),
    }));
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    const url = button(sent[0].html);
    expect(url.pathname).toBe("/pricing");
    expect(url.hash).toBe("#full-analysis");
    expect(url.searchParams.get("utm_source")).toBe("email");
    expect(url.searchParams.get("utm_medium")).toBe("scan_report");
    expect(url.searchParams.get("utm_campaign")).toBe("free_scan");
  });

  it("that card is where the button points: a /pricing route and a section with that id", () => {
    expect(readFileSync(resolve(ROOT, "src/App.tsx"), "utf8")).toMatch(/<Route path="\/pricing" element=/);
    expect(readFileSync(resolve(ROOT, "src/components/pricing/PlanCards.tsx"), "utf8")).toMatch(/id="full-analysis"[^>]*data-plan="full-analysis"/);
  });

  it("the function says which build carries the new destination", () => {
    const src = readFileSync(resolve(ROOT, "supabase/functions/send-scan-report/index.ts"), "utf8");
    expect(src).toMatch(/const FN_BUILD = "send-scan-report\.2026-11-01\.1";/);
  });
});
