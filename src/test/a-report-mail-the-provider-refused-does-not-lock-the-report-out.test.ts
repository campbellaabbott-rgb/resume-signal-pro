// @vitest-environment node
/**
 * A REPORT MAIL THE PROVIDER REFUSED DOES NOT LOCK THE REPORT OUT (audit
 * 2026-10-31, S13-098, the report-send half), AND AN UNSUBSCRIBE NEVER LOWERS A
 * BOUNCE OR A COMPLAINT (S13-068).
 *
 * WHAT WAS WRONG. send-scan-report took its recipient, report and daily-ceiling
 * counts before it called the mail provider, and kept them when the provider
 * refused or threw. A report may be mailed three times in thirty days, so three
 * refusals during a provider incident answered "This report has already been
 * emailed several times" the next day, when nothing had ever arrived. And its
 * unsubscribe was an unconditional upsert: an older drip's button pressed after
 * the address complained turned 'complaint' back into 'unsubscribe', the one
 * reason legal notices are allowed through.
 *
 * WHAT HOLDS NOW, running the shipped handler with Resend and the database
 * faked, the counts behaving as mail_door_take and mail_door_give do:
 *   - a send refused or thrown answers 502 and hands back every count it took
 *     except the network's, which bounds requests, not mail;
 *   - after any number of refusals a healthy provider delivers;
 *   - every other way out with no mail hands them back too; a suppressed address
 *     keeps its count, since that answer must look like a mail;
 *   - the unsubscribe leaves a stronger reason where it is.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";
import { sealScanMail } from "../../supabase/functions/_shared/scan-mail-seal";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
const counts = new Map<string, number>();
const gives: string[] = [];
let answer: "ok" | "refuse" | "throw" = "ok";
let handler: EdgeHandler;

const UNSEALED = {
  score: 64, projectedScore: 81, scoreBreakdown: { keywords: 55, format: 80, quantification: 60 }, peerPercentile: 42, applicationPassRate: 38,
  findingsSummary: { critical: 2, warnings: 3, passed: 9 }, redFlags: [{ issue: "No metrics in the last two roles" }],
  fixRoadmap: { steps: [{ order: 1, step: "Add numbers to each bullet", minutes: 10, scoreImpact: 6 }], totalMinutes: 25 }, industry: "technology", reportId: "A1B2C3D4E5F6",
};
let REPORT: typeof UNSEALED & { mailSeal: string };

const key = (door: unknown, bucket: unknown) => `${door}|${bucket}`;
const doorOf = (k: string) => k.split("|")[0];
const held = () => [...counts.entries()].filter(([, n]) => n > 0).map(([k, n]) => `${doorOf(k)}=${n}`).sort();

function install(overrides: Partial<FakeDb["rpcs"]> = {}) {
  db.rpcs.mail_door_take = (a) => {
    const k = key(a.p_door, a.p_bucket);
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    return { data: n <= Number(a.p_max), error: null };
  };
  db.rpcs.mail_door_give = (a) => {
    const k = key(a.p_door, a.p_bucket);
    gives.push(String(a.p_door));
    const n = counts.get(k) ?? 0;
    if (n > 0) counts.set(k, n - 1);
    return { data: n > 0, error: null };
  };
  db.rpcs.save_free_scan_lead = () => ({ data: null, error: null });
  Object.assign(db.rpcs, overrides);
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__rrSent = sent;
  g.__rrDb = db;
  g.__rrAnswer = () => answer;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-scan-report", {
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__rrDb;",
    "https://esm.sh/resend@2.0.0": `export class Resend { constructor() { this.emails = { send: async (m) => {
      const a = globalThis.__rrAnswer();
      if (a === "throw") throw new Error("fake: connection reset");
      if (a === "refuse") return { data: null, error: { message: "fake: refused" } };
      globalThis.__rrSent.push(m); return { data: { id: "em" }, error: null };
    } }; } }`,
  });
  REPORT = { ...UNSEALED, mailSeal: await sealScanMail(SERVICE, UNSEALED) };
}, 60_000);

afterEach(() => {
  sent.length = 0; counts.clear(); gives.length = 0; answer = "ok";
  db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = [];
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", ...headers }, body: JSON.stringify(body),
  }));

describe("a report mail that never left", () => {
  it("a send the provider refused answers 502 and hands back all but the network's count", async () => {
    install();
    answer = "refuse";
    const res = await post({ email: "jane@example.com", ...REPORT });
    expect(res.status).toBe(502);
    expect(sent).toHaveLength(0);
    expect(gives.sort()).toEqual(["send-scan-report:all", "send-scan-report:recipient", "send-scan-report:report"]);
    expect(held(), "only the network's count stays taken").toEqual(["send-scan-report=1"]);
  });

  it("a send that threw answers 502, not a 500, and hands back the same counts", async () => {
    install();
    answer = "throw";
    const res = await post({ email: "jane@example.com", ...REPORT });
    expect(res.status).toBe(502);
    expect(held()).toEqual(["send-scan-report=1"]);
  });

  it("three refusals and then a healthy provider: the mail is sent", async () => {
    install();
    answer = "refuse";
    for (let i = 0; i < 3; i++) expect((await post({ email: "jane@example.com", ...REPORT })).status).toBe(502);
    answer = "ok";
    const res = await post({ email: "jane@example.com", ...REPORT });
    expect(res.status, "the report was locked out by mail that never left").toBe(200);
    expect(sent).toHaveLength(1);
    expect(held()).toEqual(["send-scan-report:all=1", "send-scan-report:recipient=1", "send-scan-report:report=1", "send-scan-report=4"]);
  });

  it("the sealed report's limit still counts mail that left", async () => {
    install();
    for (const to of ["a@example.com", "b@example.com", "c@example.com"]) expect((await post({ email: to, ...REPORT })).status).toBe(200);
    const fourth = await post({ email: "d@example.com", ...REPORT });
    expect(fourth.status).toBe(429);
    expect(sent).toHaveLength(3);
    // The fourth asked and was refused at the report's door: its recipient count went back.
    expect(gives).toEqual(["send-scan-report:recipient"]);
  });

  it("a report full at the door hands the recipient's count back, so another report can still reach that inbox", async () => {
    install();
    for (const to of ["a@example.com", "b@example.com", "c@example.com"]) await post({ email: to, ...REPORT });
    await post({ email: "d@example.com", ...REPORT });
    const k = [...counts.keys()].filter((x) => doorOf(x) === "send-scan-report:recipient");
    expect(k).toHaveLength(4);
    expect(k.map((x) => counts.get(x)).sort()).toEqual([0, 1, 1, 1]);
  });

  it("a suppression read that failed hands the counts back", async () => {
    install();
    db.faults.push({ table: "suppressed_emails", op: "select", error: { code: "57014", message: "fake" } });
    const res = await post({ email: "jane@example.com", ...REPORT });
    expect(res.status).toBe(503);
    expect(held()).toEqual(["send-scan-report=1"]);
  });

  it("a suppressed address keeps its count, and its answer looks like a mail", async () => {
    install();
    db.rows("suppressed_emails").push({ email: "jane@example.com", reason: "unsubscribe" });
    const res = await post({ email: "jane@example.com", ...REPORT });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(gives).toEqual([]);
  });

  it("a give that fails, or a database that has no such function yet, changes nothing the visitor sees", async () => {
    install({ mail_door_give: undefined as never });
    delete db.rpcs.mail_door_give;
    answer = "refuse";
    const res = await post({ email: "jane@example.com", ...REPORT });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: "Failed to send email" });
  });
});

describe("the fix-plan unsubscribe", () => {
  // The fake's upsert overwrites whatever is there, as Postgres would without
  // ignoreDuplicates, so the option is what this test judges.
  const withSuppressions = (existing: { email: string; reason: string }) => {
    const options: unknown[] = [];
    const realFrom = db.from.bind(db);
    db.from = ((table: string) => {
      if (table !== "suppressed_emails") return realFrom(table);
      const q = realFrom(table) as unknown as { upsert: (p: { email: string; reason: string }, o?: { ignoreDuplicates?: boolean }) => unknown };
      q.upsert = (p, o) => {
        options.push(o);
        const row = db.rows("suppressed_emails").find((r) => r.email === p.email);
        if (row && !o?.ignoreDuplicates) row.reason = p.reason;
        else if (!row) db.rows("suppressed_emails").push({ ...p });
        return Promise.resolve({ data: null, error: null });
      };
      return q as never;
    }) as typeof db.from;
    db.rows("suppressed_emails").push({ ...existing });
    return { options, restore: () => { db.from = realFrom; } };
  };

  const unsubscribe = async () => {
    const token = "0123456789abcdef0123456789abcdef";
    db.rows("email_unsubscribe_tokens").push({ token, email: "jane@example.com", used_at: null });
    const res = await handler(new Request(`https://harness.supabase.co/functions/v1/send-scan-report?action=unsubscribe&token=${token}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", token }),
    }));
    expect(await res.json()).toEqual({ unsubscribed: true });
    return res;
  };

  it("leaves a complaint a complaint", async () => {
    const { options, restore } = withSuppressions({ email: "jane@example.com", reason: "complaint" });
    try {
      await unsubscribe();
    } finally { restore(); }
    expect(options, "the unsubscribe never reached the suppression write").toHaveLength(1);
    expect(db.rows("suppressed_emails").find((r) => r.email === "jane@example.com")?.reason).toBe("complaint");
  });

  it("leaves a bounce a bounce", async () => {
    const { restore } = withSuppressions({ email: "jane@example.com", reason: "bounce" });
    try {
      await unsubscribe();
    } finally { restore(); }
    expect(db.rows("suppressed_emails").find((r) => r.email === "jane@example.com")?.reason).toBe("bounce");
  });

  it("an address with no row gets its unsubscribe", async () => {
    const realFrom = db.from.bind(db);
    db.from = ((table: string) => {
      if (table !== "suppressed_emails") return realFrom(table);
      const q = realFrom(table) as unknown as { upsert: (p: { email: string; reason: string }, o?: unknown) => unknown };
      q.upsert = (p) => { db.rows("suppressed_emails").push({ ...p }); return Promise.resolve({ data: null, error: null }); };
      return q as never;
    }) as typeof db.from;
    try { await unsubscribe(); } finally { db.from = realFrom; }
    expect(db.rows("suppressed_emails")).toEqual([expect.objectContaining({ email: "jane@example.com", reason: "unsubscribe" })]);
  });
});
