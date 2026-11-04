// @vitest-environment node
/**
 * THE KEYLESS ALLOWANCE ALERT REACHES THE OWNER (audit 2026-10-31, S13-040;
 * notify-owner 2026-11-03.1).
 *
 * WHAT WAS WRONG. agent-mcp claims the 50% alert for a keyless share once per
 * UTC day (mcp_allowance_alert_claim) and posts {type:'allowance', share,
 * used, cap} to notify-owner with the service role. notify-owner knew only a
 * signup and a scan, answered 400 "unrecognized payload", and the owner was
 * never told, for any share on any day.
 *
 * WHAT HOLDS NOW (the shipped notify-owner, Resend and the database faked):
 * the payload agent-mcp sends, for every share it names, mails the owner a
 * subject naming the share, its count and the percentage, through the same
 * counted door as every owner note; a malformed share or count is still
 * refused, and a stranger's post is still a 401.
 *
 * The other half, agent-mcp giving its claim back when the note was not mailed,
 * is held in a-refused-allowance-note-gives-its-claim-back.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness",
};
type Mail = { to: string[]; subject: string; html: string };
let mail: Mail[];
let doors: Array<Record<string, unknown>>;
let notify: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  notify = await loadEdgeHandler("notify-owner", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__allowDb; }",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__allowMail().push(m); return { data: { id: 'x' }, error: null }; } }; } }",
  });
}, 120_000);

beforeEach(() => {
  mail = [];
  doors = [];
  const db = new FakeDb();
  db.rpcs.mail_door_take = (a) => { doors.push(a); return { data: true, error: null }; };
  db.rpcs.email_cron_key_matches = () => ({ data: false, error: null });
  const g = globalThis as Record<string, unknown>;
  g.__allowDb = db;
  g.__allowMail = () => mail;
});

const post = (body: unknown, auth = `Bearer ${SERVICE}`) =>
  notify(new Request("https://harness.supabase.co/functions/v1/notify-owner", {
    method: "POST", headers: { "content-type": "application/json", authorization: auth, apikey: SERVICE }, body: JSON.stringify(body),
  }));

describe("the 50% alert agent-mcp posts is a note the owner receives", () => {
  it("is posted by agent-mcp in exactly this shape, with the service role", () => {
    const mcp = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
    expect(mcp).toMatch(/\/functions\/v1\/notify-owner`/);
    expect(mcp).toMatch(/body: JSON\.stringify\(\{ type: "allowance", share, used, cap \}\)/);
    expect(mcp).toMatch(/Authorization: `Bearer \$\{key\}`/);
  });

  for (const share of ["global:claude", "global:chatgpt", "global:other", "global", "global:forms", "global:forms:claude"]) {
    it(`mails the owner for share ${share}`, async () => {
      const res = await post({ type: "allowance", share, used: 10_000, cap: 20_000 });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, kind: "allowance" });
      expect(mail).toHaveLength(1);
      expect(mail[0].subject).toBe(`⚠️ Keyless allowance: ${share} at 10000/20000 (50%)`);
      expect(doors.map((d) => d.p_door)).toEqual(["notify-owner"]);
    });
  }

  it("refuses a share or a count that is not what agent-mcp sends", async () => {
    for (const body of [
      { type: "allowance", share: "<b>x</b>", used: 1, cap: 2 },
      { type: "allowance", share: "global:claude", used: "10", cap: 20 },
      { type: "allowance", share: "global:claude", used: 1, cap: 0 },
      { type: "allowance", share: "global:claude", used: -1, cap: 2 },
      { type: "allowance", share: "x".repeat(41), used: 1, cap: 2 },
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(mail).toEqual([]);
  });

  it("a stranger's post is still a 401 and no mail", async () => {
    expect((await post({ type: "allowance", share: "global:claude", used: 1, cap: 2 }, "Bearer anon_publishable_key_0123456789abcdef")).status).toBe(401);
    expect(mail).toEqual([]);
  });
});
