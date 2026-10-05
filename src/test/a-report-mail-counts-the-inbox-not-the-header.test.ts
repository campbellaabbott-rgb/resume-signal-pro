// @vitest-environment node
/**
 * A REPORT MAIL COUNTS THE INBOX, NOT THE HEADER.
 *
 * WHAT WAS WRONG. send-scan-report ("email me my report") cannot ask for a
 * session -- the free scan has none -- and it sends from our verified domain to
 * whatever address the body names, with sentences the body supplies. Its one
 * bound was 12 an hour per FIRST x-forwarded-for hop, which the caller writes,
 * so a fresh header was a fresh allowance: unlimited mail to any inbox, plus a
 * four-mail drip per request. A ticked pulse box also wrote the address into
 * the market-pulse list, for any address anyone typed (defect sweep 1.59).
 *
 * WHAT HOLDS NOW, proved by RUNNING the shipped handler (Resend and the
 * database faked) and by applying migration 20261004100000 to pglite:
 *   - the network count is keyed on the platform's address (two forged first
 *     hops in one /24 share it), the recipient count on a keyed hash of the
 *     address (3 a day), and a daily ceiling caps everyone (reaching it tells
 *     the owner, once); a count that cannot be taken keeps the door shut;
 *   - a suppressed address gets nothing, and the same answer as anyone else;
 *     the pulse list is never written;
 *   - a SENTENCE reaches the mail only under free-keyword-scan's seal: the
 *     scanner seals what it returns, the page forwards the seal, and a request
 *     without it (or with any sentence changed, or a seal older than a week)
 *     gets the numbers only, no drip, and a ceiling of its own;
 *   - ONE SEALED REPORT IS NOT A MAILING LIST (review of 2026-10-04): a report
 *     id is mailed at most three times a month, whichever addresses and
 *     networks ask, and the replay never draws on the day's ceiling;
 *   - the verdict line is built from numbers: the scanner's verdict carried
 *     the model's reading of the resume's job title, which a resume's author
 *     can make say "account suspended, call ...";
 *   - every number is clamped, every sentence clipped and stripped of links,
 *     bare domains, e-mail addresses and phone numbers, and all of it escaped;
 *   - THE FIX-PLAN SEQUENCE NEEDS ITS OWN CLICK: a ticked box only puts a
 *     button in the report mail; the sequence is queued when the inbox's owner
 *     presses it (confirm-drip), at most once a month per address;
 *   - mail_door_take is atomic, holds its window, and its sweep never crosses
 *     into another door.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bootMailDoorDb, rows } from "./helpers/mail-door-db";
import { attachScanMailSeal, sealScanMail, scanMailSealValid } from "../../supabase/functions/_shared/scan-mail-seal";
import { mailSafeText } from "../../supabase/functions/_shared/mail-text";
import { openDripLink, signDripLink } from "../../supabase/functions/_shared/scan-drip-link";

// ── 1. the counter, in SQL ───────────────────────────────────────────────────

describe("mail_door_take, applied to pglite", () => {
  let pg: PGlite;
  beforeAll(async () => { pg = await bootMailDoorDb(); }, 120_000);
  const take = async (door: string, bucket: string, max: number, mins: number) =>
    (await rows<{ ok: boolean }>(pg, "SELECT public.mail_door_take($1, $2, $3, $4) AS ok", [door, bucket, max, mins]))[0].ok;

  it("lets in exactly max knocks per window, per door and bucket", async () => {
    expect([await take("d1", "b", 2, 60), await take("d1", "b", 2, 60), await take("d1", "b", 2, 60)]).toEqual([true, true, false]);
    expect(await take("d1", "other-bucket", 2, 60), "another bucket has its own count").toBe(true);
    expect(await take("d2", "b", 2, 60), "another door has its own count").toBe(true);
  });

  it("starts a window again once it has ended, and not before", async () => {
    await take("d3", "b", 1, 60);
    expect(await take("d3", "b", 1, 60)).toBe(false);
    await pg.query("UPDATE public.mail_door_counts SET window_start = now() - interval '59 minutes' WHERE door = 'd3'");
    expect(await take("d3", "b", 1, 60), "a window of an hour ended after 59 minutes").toBe(false);
    await pg.query("UPDATE public.mail_door_counts SET window_start = now() - interval '61 minutes' WHERE door = 'd3'");
    expect(await take("d3", "b", 1, 60)).toBe(true);
  });

  it("holds a day: a short-window door's sweep never deletes a long window's row", async () => {
    await take("long", "b", 1, 1440);
    await pg.query("UPDATE public.mail_door_counts SET window_start = now() - interval '3 hours' WHERE door = 'long'");
    // Force the sweep: knock on a one-minute door until random() < 0.02 has
    // surely fired, then look for the day-long row.
    for (let i = 0; i < 400; i++) await take("short", `b${i}`, 5, 1);
    expect(await take("long", "b", 1, 1440), "the day-long count was reset by another door's sweep").toBe(false);
  });

  it("refuses arguments outside its bounds, and no client role can call it or read its table", async () => {
    await expect(take("", "b", 1, 60)).rejects.toThrow(/invalid arguments/);
    await expect(take("d", "b", 0, 60)).rejects.toThrow(/invalid arguments/);
    await expect(take("d", "b", 1, 43201)).rejects.toThrow(/invalid arguments/);
    const r = await rows<{ anon: boolean; auth: boolean; svc: boolean; sel: boolean }>(pg, `
      SELECT has_function_privilege('anon', 'public.mail_door_take(text,text,integer,integer)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.mail_door_take(text,text,integer,integer)', 'EXECUTE') AS auth,
             has_function_privilege('service_role', 'public.mail_door_take(text,text,integer,integer)', 'EXECUTE') AS svc,
             has_table_privilege('anon', 'public.mail_door_counts', 'SELECT') AS sel`);
    expect(r[0]).toEqual({ anon: false, auth: false, svc: true, sel: false });
  });

  it("the self-check's probe leaves no row behind", async () => {
    expect(await rows(pg, "SELECT 1 FROM public.mail_door_counts WHERE door LIKE 'self-check:%'")).toEqual([]);
  });
});

// ── 2. the handler ───────────────────────────────────────────────────────────

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const OWNER = "resumeboostersupp@gmail.com";
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const counts = new Map<string, number>();
let doorError = false;
let handler: EdgeHandler;

function installRpcs() {
  db.rpcs.mail_door_take = (a) => {
    calls.push({ name: "mail_door_take", args: a });
    if (doorError) return { data: null, error: { message: "fake: counter down" } };
    const k = `${a.p_door}|${a.p_bucket}`;
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    return { data: n <= Number(a.p_max), error: null };
  };
  db.rpcs.save_free_scan_lead = (a) => { calls.push({ name: "save_free_scan_lead", args: a }); return { data: null, error: null }; };
  db.rpcs.enqueue_email_delayed = (a) => { calls.push({ name: "enqueue_email_delayed", args: a }); return { data: 1, error: null }; };
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__reportSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-scan-report", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0":
      "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__reportSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

afterEach(() => {
  sent.length = 0; calls.length = 0; counts.clear(); doorError = false;
  db.tables = {}; db.writes = []; db.rpcs = {};
});

const UNSEALED_REPORT = {
  score: 64,
  projectedScore: 81,
  scoreBreakdown: { keywords: 55, format: 80, quantification: 60 },
  peerPercentile: 42,
  applicationPassRate: 38,
  findingsSummary: { critical: 2, warnings: 3, passed: 9 },
  redFlags: [{ issue: "No metrics in the last two roles" }],
  fixRoadmap: { steps: [{ order: 1, step: "Add numbers to each bullet", minutes: 10, scoreImpact: 6 }], totalMinutes: 25 },
  industry: "technology",
  reportId: "A1B2C3D4E5F6",
};
/** A report with the seal free-keyword-scan would have given it (fresh, under the harness key). */
const sealedAs = async <T extends Record<string, unknown>>(r: T, issuedAtS?: number) =>
  ({ ...r, mailSeal: await sealScanMail(SERVICE, r, issuedAtS) });
let REPORT: typeof UNSEALED_REPORT & { mailSeal: string };
beforeAll(async () => { REPORT = await sealedAs(UNSEALED_REPORT); });
/** The same report under another report id, sealed: a different scan. */
const another = (i: number) => sealedAs({ ...UNSEALED_REPORT, reportId: `R${String(i).padStart(9, "0")}` });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const toVictims = () => sent.filter((m) => m.to[0] !== OWNER);

describe("send-scan-report is bounded per network, per inbox, per report and per day", () => {
  it("serves a real report, once, to the address given", async () => {
    installRpcs();
    const res = await post({ email: " Jane@Example.com ", ...REPORT }, { "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["jane@example.com"]);
    expect(sent[0].subject).toBe("Your resume scored 64/100 — here's your fix plan");
    expect(sent[0].html).toMatch(/Add numbers to each bullet/);
    expect(sent[0].html).toMatch(/rid=A1B2C3D4E5F6/);
    const doors = calls.filter((c) => c.name === "mail_door_take").map((c) => [c.args.p_door, c.args.p_max, c.args.p_window_minutes]);
    expect(doors).toEqual([
      ["send-scan-report", 12, 60],
      ["send-scan-report:recipient", 3, 1440],
      ["send-scan-report:report", 3, 30 * 1440],
      ["send-scan-report:all", 300, 1440],
    ]);
  });

  it("keys the network on the platform's address: two forged first hops in one /24 share a count", async () => {
    installRpcs();
    await post({ email: "a@example.com", ...REPORT }, { "x-forwarded-for": "6.6.6.6, 198.51.100.7" });
    await post({ email: "b@example.com", ...REPORT }, { "x-forwarded-for": "7.7.7.7, 198.51.100.200" });
    const nets = calls.filter((c) => c.args.p_door === "send-scan-report").map((c) => c.args.p_bucket);
    expect(nets[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(nets[1]).toBe(nets[0]);
    for (const c of calls.filter((x) => x.name === "mail_door_take")) {
      expect(JSON.stringify(c.args), "an address or a report id reached a counter in the clear").not.toMatch(/198\.51\.100|@example\.com|A1B2C3D4E5F6/);
    }
  });

  it("the thirteenth request from one network in an hour is refused, and nothing is sent", async () => {
    installRpcs();
    for (let i = 0; i < 12; i++) expect((await post({ email: `u${i}@example.com`, ...(await another(i)) }, { "cf-connecting-ip": "198.51.100.1" })).status).toBe(200);
    sent.length = 0;
    expect((await post({ email: "u13@example.com", ...(await another(13)) }, { "cf-connecting-ip": "198.51.100.99" })).status).toBe(429);
    expect(sent).toEqual([]);
  });

  it("one inbox gets three reports a day, however many networks ask", async () => {
    installRpcs();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post({ email: "victim@example.com", ...(await another(i)) }, { "cf-connecting-ip": `10.${i}.0.1` })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(sent).toHaveLength(3);
    const res = await post({ email: "VICTIM@example.com", ...(await another(9)) }, { "cf-connecting-ip": "10.9.0.1" });
    expect(res.status, "the same inbox spelled in capitals is the same inbox").toBe(429);
    expect(await res.json()).toMatchObject({ success: false, error: expect.stringMatching(/several reports today/) });
  });

  it("stops at the day's ceiling, and tells the owner once", async () => {
    installRpcs();
    counts.set("send-scan-report:all|all", 300);
    expect((await post({ email: "late@example.com", ...REPORT })).status).toBe(503);
    expect((await post({ email: "later@example.com", ...(await another(1)) })).status).toBe(503);
    expect(toVictims()).toEqual([]);
    const alerts = sent.filter((m) => m.to[0] === OWNER);
    expect(alerts, "one alert a day, however many are refused").toHaveLength(1);
    expect(alerts[0].subject).toMatch(/send-scan-report:all: reached its daily ceiling/);
  });

  it("a counter that cannot count keeps the door shut", async () => {
    installRpcs();
    doorError = true;
    expect((await post({ email: "x@example.com", ...REPORT })).status).toBe(503);
    expect(sent).toEqual([]);
    expect(calls.some((c) => c.name === "save_free_scan_lead")).toBe(false);
  });

  it("never mails an address that opted out, bounced or complained -- and does not say so", async () => {
    installRpcs();
    db.rows("suppressed_emails").push({ email: "gone@example.com", reason: "complaint" });
    const res = await post({ email: "Gone@Example.com", ...REPORT, dripOptIn: true });
    // The ordinary answer: a distinct one would let anyone test any address
    // against the suppression list.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toEqual([]);
    expect(calls.some((c) => c.name === "enqueue_email_delayed")).toBe(false);
    expect(calls.some((c) => c.name === "save_free_scan_lead")).toBe(false);
  });

  it("the suppression list is asked last, so no count's refusal tells a suppressed address from another", async () => {
    installRpcs();
    db.rows("suppressed_emails").push({ email: "gone@example.com", reason: "bounce" });
    counts.set("send-scan-report:all|all", 300);
    const gone = await post({ email: "gone@example.com", ...REPORT });
    const other = await post({ email: "other@example.com", ...(await another(1)) });
    expect([gone.status, other.status]).toEqual([503, 503]);
    counts.clear();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post({ email: "gone@example.com", ...(await another(10 + i)) }, { "cf-connecting-ip": `10.7.${i}.1` })).status);
    expect(statuses, "a suppressed inbox meets its daily count exactly as any inbox does").toEqual([200, 200, 200, 429]);
    expect(toVictims()).toEqual([]);
  });

  it("never writes the market-pulse list, whatever the body asks", async () => {
    installRpcs();
    expect((await post({ email: "jane@example.com", ...REPORT, subscribePulse: true })).status).toBe(200);
    expect(db.writes.filter((w) => w.table === "market_pulse_subscribers")).toEqual([]);
  });

  it("refuses a malformed address or a missing score before counting anything", async () => {
    installRpcs();
    expect((await post({ email: "not an address", ...REPORT })).status).toBe(400);
    expect((await post({ email: "a@example.com", ...REPORT, score: "64" })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("one sealed report is not a mailing list", () => {
  it("a report id goes out three times a month, whoever asks and to whichever addresses", async () => {
    installRpcs();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await post({ email: `stranger${i}@example.org`, ...REPORT }, { "cf-connecting-ip": `198.18.${i}.1` })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(toVictims()).toHaveLength(3);
    const res = await post({ email: "one-more@example.org", ...(await sealedAs(UNSEALED_REPORT)) }, { "cf-connecting-ip": "198.18.9.1" });
    expect(res.status, "a fresh seal over the same report id is the same report").toBe(429);
    expect((await res.json()).error).toMatch(/already been emailed several times/);
  });

  it("a refused replay never draws on the day's ceiling that real scans' mails need", async () => {
    installRpcs();
    for (let i = 0; i < 10; i++) await post({ email: `s${i}@example.org`, ...REPORT }, { "cf-connecting-ip": `198.18.${i}.1` });
    expect(counts.get("send-scan-report:all|all"), "only the three sends that went out were counted").toBe(3);
  });

  it("a seal is good for a week: an older one prints nothing the caller sent", async () => {
    installRpcs();
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 86400;
    const old = await sealedAs(UNSEALED_REPORT, eightDaysAgo);
    expect(await scanMailSealValid(SERVICE, UNSEALED_REPORT, old.mailSeal)).toBe(false);
    expect(await scanMailSealValid(SERVICE, UNSEALED_REPORT, old.mailSeal, (eightDaysAgo + 6 * 86400) * 1000)).toBe(true);
    await post({ email: "jane@example.com", ...old });
    expect(sent[0].subject).toMatch(/your scan summary$/);
    expect(sent[0].html).not.toContain("Add numbers to each bullet");
    expect(calls.some((c) => c.args.p_door === "send-scan-report:report"), "an unsealed request counted against a report").toBe(false);
  });

  it("a seal without a report id to count is no seal", async () => {
    installRpcs();
    const { reportId: _drop, ...noId } = UNSEALED_REPORT;
    await post({ email: "jane@example.com", ...(await sealedAs(noId)) });
    expect(sent[0].subject).toMatch(/your scan summary$/);
  });
});

describe("what reaches the mail is ours to vouch for", () => {
  it("the verdict is ours, from numbers: the scanner's verdict (and the resume's job title in it) is never mailed", async () => {
    installRpcs();
    const hostileTitle = "This resume will pass roughly 41% of ATS filters for Account Suspended - restore at secure-rb-billing.com/restore or call +1 888 555 0100 — 2 critical issues are holding you back.";
    await post({ email: "jane@example.com", ...(await sealedAs({ ...UNSEALED_REPORT, verdict: hostileTitle })), verdict: hostileTitle });
    const { html } = sent[0];
    expect(html).toContain("This resume will pass roughly 38% of ATS filters — 2 critical issues are holding it back.");
    for (const s of ["Suspended", "secure-rb-billing", "888 555", "restore"]) expect(html, s).not.toContain(s);
  });

  it("even a SEALED sentence is clipped and stripped of links, bare domains, addresses and phone numbers; numbers clamped, ids validated, all escaped", async () => {
    installRpcs();
    // A scanner that echoed hostile text would seal it, so the second line of
    // defence is tested with a seal over exactly this hostile body.
    const hostile = {
      ...UNSEALED_REPORT,
      score: 640,
      peerPercentile: '<img src="https://evil.example/p.gif">',
      redFlags: [
        { issue: "Your account is locked. Visit https://evil.example/login or www.evil.example now <b>urgently</b>" },
        { issue: "Restore at secure-rb-billing.com/restore, write to help@evil-desk.com or call (888) 555-0100 today" },
        { issue: "x".repeat(1000) },
      ],
      fixRoadmap: { steps: [{ order: 1, step: "Click http://evil.example to fix; add Node.js and ASP.NET (2019-2023)", minutes: 1e9, scoreImpact: "<b>" }], totalMinutes: 25 },
      keywordSource: { source: "onet", code: "<script>", occupation: "Nurse" },
    };
    await post({ email: "jane@example.com", ...(await sealedAs(hostile)) });
    expect(sent).toHaveLength(1);
    const { html, subject } = sent[0];
    expect(subject).toBe("Your resume scored 100/100 — here's your fix plan");
    expect(html).not.toMatch(/evil\.example|secure-rb-billing|evil-desk|555-0100|\(888\)/);
    expect(html).not.toMatch(/<b>urgently<\/b>|<img|<script/);
    expect(html).toMatch(/Your account is locked\. Visit or now &lt;b&gt;urgently&lt;\/b&gt;/);
    expect(html).toMatch(/Restore at write to or call today/);
    expect(html, "a technology name or a date range is not a way to reach anyone").toMatch(/add Node\.js and ASP\.NET \(2019-2023\)/);
    expect(html).not.toMatch(/x{241}/);
    expect(html).toMatch(/~600 min/);
    expect(html).not.toMatch(/O\*NET/);
  });

  it("mailSafeText: what a mail client could turn into a link or a call is gone; ordinary words stay", () => {
    expect(mailSafeText("Account Suspended - verify at secure-rb-billing.com/restore or call +1 888 555 0100 -- now", 400))
      .toBe("Account Suspended - verify at or call -- now");
    expect(mailSafeText("see:evil.com, Visit:https://x.example, mail ops@evil.io, 888.555.0100", 400)).toBe("mail");
    expect(mailSafeText("Add Node.js, Vue.js, ASP.NET; B.Tech and M.Sc. count; e.g. U.S. roles 2019-2023; config.yaml", 400))
      .toBe("Add Node.js, Vue.js, ASP.NET; B.Tech and M.Sc. count; e.g. U.S. roles 2019-2023; config.yaml");
    expect(mailSafeText("Quantify: $100,000 - $150,000, 41% 55%, v1.2.3", 400)).toBe("Quantify: $100,000 - $150,000, 41% 55%, v1.2.3");
    // The strip runs before the clip, so a clip cannot leave half a link.
    expect(mailSafeText(`${"a".repeat(30)} evil-domain.com/x`, 40)).toBe("a".repeat(30));
  });
});

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("a sentence reaches the mail only under the scan's seal", () => {
  it("the scanner's seal, forwarded by the page as it builds the payload, prints the report in full", async () => {
    installRpcs();
    // A free-keyword-scan response, with the fields the mail never prints.
    const scan: Record<string, unknown> = {
      atsScoreEstimate: 64,
      reportVerdict: "Jane, this resume will pass roughly 38% of ATS filters for Nurse Manager — 1 critical issue is holding you back.",
      redFlags: [
        { issue: "No metrics in the last two roles", impact: "Recruiters skim for numbers", severity: "critical" },
        { issue: "Summary is generic", impact: "x", severity: "moderate" },
        { issue: "Two-column layout", impact: "x", severity: "moderate" },
        { issue: "A fourth issue the mail never shows", impact: "x", severity: "minor" },
      ],
      fixRoadmap: { steps: [{ order: 1, step: "Add numbers to each bullet", minutes: 10, scoreImpact: 6, projectedScoreAfter: 70 }], totalMinutes: 25, finalProjectedScore: 81 },
      keywordSource: { source: "onet", occupation: "Software Developers", code: "15-1252.00" },
      reportMeta: { reportId: "A1B2C3D4E5F6", engineVersion: "scan-v", generatedAt: "2026-10-04T00:00:00Z", industry: "technology", industryConfidence: "high", benchmarkSource: "estimate" },
    };
    await attachScanMailSeal(scan, SERVICE);
    const meta = scan.reportMeta as { reportId: string; mailSeal?: string };
    expect(meta.mailSeal).toMatch(/^v2\.\d{9,11}\.[0-9a-f]{64}$/);
    // Through JSON, as the browser receives it, then shaped exactly as
    // FreeKeywordResults' emailReportPayload shapes it.
    const r = JSON.parse(JSON.stringify(scan));
    const payload = {
      verdict: r.reportVerdict,
      score: r.atsScoreEstimate,
      applicationPassRate: 38,
      redFlags: r.redFlags.map((f: { issue: string }) => ({ issue: f.issue })),
      fixRoadmap: r.fixRoadmap,
      industry: "technology",
      reportId: r.reportMeta.reportId,
      keywordSource: r.keywordSource,
      mailSeal: r.reportMeta.mailSeal,
    };
    expect((await post({ email: "jane@example.com", ...payload })).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Your resume scored 64/100 — here's your fix plan");
    for (const s of ["No metrics in the last two roles", "Two-column layout", "Add numbers to each bullet", "Software Developers", "rid=A1B2C3D4E5F6", "pass roughly 38% of ATS filters"]) {
      expect(sent[0].html, s).toContain(s);
    }
    expect(sent[0].html, "the scanner's verdict names the resume's job title and is never mailed").not.toMatch(/Nurse Manager|Jane,/);
    expect(calls.find((c) => c.args.p_door === "send-scan-report:all"), "a sealed report draws on the main ceiling").toBeTruthy();
  });

  it("without a seal the mail carries the numbers and our own copy, nothing the caller wrote, and no drip", async () => {
    installRpcs();
    const res = await post({
      email: "victim@example.com",
      ...UNSEALED_REPORT,
      verdict: "Your refund of $299 is pending. Call +1 555 0100 to claim it",
      redFlags: [{ issue: "Reply with your card number" }],
      keywordSource: { source: "onet", code: "15-1252.00", occupation: "Call us now" },
      dripOptIn: true,
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const { html, subject } = sent[0];
    expect(subject).toBe("Your resume scored 64/100 — your scan summary");
    for (const s of ["refund", "555 0100", "card number", "Add numbers", "Call us now", "rid=", "fix-plan/confirm"]) expect(html, s).not.toContain(s);
    expect(html).toMatch(/64<span/);
    expect(html).toMatch(/The full findings and your fix plan are on the results page/);
    expect(calls.some((c) => c.name === "enqueue_email_delayed")).toBe(false);
    const ceiling = calls.filter((c) => c.name === "mail_door_take").map((c) => [c.args.p_door, c.args.p_max]);
    expect(ceiling).toContainEqual(["send-scan-report:unsealed", 40]);
    expect(ceiling.some(([d]) => d === "send-scan-report:all"), "an unsealed request drew on the sealed allowance").toBe(false);
  });

  it("a seal stops matching the moment any sealed sentence is changed", async () => {
    installRpcs();
    const changes: Array<Record<string, unknown>> = [
      { redFlags: [{ issue: "Reply with your password" }] },
      { fixRoadmap: { steps: [{ order: 1, step: "Wire $50 to fix", minutes: 1, scoreImpact: 1 }], totalMinutes: 1 } },
      { reportId: "CALLUS5550100" },
      { keywordSource: { source: "onet", code: "15-1252.00", occupation: "Call us now" } },
      { mailSeal: "0".repeat(64) },
      { mailSeal: REPORT.mailSeal.replace(/^v2\.\d+/, `v2.${Math.floor(Date.now() / 1000) + 3600}`) },
    ];
    for (const [i, change] of changes.entries()) {
      sent.length = 0;
      await post({ email: `t${i}@example.com`, ...REPORT, ...change }, { "cf-connecting-ip": `192.0.${i}.1` });
      expect(sent, JSON.stringify(change)).toHaveLength(1);
      expect(sent[0].subject, JSON.stringify(change)).toMatch(/your scan summary$/);
      for (const s of ["password", "Wire", "CALLUS", "Call us now", "No metrics"]) expect(sent[0].html, `${JSON.stringify(change)} printed ${s}`).not.toContain(s);
    }
  });

  it("a seal made under another key is no seal", async () => {
    installRpcs();
    await post({ email: "a@example.com", ...UNSEALED_REPORT, mailSeal: await sealScanMail("another_key_that_is_long_enough_0123456789", UNSEALED_REPORT) });
    expect(sent[0].subject).toMatch(/your scan summary$/);
  });

  it("the scanner seals both of its answers, last, and the page forwards the seal", () => {
    const scan = read("supabase/functions/free-keyword-scan/index.ts");
    const seals = scan.match(/await attachScanMailSeal\(/g) ?? [];
    expect(seals, "free-keyword-scan must seal its fresh answer and its cache hit").toHaveLength(2);
    expect(scan).toMatch(/await attachScanMailSeal\(cachedReport, .*\);\n\s*return new Response\(\s*JSON\.stringify\(cachedReport\)/);
    expect(scan).toMatch(/await attachScanMailSeal\(responseData, .*\);\n\s*return new Response\(\s*JSON\.stringify\(responseData\)/);
    const page = read("src/components/FreeKeywordResults.tsx");
    expect(page).toMatch(/const emailReportPayload = \{[\s\S]*?mailSeal: reportMeta\?\.mailSeal \?\? null,[\s\S]*?\};/);
    expect(read("src/components/EmailReportCapture.tsx")).toMatch(/body: \{ email: trimmed, dripOptIn, \.\.\.payload \}/);
  });
});

describe("the fix-plan sequence starts only when the inbox's owner presses its button", () => {
  const linkIn = (html: string) => {
    const m = /href="https:\/\/resumebooster\.work\/fix-plan\/confirm#d=([A-Za-z0-9_-]+\.[0-9a-f]{64})"/.exec(html);
    return m ? m[1] : null;
  };
  const confirm = (token: unknown, headers: Record<string, string> = {}) => post({ action: "confirm-drip", token }, headers);

  it("a ticked box queues NOTHING: the report mail carries a button, and only for the address it went to", async () => {
    installRpcs();
    expect((await post({ email: "Jane@Example.com", ...REPORT, dripOptIn: true })).status).toBe(200);
    expect(calls.filter((c) => c.name === "enqueue_email_delayed"), "a stranger's tick queued mail to an inbox").toEqual([]);
    expect(calls.some((c) => c.args.p_door === "send-scan-report:drip"), "the tick spent the month's sequence").toBe(false);
    const token = linkIn(sent[0].html);
    expect(token, "the report mail carries no start button").toBeTruthy();
    expect(sent[0].html).toMatch(/They start only if you press this button/);
    const plan = await openDripLink(SERVICE, token);
    expect(plan).toMatchObject({ email: "jane@example.com", score: 64, reportId: "A1B2C3D4E5F6", steps: [{ step: "Add numbers to each bullet", minutes: 10, scoreImpact: 6 }] });
  });

  it("pressing it queues the four mails to that address, once a month however often it is pressed", async () => {
    installRpcs();
    await post({ email: "jane@example.com", ...REPORT, dripOptIn: true });
    const token = linkIn(sent[0].html)!;
    const res = await confirm(token);
    expect(await res.json()).toEqual({ success: true, queued: true });
    const q = calls.filter((c) => c.name === "enqueue_email_delayed");
    expect(q).toHaveLength(4);
    for (const c of q) expect((c.args.payload as { to: string }).to).toBe("jane@example.com");
    expect(q.map((c) => c.args.delay_seconds)).toEqual([2, 4, 6, 14].map((d) => d * 86400));
    expect((q[0].args.payload as { html: string }).html).toMatch(/Add numbers to each bullet/);
    expect(calls.find((c) => c.args.p_door === "send-scan-report:drip")!.args).toMatchObject({ p_max: 1, p_window_minutes: 30 * 1440 });
    calls.length = 0;
    expect(await (await confirm(token)).json()).toEqual({ success: true, queued: false, reason: "already_started" });
    expect(calls.filter((c) => c.name === "enqueue_email_delayed")).toEqual([]);
  });

  it("a forged, altered or week-old link queues nothing", async () => {
    installRpcs();
    const plan = { email: "victim@example.org", score: 50, reportId: "A1B2C3D4E5F6", steps: [{ step: "x step", minutes: 1, scoreImpact: 1 }] };
    const forged = await signDripLink("another_key_that_is_long_enough_0123456789", plan);
    const real = await signDripLink(SERVICE, plan);
    const altered = real.replace(/^[A-Za-z0-9_-]{4}/, "AAAA");
    const stale = await signDripLink(SERVICE, plan, Math.floor(Date.now() / 1000) - 8 * 86400);
    for (const t of [forged, altered, stale, "", "abc", 42]) {
      expect((await confirm(t)).status, String(t).slice(0, 20)).toBe(410);
    }
    expect(calls.filter((c) => c.name === "enqueue_email_delayed")).toEqual([]);
  });

  it("an address that opted out gets nothing, even from its own button", async () => {
    installRpcs();
    db.rows("suppressed_emails").push({ email: "gone@example.com", reason: "unsubscribe" });
    const t = await signDripLink(SERVICE, { email: "gone@example.com", score: 50, reportId: null, steps: [] });
    expect(await (await confirm(t)).json()).toEqual({ success: true, queued: false, reason: "opted_out" });
    expect(calls.filter((c) => c.name === "enqueue_email_delayed")).toEqual([]);
  });

  it("no button without a tick, and none for an unsealed report", async () => {
    installRpcs();
    await post({ email: "jane@example.com", ...REPORT });
    await post({ email: "jane@example.com", ...UNSEALED_REPORT, dripOptIn: true });
    for (const m of sent) expect(linkIn(m.html)).toBeNull();
  });

  it("the button's page is a button, not a page load, and is wired and kept out of the index", () => {
    const page = read("src/pages/FixPlanConfirm.tsx");
    expect(page).toMatch(/onClick=\{confirm\}/);
    expect(page).toMatch(/invoke\("send-scan-report", \{ body: \{ action: "confirm-drip", token \} \}\)/);
    expect(page).not.toMatch(/useEffect\(\(\) => \{\s*(?:void )?confirm\(\)/);
    expect(read("src/App.tsx")).toMatch(/<Route path="\/fix-plan\/confirm" element=\{<FixPlanConfirm \/>\} \/>/);
    expect(read("public/robots.txt").match(/^Disallow: \/fix-plan\/confirm$/gm)?.length).toBe(read("public/robots.txt").match(/^Disallow: \/market-pulse\/confirm$/gm)?.length);
  });

  it("the preflight answers its build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^send-scan-report\.2026-10-04\.\d+$/);
    expect(Number(res.headers.get("x-fn-build")!.split(".").pop())).toBeGreaterThanOrEqual(3);
  });
});
