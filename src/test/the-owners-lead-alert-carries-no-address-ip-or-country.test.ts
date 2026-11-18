// @vitest-environment node
/**
 * THE OWNER'S LEAD ALERT CARRIES NO ADDRESS, IP OR COUNTRY (S14X-101, the
 * owner's answer 'remove').
 *
 * The free report had a "weekly tips" box that posted the visitor's address to
 * save-lead, and save-lead mailed the owner "NEW LEAD: <address> | <industry> |
 * <country>" with the address, the raw IP and the looked-up country in the
 * body and a reply link to the address; a performance alert carried the IP
 * too; and notify-owner put each new account's address in its subject and
 * body. The owner's answer: the box goes, and owner alerts carry counts or a
 * reference only. Running the shipped handlers with their network faked:
 *   - save-lead's lead alert names the industry, the score and a short
 *     reference (a keyed hash of the address), never the address, the IP or a
 *     country, and its performance alert carries no IP;
 *   - notify-owner's new-account note says an account was created and when,
 *     never the address;
 *   - the report no longer calls save-lead.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const ROOT = resolve(__dirname, "../..");
const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", IPINFO_API_KEY: "ipinfo_harness",
};
type Mail = { subject: string; html: string; to: string[] };
const fetched: Mail[] = [];
const resent: Mail[] = [];
const pending: Promise<unknown>[] = [];
let db: FakeDb;
let saveLead: EdgeHandler;
let notify: EdgeHandler;

const ADDRESS = "jane.doe@corp-example.com";
const IP = "203.0.113.9";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("api.resend.com")) { fetched.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200 }); }
    if (u.includes("ipinfo.io")) return new Response(JSON.stringify({ country: "US" }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  saveLead = await loadEdgeHandler("save-lead", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__ownDb;",
  });
  notify = await loadEdgeHandler("notify-owner", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__ownDb; }",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__ownResent.push(m); return { data: { id: 'x' }, error: null }; } }; } }",
  });
}, 120_000);

beforeEach(() => {
  fetched.length = 0; resent.length = 0; pending.length = 0;
  db = new FakeDb();
  db.rpcs = {
    check_rate_limit: () => ({ data: true, error: null }),
    save_free_scan_lead: () => ({ data: null, error: null }),
    mail_door_take: () => ({ data: true, error: null }),
  };
  const g = globalThis as Record<string, unknown>;
  g.__ownDb = db; g.__ownResent = resent;
});

const postLead = async (body: unknown) => {
  const res = await saveLead(new Request("https://harness.supabase.co/functions/v1/save-lead", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": IP }, body: JSON.stringify(body),
  }));
  while (pending.length) await pending.shift();
  return res;
};
const said = (m: Mail) => `${m.subject}\n${m.html}`;
const carriesNone = (text: string) => {
  expect(text, "the address").not.toContain("jane.doe");
  expect(text, "the address's domain").not.toContain("corp-example.com");
  expect(text, "the IP").not.toContain(IP);
  expect(text, "a country").not.toMatch(/\bUS\b|United States|Location/);
};

describe("save-lead's alerts", () => {
  it("the lead alert names the industry, the score and a reference, and no address, IP or country", async () => {
    expect((await postLead({ email: ADDRESS, industry: "technology", atsScore: 61 })).status).toBe(200);
    const lead = fetched.find((m) => /NEW LEAD/.test(m.subject));
    expect(lead, "no lead alert was sent").toBeTruthy();
    carriesNone(said(lead!));
    expect(lead!.html).not.toMatch(/mailto:/);
    expect(lead!.html).toContain("technology");
    expect(lead!.html).toContain("61");
    expect(lead!.html).toMatch(/Reference: [0-9a-f]{8}\b/);
  });

  it("a failure's performance alert carries no IP", async () => {
    db.rpcs.check_rate_limit = () => { throw new Error("fake: the limiter fell over"); };
    expect((await postLead({ email: ADDRESS, industry: "technology", atsScore: 61 })).status).toBe(500);
    const alert = fetched.find((m) => /save-lead/.test(m.subject));
    expect(alert, "no performance alert was sent").toBeTruthy();
    expect(said(alert!)).not.toContain(IP);
    expect(alert!.html).not.toMatch(/"ip"/);
  });
});

describe("notify-owner's new-account note", () => {
  const post = (body: unknown) => notify(new Request("https://harness.supabase.co/functions/v1/notify-owner", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify(body),
  }));

  it("from the signup trigger says an account was created and when, with no address", async () => {
    expect((await post({ type: "INSERT", record: { email: ADDRESS, created_at: "2026-11-15T09:00:00Z" } })).status).toBe(200);
    expect(resent).toHaveLength(1);
    carriesNone(said(resent[0]));
    expect(resent[0].subject).toMatch(/New account/);
    expect(resent[0].html).toContain("2026-11-15T09:00:00Z");
  });

  it("from a signup note says the same, with no address", async () => {
    expect((await post({ type: "signup", email: ADDRESS })).status).toBe(200);
    expect(resent).toHaveLength(1);
    carriesNone(said(resent[0]));
    expect(resent[0].subject).toMatch(/New account/);
  });
});

describe("the report", () => {
  it("has no weekly-tips box posting an address to save-lead", () => {
    const code = readFileSync(resolve(ROOT, "src/components/FreeKeywordResults.tsx"), "utf8");
    expect(code).not.toMatch(/invoke\(\s*['"]save-lead['"]/);
    expect(code).not.toMatch(/freeScan\.emailCapture\.(title|button|placeholder|subscribed)/);
  });
});
