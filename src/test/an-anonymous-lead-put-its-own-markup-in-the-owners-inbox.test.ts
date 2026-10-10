// @vitest-environment node
/**
 * AN ANONYMOUS LEAD PUT ITS OWN MARKUP IN THE OWNER'S INBOX (S8-100).
 *
 * WHAT WAS WRONG. save-lead answers anyone (verify_jwt off) and mails the
 * owner a "NEW LEAD" alert. The posted industry (up to 100 characters), the
 * first X-Forwarded-For hop and a country header -- all written by the
 * caller -- went raw into the alert's HTML and subject, so a POST could
 * render "<a href=...>Re-verify Resend</a>" in the owner's own alert channel.
 *
 * WHAT HOLDS NOW, running the shipped handler with its network faked: an
 * industry that is not a label the detector or the correction menu makes is
 * not printed; the address is the platform's, never the caller's first hop
 * (and keys the rate limit); a country header is ignored; what is printed is
 * escaped, and the subject carries no markup or control characters.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const db = new FakeDb();
const mails: Array<{ subject: string; html: string; to: string[] }> = [];
const pending: Promise<unknown>[] = [];
let handler: EdgeHandler;
let limitedBy: unknown[] = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", RESEND_API_KEY: "re_x" };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  g.__leadDb = db;
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("api.resend.com")) mails.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("save-lead", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__leadDb;",
  });
}, 60_000);

beforeEach(() => {
  mails.length = 0; pending.length = 0; limitedBy = [];
  db.tables = {}; db.writes = [];
  db.rpcs = {
    check_rate_limit: (a) => { limitedBy.push(a.p_ip); return { data: true, error: null }; },
    save_free_scan_lead: () => ({ data: null, error: null }),
  };
});

const post = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/save-lead", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
  while (pending.length) await pending.shift();
  return res;
};
const leadMail = () => mails.find((m) => /NEW LEAD/.test(m.subject))!;

describe("the owner's lead alert prints nothing a caller wrote as markup", () => {
  it("a link posted as the industry, a forged first hop and a country header never reach the alert", async () => {
    const res = await post(
      { email: "lead@example.com", industry: '<a href="https://evil.example/login">Re-verify Resend</a>', atsScore: 55 },
      { "x-forwarded-for": "6.6.6.6, 203.0.113.9", "cf-ipcountry": "<b>US</b>" },
    );
    expect(res.status).toBe(200);
    const m = leadMail();
    expect(m, "no lead alert was sent").toBeTruthy();
    expect(m.html, "the caller's link rendered in the owner's inbox").not.toContain("<a href=\"https://evil.example");
    expect(m.html).not.toContain("evil.example");
    expect(m.html).toContain("Not detected");
    expect(m.html, "the caller's first hop was printed as the lead's address").not.toContain("6.6.6.6");
    expect(m.html).toContain("203.0.113.9");
    expect(m.html, "a country header was printed").not.toContain("<b>US</b>");
    expect(m.subject).not.toMatch(/[<>\u0000-\u001f]/);
    expect(limitedBy, "the flood bound was keyed on the caller's first hop").toEqual(["203.0.113.9"]);
  });

  it("an industry the detector makes is printed", async () => {
    await post({ email: "lead@example.com", industry: "technology", atsScore: 70 }, { "cf-connecting-ip": "198.51.100.4" });
    expect(leadMail().html).toContain("technology");
  });
});
