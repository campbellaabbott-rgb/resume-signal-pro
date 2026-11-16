// @vitest-environment node
/**
 * A CLAIM MAIL LINKS THE COMPANY PAGE THE HOST SERVES, AND A BOUNCED INBOX IS
 * NOT MAILED AGAIN (S14X-061).
 *
 * WHAT WAS WRONG. Two things in company-claim.
 *   - Both mails built the company page's address by hand, with no trailing
 *     slash. This host reads a dot in the last path segment as a file
 *     extension, so for a dotted token (careers.ulta.com, careers.amd.com)
 *     the verification link and the "you're verified" link both answered a
 *     9-byte "Not found": a claimant on a dotted board could never confirm.
 *     Every other link to a company page asks src/lib/public-href.ts, whose
 *     rule adds the slash.
 *   - A request mailed any typed work address without reading
 *     suppressed_emails, so an address that bounced or complained was mailed
 *     again on every request (two a day), against the provider's sender
 *     reputation rules every other mail door in the repo keeps.
 *
 * WHAT HOLDS NOW, running the shipped handler with the mail provider and the
 * database faked:
 *   - the verification link for a dotted token is the slashed address, with
 *     its token after the slash; the approval mail links the slashed page;
 *   - an address suppressed for a bounce or a complaint is answered "sent"
 *     and nothing is written, counted or sent (the answer reveals nothing a
 *     caller can probe); an unsubscribe does not stop this transactional
 *     mail, and a suppression read that fails falls through to today's path;
 *   - the function's own copy of the slash rule gives exactly what the
 *     React side's gives, for plain, dotted, Workday and escaped tokens;
 *   - company-claim builds no company-page address by hand.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { companyLanderPath as siteLander, publicPath as sitePath } from "@/lib/public-href";
import { companyLanderPath as fnLander, publicPath as fnPath } from "../../supabase/functions/company-claim/public-href";

const ADMIN = "admin_harness_0123456789abcdef";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

describe("the handler", () => {
  const db = new FakeDb();
  let handler: EdgeHandler;
  const sent: Array<{ to: string[]; subject: string; html: string }> = [];
  let taken: string[];

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = {
      SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_0123456789abcdef",
      RESEND_API_KEY: "re_harness", ADMIN_API_KEY: ADMIN,
    };
    g.__ccDb = db;
    g.__ccSend = async (m: { to: string[]; subject: string; html: string }) => { sent.push(m); return { data: { id: "em" }, error: null }; };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    handler = await loadEdgeHandler("company-claim", {
      "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__ccDb;",
      "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: (m) => globalThis.__ccSend(m) }; } }",
    });
  }, 60_000);

  const install = () => {
    taken = [];
    db.rpcs.mail_door_take = (a) => { taken.push(String(a.p_door)); return { data: true, error: null }; };
    db.rpcs.mail_door_give = () => ({ data: true, error: null });
    db.rows("job_board_postings").push({ id: "p-ulta", company_token: "careers.ulta.com", company: "Ulta Beauty", apply_url: "https://careers.ulta.com/careers/jobs/42" });
  };
  afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

  const request = (workEmail = "hr@ulta.com") => handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.61" },
    body: JSON.stringify({ action: "request", companyToken: "careers.ulta.com", workEmail }),
  }));
  const hrefsTo = (to: string) => sent.filter((m) => m.to[0] === to).flatMap((m) => [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]));

  it("the verification link for a dotted token is the slashed address the host serves, with the token after the slash", async () => {
    install();
    const res = await request();
    expect(await res.json()).toEqual({ status: "sent" });
    const links = hrefsTo("hr@ulta.com");
    expect(links, "no verification link was mailed").toHaveLength(1);
    expect(links[0]).toMatch(new RegExp(`^https://resumebooster\\.work/jobs/company/careers\\.ulta\\.com/\\?claim_verify=${UUID.source}$`));
    const token = db.rows("company_claims")[0].verify_token;
    expect(links[0].endsWith(`?claim_verify=${token}`), "the link carries another token than the claim's").toBe(true);
  });

  it("the approval mail links the slashed company page", async () => {
    install();
    db.rows("company_claims").push({ id: "0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a", company_token: "careers.ulta.com", company_name: "Ulta Beauty", work_email: "hr@ulta.com", status: "email_confirmed", verified_at: null });
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
      method: "POST", headers: { "content-type": "application/json", "x-admin-key": ADMIN },
      body: JSON.stringify({ action: "admin-decide", id: "0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a", decision: "verified" }),
    }));
    expect(await res.json()).toEqual({ status: "verified" });
    expect(hrefsTo("hr@ulta.com")).toEqual(["https://resumebooster.work/jobs/company/careers.ulta.com/"]);
  });

  for (const reason of ["bounce", "complaint"]) {
    it(`an address suppressed for a ${reason} is answered sent, and nothing is written, counted or mailed`, async () => {
      install();
      db.rows("suppressed_emails").push({ email: "hr@ulta.com", reason });
      const res = await request();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "sent" });
      expect(sent, `an inbox that ${reason === "bounce" ? "bounced" : "complained"} was mailed again`).toEqual([]);
      expect(taken.filter((d) => d !== "company-claim"), "a suppressed address spent the network's, the inbox's or the day's count").toEqual([]);
      expect(db.writes.filter((w) => w.table === "company_claims"), "a suppressed address left a claim row").toEqual([]);
    });
  }

  it("an unsubscribe does not stop this transactional mail", async () => {
    install();
    db.rows("suppressed_emails").push({ email: "hr@ulta.com", reason: "unsubscribe" });
    expect(await (await request()).json()).toEqual({ status: "sent" });
    expect(hrefsTo("hr@ulta.com")).toHaveLength(1);
  });

  it("a suppression read that fails falls through to today's path, still bounded by the inbox's count", async () => {
    install();
    db.faults.push({ table: "suppressed_emails", op: "select", error: { message: "timeout" } });
    expect(await (await request()).json()).toEqual({ status: "sent" });
    expect(hrefsTo("hr@ulta.com")).toHaveLength(1);
    expect(taken).toContain("company-claim:recipient");
  });
});

describe("the function's copy of the slash rule", () => {
  const TOKENS = ["acme", "careers.ulta.com", "careers.amd.com", "nvidia~wd5~NVIDIAExternalCareerSite", "acme%2Fus", "a b", "x.y/z"];

  it("gives exactly what the site's rule gives, for every kind of token, with and without a query", () => {
    for (const t of TOKENS) {
      expect(fnLander(t), t).toBe(siteLander(t));
      expect(fnLander(t, "claim_verify=abc"), t).toBe(siteLander(t, "claim_verify=abc"));
      expect(fnLander(t, "?from=mail"), t).toBe(siteLander(t, "?from=mail"));
    }
    for (const p of ["/jobs/company/careers.ulta.com", "/jobs/company/acme?x=1", "/a.b#c", "/plain"]) expect(fnPath(p), p).toBe(sitePath(p));
    expect(fnLander("careers.ulta.com", "claim_verify=abc")).toBe("/jobs/company/careers.ulta.com/?claim_verify=abc");
  });

  it("company-claim builds no company-page address by hand", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/company-claim/index.ts"), "utf8");
    expect(src.includes("/jobs/company/${"), "a hand-built company-page address skips the slash rule").toBe(false);
    expect(src).toMatch(/companyLanderPath\(/);
  });
});
