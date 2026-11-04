// @vitest-environment node
/**
 * A LEAD ALERT HAS A CEILING, AND THE LOOKUP WAITS FOR THE LIMIT (audit
 * 2026-10-31, S13-067).
 *
 * WHAT WAS WRONG. save-lead answers anyone and mails the owner for every lead.
 * Its one bound was ten an hour per raw address, and the lead table's upsert
 * means repeating one address never reaches its row cap, so a proxy pool POSTing
 * one fabricated address sent 10 x N mails an hour through the Resend key that
 * purchase and receipt mail share. Before any of that, every request, even a
 * malformed one, cost a lookup on the ipinfo quota the scanner shares.
 *
 * WHAT HOLDS NOW, running the shipped handler with the network and the database
 * faked:
 *   - one address alerts at most once a day however many networks repeat it;
 *   - all addresses together alert at most twenty times an hour, and past that
 *     the owner hears so once, while every lead is still saved;
 *   - a counter that cannot answer leaves the alert as it was, so it goes (a gate
 *     on mail defaults to today's behaviour), and the lead is saved;
 *   - the limit counts a network, as a keyed hash, not an address;
 *   - a malformed body, a bad address and a limited caller cost no lookup, and
 *     a blocked country is still refused, behind the limit.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const db = new FakeDb();
type Mail = { subject: string; html: string; to: string[] };
const mails: Mail[] = [];
const lookups: string[] = [];
const pending: Promise<unknown>[] = [];
const counts = new Map<string, number>();
const saved: string[] = [];
let limitedBy: unknown[] = [];
let limited = false;
let doorDown = false;
let country = "US";
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", RESEND_API_KEY: "re_x", IPINFO_API_KEY: "ipinfo_x" };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  g.__slDb = db;
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("api.resend.com")) { mails.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200 }); }
    if (u.includes("ipinfo.io")) { lookups.push(u); return new Response(JSON.stringify({ country }), { status: 200 }); }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("save-lead", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__slDb;",
  });
}, 60_000);

beforeEach(() => {
  mails.length = 0; lookups.length = 0; pending.length = 0; counts.clear(); saved.length = 0;
  limitedBy = []; limited = false; doorDown = false; country = "US";
  db.tables = {}; db.writes = [];
  db.rpcs = {
    check_rate_limit: (a) => { limitedBy.push(a.p_ip); return { data: !limited, error: null }; },
    save_free_scan_lead: (a) => { saved.push(String(a.p_email)); return { data: null, error: null }; },
    mail_door_take: (a) => {
      if (doorDown) return { data: null, error: { message: "fake: counter down" } };
      const k = `${a.p_door}|${a.p_bucket}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return { data: n <= Number(a.p_max), error: null };
    },
  };
});
afterEach(() => { (globalThis as Record<string, unknown>).__edgeLast = undefined; });

const post = async (body: unknown, ip = "203.0.113.9", raw = false) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/save-lead", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: raw ? String(body) : JSON.stringify(body),
  }));
  while (pending.length) await pending.shift();
  return res;
};
const leadMails = () => mails.filter((m) => /NEW LEAD/.test(m.subject));

describe("the owner's lead alert is bounded", () => {
  it("one address repeated from many networks alerts once and is saved each time", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await post({ email: "a@corp.example.com" }, `198.51.${i}.7`)).status).toBe(200);
    }
    expect(saved).toHaveLength(30);
    expect(leadMails(), "a proxy pool repeated one address into the owner's inbox").toHaveLength(1);
  });

  it("the address's bucket is a keyed hash, whatever its case", async () => {
    await post({ email: "A@Corp.Example.com" });
    await post({ email: "a@corp.example.com" });
    expect(leadMails()).toHaveLength(1);
    const buckets = [...counts.keys()].filter((k) => k.startsWith("save-lead:owner-address|")).map((k) => k.split("|")[1]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("many addresses stop at twenty an hour, every lead is saved, and the owner hears once", async () => {
    for (let i = 0; i < 30; i++) await post({ email: `lead${i}@corp.example.com` }, `198.51.${i}.7`);
    expect(saved).toHaveLength(30);
    expect(leadMails()).toHaveLength(20);
    const notice = mails.filter((m) => /hourly ceiling/.test(m.subject));
    expect(notice, "the owner was not told the alerts stopped, or was told more than once").toHaveLength(1);
    expect(notice[0].html).toMatch(/still saved/);
  });

  it("the doors' windows are a day for an address and an hour for all", async () => {
    const taken: unknown[][] = [];
    const real = db.rpcs.mail_door_take;
    db.rpcs.mail_door_take = (a) => { taken.push([a.p_door, a.p_max, a.p_window_minutes]); return real(a); };
    await post({ email: "lead@corp.example.com" });
    expect(taken).toEqual([["save-lead:owner-address", 1, 1440], ["save-lead:owner", 20, 60]]);
  });

  it("a counter that cannot answer leaves the alert as it was: it goes, and the lead is saved and answered", async () => {
    doorDown = true;
    const res = await post({ email: "lead@corp.example.com" });
    expect(res.status).toBe(200);
    expect(saved).toEqual(["lead@corp.example.com"]);
    expect(leadMails()).toHaveLength(1);
  });

  it("a database with no door function yet behaves as before the doors", async () => {
    delete db.rpcs.mail_door_take;
    const res = await post({ email: "lead@corp.example.com" });
    expect(res.status).toBe(200);
    expect(saved).toEqual(["lead@corp.example.com"]);
    expect(leadMails()).toHaveLength(1);
  });

  it("a ceiling notice whose door cannot answer is not sent, and the lead is still saved", async () => {
    for (let i = 0; i < 20; i++) await post({ email: `lead${i}@corp.example.com` }, `198.51.${i}.7`);
    const real = db.rpcs.mail_door_take;
    db.rpcs.mail_door_take = (a) => (a.p_door === "owner-alert" ? { data: null, error: { message: "fake: down" } } : real(a));
    const res = await post({ email: "one-more@corp.example.com" }, "198.51.21.7");
    expect(res.status).toBe(200);
    expect(saved).toContain("one-more@corp.example.com");
    expect(mails.filter((m) => /hourly ceiling/.test(m.subject))).toEqual([]);
    expect(leadMails()).toHaveLength(20);
  });
});

describe("the limit and the lookup", () => {
  it("the limit counts a network: two addresses in one /24 share a bucket that names neither", async () => {
    await post({ email: "a@corp.example.com" }, "198.51.100.7");
    await post({ email: "b@corp.example.com" }, "198.51.100.200");
    await post({ email: "c@corp.example.com" }, "198.51.101.7");
    expect(limitedBy[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(limitedBy[1]).toBe(limitedBy[0]);
    expect(limitedBy[2]).not.toBe(limitedBy[0]);
  });

  it("a malformed body is a 400 with no lookup, no alert and no count", async () => {
    const res = await post("{not json", "192.0.2.80", true);
    expect(res.status).toBe(400);
    expect(lookups).toEqual([]);
    expect(mails).toEqual([]);
    expect(limitedBy).toEqual([]);
  });

  it("a body that is not an object is a 400 too", async () => {
    for (const body of ["[1,2]", "null", "7", '"a@b.co"']) {
      expect((await post(body, "192.0.2.81", true)).status, body).toBe(400);
    }
    expect(lookups).toEqual([]);
    expect(mails).toEqual([]);
  });

  it("an address that is not a string is refused, not thrown on", async () => {
    expect((await post({ email: ["a@corp.example.com"] })).status).toBe(400);
    expect(mails).toEqual([]);
  });

  it("a bad address costs no lookup", async () => {
    expect((await post({ email: "nope" }, "192.0.2.79")).status).toBe(400);
    expect(lookups).toEqual([]);
  });

  it("a honeypot that is not a string is still a filled honeypot", async () => {
    const res = await post({ email: "a@corp.example.com", honeypot: 7 }, "192.0.2.82");
    expect(res.status).toBe(200);
    expect(saved).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("a limited caller costs no lookup", async () => {
    limited = true;
    expect((await post({ email: "a@corp.example.com" }, "192.0.2.78")).status).toBe(429);
    expect(lookups).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("a blocked country is still refused, and saves nothing", async () => {
    country = "RU";
    // An address of its own: the function caches a lookup per address.
    const res = await post({ email: "a@corp.example.com" }, "192.0.2.77");
    expect(lookups).toHaveLength(1);
    expect(res.status).toBe(403);
    expect(saved).toEqual([]);
    expect(leadMails()).toEqual([]);
  });

  it("an alert that goes spends one lookup on its address, the same one the geo check made", async () => {
    await post({ email: "one@corp.example.com" }, "192.0.2.83");
    expect(lookups).toHaveLength(1);
    expect(leadMails()).toHaveLength(1);
    expect(leadMails()[0].subject).toContain("US");
  });

  it("a limit the database could not answer still saves the lead, as it always has, and the doors bound the mail", async () => {
    db.rpcs.check_rate_limit = () => ({ data: null, error: { message: "fake: down" } });
    for (let i = 0; i < 3; i++) expect((await post({ email: "a@corp.example.com" })).status).toBe(200);
    expect(saved).toHaveLength(3);
    expect(leadMails()).toHaveLength(1);
  });
});
