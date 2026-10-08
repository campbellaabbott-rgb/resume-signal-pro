// @vitest-environment node
/**
 * A CLAIM MAIL NAMES THE COMPANY THE BOARD KNOWS, AND COUNTS THE INBOX.
 *
 * WHAT WAS WRONG (review of 2026-10-04, the 1.15 class in company-claim).
 * Anyone could POST {action:'request'} with no key and choose the recipient
 * (any non-freemail address), the company name (200 characters, printed RAW
 * into the subject and the HTML of a mail from reports@resumebooster.work),
 * and a fresh limiter allowance per request (the limiter was keyed on the
 * FIRST x-forwarded-for hop, which the caller writes). Rotating company tokens
 * re-mailed the same victim past the 10-minute dedupe, and every request
 * mailed the owner as well. The caller's name was also what the domain match
 * compared against, so a domain owner could name the company after their own
 * domain and be auto-verified as its employer.
 *
 * WHAT HOLDS NOW, proved by RUNNING the shipped handler (Resend and the
 * database faked):
 *   - the company in both mails is the board's own name for the token,
 *     escaped; the caller's companyName is never read, and the domain match
 *     compares the board's name;
 *   - the network count uses the platform's address (two forged first hops in
 *     one /24 share it), as a keyed hash; a network gets 10 requests a day, an
 *     inbox 2 verification mails a day whatever company is named, everyone 200
 *     (reaching it tells the owner once); a count that cannot be taken keeps
 *     the door shut;
 *   - the owner's heads-up stops after 20 a day, and escapes what the caller
 *     typed;
 *   - the admin key is compared in constant time.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const ADMIN = "admin_key_for_the_harness_0123456789";
const OWNER = "resumeboostersupp@gmail.com";
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const counts = new Map<string, number>();
let doorError = false;
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", ADMIN_API_KEY: ADMIN };
  g.__claimSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("company-claim", {
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0":
      "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__claimSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

function install() {
  db.rpcs.mail_door_take = (a) => {
    calls.push({ name: "mail_door_take", args: a });
    if (doorError) return { data: null, error: { message: "fake: counter down" } };
    const k = `${a.p_door}|${a.p_bucket}`;
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    return { data: n <= Number(a.p_max), error: null };
  };
  for (const [token, company] of [["acme", "Acme & Co <Ltd>"], ["anthropic", "Anthropic"], ["globex", "Globex"], ["initech", "Initech"]]) {
    // An apply URL on the employer's own domain: since 2026-10-08 the only
    // thing a work email can match (a-cheap-domain-does-not-make-its-owner-an-employer).
    db.rows("job_board_postings").push({ id: `p-${token}`, company_token: token, company, apply_url: `https://careers.${token}.com/jobs/1` });
  }
}

afterEach(() => {
  sent.length = 0; calls.length = 0; counts.clear(); doorError = false;
  db.tables = {}; db.writes = []; db.rpcs = {};
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const HOSTILE = '</b><a href="https://evil.example">Confirm your payroll change</a><b>';
const toClaimant = () => sent.filter((m) => m.to[0] !== OWNER);
const toOwner = () => sent.filter((m) => m.to[0] === OWNER);

describe("the mail carries nothing the caller wrote", () => {
  it("names the board's company, escaped, in the subject and the body; the caller's companyName never appears", async () => {
    install();
    const res = await post({ action: "request", companyToken: "acme", companyName: HOSTILE, workEmail: "CFO@Victim-Corp.com" }, { "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "sent" });
    const [mail] = toClaimant();
    expect(mail.to).toEqual(["cfo@victim-corp.com"]);
    expect(mail.subject).toBe("Verify your claim of Acme & Co <Ltd> on Resume Booster");
    expect(mail.html).toContain("<b>Acme &amp; Co &lt;Ltd&gt;</b>");
    for (const m of sent) {
      expect(m.subject + m.html, `${m.to[0]} got the caller's text`).not.toMatch(/evil\.example|payroll/);
    }
    const insert = db.writes.find((w) => w.table === "company_claims" && w.op === "insert")!.payload as Record<string, unknown>;
    expect(insert.company_name, "the stored name is the board's, so the approval mail is too").toBe("Acme & Co <Ltd>");
  });

  it("the domain match compares the BOARD's name: naming the company after your own domain verifies nothing", async () => {
    install();
    await post({ action: "request", companyToken: "anthropic", companyName: "evilcorp", workEmail: "me@evilcorp.com" });
    const insert = db.writes.find((w) => w.table === "company_claims" && w.op === "insert")!.payload as Record<string, unknown>;
    expect(insert.domain_match, "a caller-chosen name auto-verified a stranger as the company's employer").toBe(false);
    sent.length = 0; db.writes = [];
    await post({ action: "request", companyToken: "anthropic", workEmail: "jane@anthropic.com" });
    expect((db.writes.find((w) => w.op === "insert")!.payload as Record<string, unknown>).domain_match).toBe(true);
  });

  it("the owner's heads-up escapes what the caller typed", async () => {
    install();
    await post({ action: "request", companyToken: "globex", workEmail: "ops@globex.example", contactName: "<img src=x onerror=alert(1)>", website: '"><script>x</script>' });
    const [note] = toOwner();
    expect(note.html).not.toMatch(/<img|<script/);
    expect(note.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("a company the board does not know is refused, and nothing is sent", async () => {
    install();
    const res = await post({ action: "request", companyToken: "nope", companyName: "Nope", workEmail: "a@nope.example" });
    expect(res.status).toBe(404);
    expect(sent).toEqual([]);
  });
});

describe("it counts the network, the inbox and the day", () => {
  it("keys the network on the platform's address, as a keyed hash: two forged first hops in one /24 share a count", async () => {
    install();
    await post({ action: "request", companyToken: "acme", workEmail: "a@acme-a.example" }, { "x-forwarded-for": "6.6.6.6, 198.51.100.7" });
    await post({ action: "request", companyToken: "acme", workEmail: "b@acme-b.example" }, { "x-forwarded-for": "7.7.7.7, 198.51.100.200" });
    const nets = calls.filter((c) => c.args.p_door === "company-claim").map((c) => c.args.p_bucket);
    expect(nets[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(nets[1]).toBe(nets[0]);
    for (const c of calls) expect(JSON.stringify(c.args), "an address reached a counter in the clear").not.toMatch(/198\.51\.100|@acme/);
  });

  it("one inbox gets two verification mails a day, whichever companies are named", async () => {
    install();
    const statuses: number[] = [];
    for (const [i, token] of ["acme", "globex", "initech"].entries()) {
      statuses.push((await post({ action: "request", companyToken: token, workEmail: "victim@corp.example" }, { "cf-connecting-ip": `10.${i}.0.1` })).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(toClaimant()).toHaveLength(2);
  });

  it("a network gets ten requests a day", async () => {
    install();
    for (let i = 0; i < 10; i++) {
      expect((await post({ action: "request", companyToken: "acme", workEmail: `u${i}@corp${i}.example` }, { "cf-connecting-ip": "198.51.100.1" })).status, `request ${i}`).toBe(200);
      // The hourly door (10 calls) is a different count; let only the day's accumulate.
      for (const k of [...counts.keys()]) if (k.startsWith("company-claim|")) counts.set(k, 0);
    }
    const res = await post({ action: "request", companyToken: "acme", workEmail: "u10@corp10.example" }, { "cf-connecting-ip": "198.51.100.2" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/from your network today/);
  });

  it("stops at 200 a day overall, and tells the owner once", async () => {
    install();
    counts.set("company-claim:all|all", 200);
    expect((await post({ action: "request", companyToken: "acme", workEmail: "a@corp-a.example" })).status).toBe(503);
    expect((await post({ action: "request", companyToken: "globex", workEmail: "b@corp-b.example" }, { "cf-connecting-ip": "10.1.1.1" })).status).toBe(503);
    expect(toClaimant()).toEqual([]);
    expect(toOwner()).toHaveLength(1);
    expect(toOwner()[0].subject).toMatch(/company-claim:all: reached its daily ceiling/);
  });

  it("the owner hears about twenty claims a day; past that the claimant is still served", async () => {
    install();
    counts.set("company-claim:owner|all", 20);
    expect((await post({ action: "request", companyToken: "acme", workEmail: "late@corp.example" })).status).toBe(200);
    expect(toClaimant()).toHaveLength(1);
    expect(toOwner()).toEqual([]);
  });

  it("a counter that cannot count keeps the door shut", async () => {
    install();
    doorError = true;
    expect((await post({ action: "request", companyToken: "acme", workEmail: "a@corp.example" })).status).toBe(503);
    expect((await post({ action: "verify", token: "11111111-1111-4111-8111-111111111111" })).status).toBe(503);
    expect(sent).toEqual([]);
  });
});

describe("the rest of the door", () => {
  it("the admin actions refuse a wrong key, and the comparison is constant-time", async () => {
    install();
    expect((await post({ action: "admin-list" }, { "x-admin-key": "wrong" })).status).toBe(401);
    expect((await post({ action: "admin-list" }, { "x-admin-key": ADMIN })).status).toBe(200);
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/company-claim/index.ts"), "utf8");
    expect(src).toMatch(/!sameSecret\(provided, adminApiKey\)/);
    expect(src, "the function reads a forwarding header itself").not.toMatch(/headers\.get\("x-forwarded-for"\)|headers\.get\("x-real-ip"\)/);
  });

  it("the preflight answers its build and lets the admin page send its key header", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/company-claim", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^company-claim\.2026-10-(0[4-9]|[1-3]\d)\.\d+$/);
    expect(res.headers.get("access-control-allow-headers")).toMatch(/x-admin-key/);
  });
});
