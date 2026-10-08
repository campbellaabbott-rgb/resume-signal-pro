// @vitest-environment node
/**
 * A CHEAP DOMAIN DOES NOT MAKE ITS OWNER AN EMPLOYER (wave 2 email-ops,
 * register L13-06, the residue of 1.16; and L10-12).
 *
 * WHAT WAS WRONG. company-claim auto-verified a claim when the work-email
 * domain's label and the board's token or name were substrings of each other,
 * in either direction, with a three-character floor. A scratch run of the
 * shipped function returned true for x@nth.io -> Anthropic,
 * hr@anthropic-careers.com -> Anthropic, and hr@dbank.xyz and x@careers.io ->
 * TD Bank (td~wd3~TD_Bank_Careers). Verification promotes straight to the
 * "Verified employer" badge, and get_company_claim_status handed the
 * claimant's own website to every visitor beside it: a job-scam funnel under
 * our badge. Separately, the 10-minute no-resend guard keyed on created_at,
 * which a repeat never refreshed, so after a row's first 10 minutes every
 * request re-sent the verification mail.
 *
 * WHAT HOLDS NOW, by running the shipped handler (Resend and the database
 * faked) and applying the migration to pglite:
 *   - a claim verifies on its own only when the email's REGISTRABLE domain is
 *     exactly the registrable domain of a host the board links to for that
 *     company, and never an applicant-tracking system's;
 *   - every other claim waits for the owner (email_confirmed);
 *   - the website shows only once the owner approves; a revoke withdraws it;
 *   - a repeat request re-sends only 10 minutes after the LAST send.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { domainProven, employerDomains, registrableDomain } from "../../supabase/functions/company-claim/domain-proof";
import { bootEmailOpsDb, migration, rows } from "./helpers/email-ops-db";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const ADMIN = "admin_key_for_the_harness_0123456789";
const OWNER = "resumeboostersupp@gmail.com";
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", ADMIN_API_KEY: ADMIN };
  g.__ccSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("company-claim", {
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0":
      "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__ccSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

function install() {
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
  for (const [token, company, url] of [
    ["anthropic", "Anthropic", "https://job-boards.greenhouse.io/anthropic/jobs/1"],
    ["td~wd3~TD_Bank_Careers", "TD Bank", "https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/1"],
    ["savills", "Savills", "https://careers.savills.co.uk/jobs/42"],
  ]) db.rows("job_board_postings").push({ id: `p-${token}`, company_token: token, company, apply_url: url });
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", ...headers }, body: JSON.stringify(body),
  }));
const claimFor = (token: string, email: string) => db.rows("company_claims").find((r) => r.company_token === token && r.work_email === email)!;

describe("the domain proof", () => {
  it("reads registrable domains, country second levels included", () => {
    expect(registrableDomain("careers.savills.co.uk")).toBe("savills.co.uk");
    expect(registrableDomain("WWW.Anthropic.com.")).toBe("anthropic.com");
    expect(registrableDomain("td.wd3.myworkdayjobs.com")).toBe("myworkdayjobs.com");
    expect(registrableDomain("not a host")).toBe("");
  });

  it("the register's four domains prove nothing, and an applicant-tracking host proves nothing either", () => {
    const anthropic = employerDomains(["https://job-boards.greenhouse.io/anthropic/jobs/1"]);
    const td = employerDomains(["https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/1"]);
    expect(anthropic.size, "an ATS domain counted as the employer's").toBe(0);
    for (const [email, domains] of [["x@nth.io", anthropic], ["hr@anthropic-careers.com", anthropic], ["hr@dbank.xyz", td], ["x@careers.io", td], ["recruiter@greenhouse.io", anthropic]] as const) {
      expect(domainProven(email, domains), email).toBe(false);
    }
  });

  it("an address at the employer's own careers domain is proven, and only that domain", () => {
    const savills = employerDomains(["https://careers.savills.co.uk/jobs/42", null, "not a url"]);
    expect([...savills]).toEqual(["savills.co.uk"]);
    expect(domainProven("hr@savills.co.uk", savills)).toBe(true);
    expect(domainProven("hr@mail.savills.co.uk", savills)).toBe(true);
    expect(domainProven("hr@savills-careers.co.uk", savills)).toBe(false);
    expect(domainProven("hr@savills.com", savills)).toBe(false);
  });
});

describe("the handler", () => {
  it("every one of the register's addresses waits for the owner, even after its link is clicked", async () => {
    install();
    for (const [token, email] of [["anthropic", "x@nth.io"], ["anthropic", "hr@anthropic-careers.com"], ["td~wd3~TD_Bank_Careers", "hr@dbank.xyz"], ["td~wd3~TD_Bank_Careers", "x@careers.io"]]) {
      expect((await post({ action: "request", companyToken: token, workEmail: email })).status, email).toBe(200);
      const claim = claimFor(token, email);
      expect(claim.domain_match, `${email} auto-verified as ${token}`).toBe(false);
      expect(await (await post({ action: "verify", token: claim.verify_token })).json()).toEqual({ status: "email_confirmed" });
    }
  });

  it("an address at a domain the board links to for the company verifies on its click", async () => {
    install();
    await post({ action: "request", companyToken: "savills", workEmail: "hr@savills.co.uk", website: "https://savills.co.uk" });
    const claim = claimFor("savills", "hr@savills.co.uk");
    expect(claim.domain_match).toBe(true);
    expect(await (await post({ action: "verify", token: claim.verify_token })).json()).toEqual({ status: "verified" });
  });

  it("a claim still pending from the old rule is not verified by the flag that rule stored", async () => {
    install();
    // Requested before the deploy: the substring rule wrote domain_match = true.
    db.rows("company_claims").push({ id: "33333333-3333-4333-8333-333333333333", company_token: "anthropic", work_email: "x@nth.io", status: "pending", domain_match: true, verify_token: "44444444-4444-4444-8444-444444444444", created_at: "2026-10-01T00:00:00Z" });
    expect(await (await post({ action: "verify", token: "44444444-4444-4444-8444-444444444444" })).json(),
      "a pre-deploy pending claim's stored flag made x@nth.io a Verified employer of Anthropic").toEqual({ status: "email_confirmed" });
    const row = db.rows("company_claims")[0];
    expect(row.status).toBe("email_confirmed");
    expect(row.verified_at ?? null).toBeNull();
    expect(row.domain_match, "the owner's review list still said the domain matched").toBe(false);
  });

  it("a pending claim the board's hosts do prove verifies at its click even if the row said otherwise", async () => {
    install();
    db.rows("company_claims").push({ id: "55555555-5555-4555-8555-555555555555", company_token: "savills", work_email: "hr@savills.co.uk", status: "pending", domain_match: false, verify_token: "66666666-6666-4666-8666-666666666666", created_at: "2026-10-01T00:00:00Z" });
    expect(await (await post({ action: "verify", token: "66666666-6666-4666-8666-666666666666" })).json()).toEqual({ status: "verified" });
    expect(db.rows("company_claims")[0].domain_match).toBe(true);
  });

  it("a board that cannot be read at the click verifies nothing and promotes nothing", async () => {
    install();
    db.rows("company_claims").push({ id: "77777777-7777-4777-8777-777777777777", company_token: "savills", work_email: "hr@savills.co.uk", status: "pending", domain_match: true, verify_token: "88888888-8888-4888-8888-888888888888", created_at: "2026-10-01T00:00:00Z" });
    db.faults.push({ table: "job_board_postings", op: "select", error: { message: "statement timeout" } });
    const res = await post({ action: "verify", token: "88888888-8888-4888-8888-888888888888" });
    expect(res.status).toBe(503);
    expect(db.rows("company_claims")[0].status).toBe("pending");
  });

  it("the owner's approval is what shows the website; a revoke withdraws it", async () => {
    install();
    db.rows("company_claims").push({ id: "11111111-1111-4111-8111-111111111111", company_token: "savills", work_email: "hr@savills.co.uk", status: "verified", verified_at: "2026-10-01T00:00:00Z", owner_approved_at: null, company_name: "Savills" });
    const approve = await post({ action: "admin-decide", id: "11111111-1111-4111-8111-111111111111", decision: "verified" }, { "x-admin-key": ADMIN });
    expect(approve.status).toBe(200);
    expect(db.rows("company_claims")[0].owner_approved_at).toEqual(expect.any(String));
    expect(db.rows("company_claims")[0].verified_at, "re-approving kept its verification date").toBe("2026-10-01T00:00:00Z");
    expect(sent.filter((m) => m.to[0] === "hr@savills.co.uk"), "an already-verified claimant is not mailed again").toEqual([]);
    await post({ action: "admin-decide", id: "11111111-1111-4111-8111-111111111111", decision: "rejected" }, { "x-admin-key": ADMIN });
    expect(db.rows("company_claims")[0].owner_approved_at).toBeNull();
  });
});

describe("L10-12: the resend cooldown runs from the last send", () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  it("a row made an hour ago and mailed two minutes ago is not mailed again", async () => {
    install();
    db.rows("company_claims").push({ id: "c1", company_token: "savills", work_email: "hr@savills.co.uk", status: "pending", verify_token: "22222222-2222-4222-8222-222222222222", created_at: minutesAgo(60), last_sent_at: minutesAgo(2) });
    expect(await (await post({ action: "request", companyToken: "savills", workEmail: "hr@savills.co.uk" })).json()).toEqual({ status: "sent" });
    expect(sent.filter((m) => m.to[0] !== OWNER), "the guard read created_at, so every request after ten minutes re-sent").toEqual([]);
  });

  it("past the cooldown it sends once, stamps the send, and keeps the board's name it was made with", async () => {
    install();
    db.rows("company_claims").push({ id: "c1", company_token: "savills", work_email: "hr@savills.co.uk", status: "pending", company_name: "Savills plc", verify_token: "22222222-2222-4222-8222-222222222222", created_at: minutesAgo(60), last_sent_at: minutesAgo(20) });
    await post({ action: "request", companyToken: "savills", workEmail: "hr@savills.co.uk" });
    expect(sent.filter((m) => m.to[0] === "hr@savills.co.uk")).toHaveLength(1);
    const row = db.rows("company_claims")[0];
    expect(Date.now() - Date.parse(String(row.last_sent_at))).toBeLessThan(5_000);
    expect(row.company_name).toBe("Savills plc");
    sent.length = 0;
    await post({ action: "request", companyToken: "savills", workEmail: "hr@savills.co.uk" });
    expect(sent.filter((m) => m.to[0] === "hr@savills.co.uk")).toEqual([]);
  });
});

describe("the status reader, applied to pglite (20261008122000)", () => {
  it("hands out the badge for a verified claim and its website only once the owner approved it", async () => {
    const pg = await bootEmailOpsDb({ apply: ["20261008122000"] });
    await pg.exec(`INSERT INTO public.company_claims (company_token, work_email, website, status, verified_at)
                   VALUES ('acme', 'hr@acme.example', 'https://evil.example', 'verified', now())`);
    const before = await rows<{ s: Record<string, unknown> }>(pg, "SELECT public.get_company_claim_status('acme') AS s");
    expect(before[0].s).toMatchObject({ verified: true });
    expect(before[0].s.website ?? null, "an unapproved claimant's link reached the company page").toBeNull();
    await pg.exec("UPDATE public.company_claims SET owner_approved_at = now() WHERE company_token = 'acme'");
    const after = await rows<{ s: Record<string, unknown> }>(pg, "SELECT public.get_company_claim_status('acme') AS s");
    expect(after[0].s.website).toBe("https://evil.example");
    const acl = await rows<{ anon: boolean }>(pg, "SELECT has_function_privilege('anon', 'public.get_company_claim_status(text)', 'EXECUTE') AS anon");
    expect(acl[0].anon, "the badge reader is a public record and stays callable").toBe(true);
    await pg.exec(migration("20261008122000"));
  }, 60_000);
});
