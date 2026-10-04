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
 *     address (3 a day), and a daily ceiling caps everyone; a count that cannot
 *     be taken keeps the door shut;
 *   - a suppressed address gets nothing, and the same answer as anyone else;
 *     the pulse list is never written;
 *   - a SENTENCE reaches the mail only under free-keyword-scan's seal: the
 *     scanner seals what it returns, the page forwards the seal, and a request
 *     without it (or with any sentence changed) gets the numbers only, no
 *     drip, and a ceiling of its own;
 *   - every number is clamped, every sentence clipped and stripped of links,
 *     and all of it escaped;
 *   - the drip is queued at most once a month per address;
 *   - mail_door_take is atomic, holds its window, and its sweep never crosses
 *     into another door.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bootMailDoorDb, rows } from "./helpers/mail-door-db";
import { attachScanMailSeal, sealScanMail } from "../../supabase/functions/_shared/scan-mail-seal";

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
  verdict: "Strong experience, weak keywords.",
  score: 64,
  projectedScore: 81,
  scoreBreakdown: { keywords: 55, format: 80, quantification: 60 },
  peerPercentile: 42,
  applicationPassRate: 38,
  redFlags: [{ issue: "No metrics in the last two roles" }],
  fixRoadmap: { steps: [{ order: 1, step: "Add numbers to each bullet", minutes: 10, scoreImpact: 6 }], totalMinutes: 25 },
  industry: "technology",
  reportId: "A1B2C3D4E5F6",
};
/** The same report with the seal free-keyword-scan would have given it. */
let REPORT: typeof UNSEALED_REPORT & { mailSeal: string };
beforeAll(async () => {
  REPORT = { ...UNSEALED_REPORT, mailSeal: await sealScanMail(SERVICE, UNSEALED_REPORT) };
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));

describe("send-scan-report is bounded per network, per inbox and per day", () => {
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
      expect(JSON.stringify(c.args), "an address reached a counter in the clear").not.toMatch(/198\.51\.100|@example\.com/);
    }
  });

  it("the thirteenth request from one network in an hour is refused, and nothing is sent", async () => {
    installRpcs();
    for (let i = 0; i < 12; i++) expect((await post({ email: `u${i}@example.com`, ...REPORT }, { "cf-connecting-ip": "198.51.100.1" })).status).toBe(200);
    sent.length = 0;
    expect((await post({ email: "u13@example.com", ...REPORT }, { "cf-connecting-ip": "198.51.100.99" })).status).toBe(429);
    expect(sent).toEqual([]);
  });

  it("one inbox gets three reports a day, however many networks ask", async () => {
    installRpcs();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post({ email: "victim@example.com", ...REPORT }, { "cf-connecting-ip": `10.${i}.0.1` })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(sent).toHaveLength(3);
    const res = await post({ email: "VICTIM@example.com", ...REPORT }, { "cf-connecting-ip": "10.9.0.1" });
    expect(res.status, "the same inbox spelled in capitals is the same inbox").toBe(429);
    expect(await res.json()).toMatchObject({ success: false, error: expect.stringMatching(/several reports today/) });
  });

  it("stops at the day's ceiling", async () => {
    installRpcs();
    counts.set("send-scan-report:all|all", 300);
    expect((await post({ email: "late@example.com", ...REPORT })).status).toBe(503);
    expect(sent).toEqual([]);
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

describe("what reaches the mail is ours to vouch for", () => {
  it("even a SEALED sentence is clipped and stripped of links; numbers clamped, ids validated, all escaped", async () => {
    installRpcs();
    // A scanner that echoed hostile text would seal it, so the second line of
    // defence is tested with a seal over exactly this hostile body.
    const hostile = {
      ...UNSEALED_REPORT,
      score: 640,
      peerPercentile: '<img src="https://evil.example/p.gif">',
      verdict: "Your account is locked. Visit https://evil.example/login or www.evil.example now <b>urgently</b>",
      redFlags: [{ issue: "x".repeat(1000) }],
      fixRoadmap: { steps: [{ order: 1, step: "Click http://evil.example to fix", minutes: 1e9, scoreImpact: "<b>" }], totalMinutes: 25 },
      reportId: '"><a href="https://evil.example">',
      keywordSource: { source: "onet", code: "<script>", occupation: "Nurse" },
    };
    await post({ email: "jane@example.com", ...hostile, mailSeal: await sealScanMail(SERVICE, hostile) });
    expect(sent).toHaveLength(1);
    const { html, subject } = sent[0];
    expect(subject).toBe("Your resume scored 100/100 — here's your fix plan");
    expect(html).not.toMatch(/evil\.example/);
    expect(html).not.toMatch(/<b>urgently<\/b>|<img|<script/);
    expect(html).toMatch(/Your account is locked\. Visit or now &lt;b&gt;urgently&lt;\/b&gt;/);
    expect(html).not.toMatch(/x{241}/);
    expect(html).toMatch(/~600 min/);
    expect(html).not.toMatch(/rid=/);
    expect(html).not.toMatch(/O\*NET/);
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
      reportVerdict: "Strong experience, weak keywords.",
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
    expect(meta.mailSeal).toMatch(/^[0-9a-f]{64}$/);
    // Through JSON, as the browser receives it, then shaped exactly as
    // FreeKeywordResults' emailReportPayload shapes it.
    const r = JSON.parse(JSON.stringify(scan));
    const payload = {
      verdict: r.reportVerdict,
      score: r.atsScoreEstimate,
      redFlags: r.redFlags.map((f: { issue: string }) => ({ issue: f.issue })),
      fixRoadmap: r.fixRoadmap,
      industry: "technology",
      reportId: r.reportMeta.reportId,
      keywordSource: r.keywordSource,
      mailSeal: r.reportMeta.mailSeal,
    };
    expect((await post({ email: "jane@example.com", ...payload, dripOptIn: true })).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Your resume scored 64/100 — here's your fix plan");
    for (const s of ["Strong experience, weak keywords.", "No metrics in the last two roles", "Two-column layout", "Add numbers to each bullet", "Software Developers", "rid=A1B2C3D4E5F6"]) {
      expect(sent[0].html, s).toContain(s);
    }
    expect(calls.filter((c) => c.name === "enqueue_email_delayed"), "a sealed report's drip is queued").toHaveLength(4);
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
    for (const s of ["refund", "555 0100", "card number", "Add numbers", "Call us now", "rid="]) expect(html, s).not.toContain(s);
    expect(html).toMatch(/64<span/);
    expect(html).toMatch(/The full findings and your fix plan are on the results page/);
    expect(calls.some((c) => c.args.p_door === "send-scan-report:drip"), "an unsealed request counted a drip").toBe(false);
    expect(calls.some((c) => c.name === "enqueue_email_delayed")).toBe(false);
    const ceiling = calls.filter((c) => c.name === "mail_door_take").map((c) => [c.args.p_door, c.args.p_max]);
    expect(ceiling).toContainEqual(["send-scan-report:unsealed", 40]);
    expect(ceiling.some(([d]) => d === "send-scan-report:all"), "an unsealed request drew on the sealed allowance").toBe(false);
  });

  it("a seal stops matching the moment any sentence is changed", async () => {
    installRpcs();
    const changes: Array<Record<string, unknown>> = [
      { verdict: "Your account is locked." },
      { redFlags: [{ issue: "Reply with your password" }] },
      { fixRoadmap: { steps: [{ order: 1, step: "Wire $50 to fix", minutes: 1, scoreImpact: 1 }], totalMinutes: 1 } },
      { reportId: "CALLUS5550100" },
      { mailSeal: "0".repeat(64) },
    ];
    for (const [i, change] of changes.entries()) {
      sent.length = 0;
      await post({ email: `t${i}@example.com`, ...REPORT, ...change }, { "cf-connecting-ip": `192.0.${i}.1` });
      expect(sent, JSON.stringify(change)).toHaveLength(1);
      expect(sent[0].subject, JSON.stringify(change)).toMatch(/your scan summary$/);
      for (const s of ["locked", "password", "Wire", "CALLUS", "Strong experience", "No metrics"]) expect(sent[0].html, `${JSON.stringify(change)} printed ${s}`).not.toContain(s);
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

describe("the drip is queued at most once a month per address", () => {
  it("a second ticked request for the same inbox queues nothing more", async () => {
    installRpcs();
    await post({ email: "jane@example.com", ...REPORT, dripOptIn: true });
    expect(calls.filter((c) => c.name === "enqueue_email_delayed")).toHaveLength(4);
    const drip = calls.find((c) => c.args.p_door === "send-scan-report:drip")!;
    expect(drip.args).toMatchObject({ p_max: 1, p_window_minutes: 30 * 1440 });
    calls.length = 0;
    expect((await post({ email: "jane@example.com", ...REPORT, dripOptIn: true })).status).toBe(200);
    expect(calls.filter((c) => c.name === "enqueue_email_delayed")).toEqual([]);
  });

  it("an unticked request counts no drip at all", async () => {
    installRpcs();
    await post({ email: "jane@example.com", ...REPORT });
    expect(calls.some((c) => c.args.p_door === "send-scan-report:drip")).toBe(false);
  });

  it("the preflight answers its build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^send-scan-report\.2026-10-04\.\d+$/);
  });
});
