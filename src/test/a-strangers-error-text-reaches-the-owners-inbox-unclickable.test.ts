// @vitest-environment node
/**
 * A STRANGER'S ERROR TEXT REACHES THE OWNER'S INBOX UNCLICKABLE.
 *
 * WHAT WAS WRONG. log_error_telemetry stays callable with the publishable key
 * (the browser reports its own errors through it), and check-error-spikes
 * mails the newest error_telemetry rows to ADMIN_EMAIL verbatim:
 * `${error_code}: ${error_message}`. So anyone could put a clickable phishing
 * link into the owner's own alert email. Migration 20261004110000 bounds how
 * much a caller can write; defang() makes what they wrote inert.
 *
 * WHAT THIS HOLDS: the pure defang() on the shapes that autolink (a scheme
 * URL, a bare domain, www., an address, mailto:/javascript:), and the shipped
 * handler -- with only its network faked -- mailing a seeded phishing row
 * with no live link in it, while keeping its admin-key gate and its build on
 * the preflight.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { defang } from "../../supabase/functions/check-error-spikes/defang";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const LIVE_LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|example|net|org|io|work)\b|mailto:|javascript:|@/i;

describe("defang", () => {
  it("leaves nothing a mail client would turn into a link", () => {
    for (const evil of [
      "Session expired, re-verify at https://evil.example/login?u=owner",
      "visit www.evil.example now",
      "evil.example/reset",
      "write to owner@evil.example",
      "mailto:owner@evil.example",
      "javascript:alert(1)",
      "HTTPS://EVIL.EXAMPLE",
    ]) {
      const out = defang(evil);
      expect(out, evil).not.toMatch(LIVE_LINK);
    }
    expect(defang("https://evil.example/x")).toBe("https[:]//evil[.]example/x");
  });

  it("keeps an ordinary error readable, strips control characters and caps the length", () => {
    expect(defang("TypeError: Cannot read properties of undefined (reading 'x')"))
      .toBe("TypeError: Cannot read properties of undefined (reading 'x')");
    expect(defang("line1\nline2\r\u0007end")).toBe("line1 line2 end");
    expect(defang("x".repeat(5000))).toHaveLength(300);
    expect(defang(null)).toBe("");
  });
});

const STUBS: Record<string, string> = {
  "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__spikeClient; }",
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  ADMIN_EMAIL: "owner@example.com",
  RESEND_API_KEY: "re_harness",
  ADMIN_API_KEY: "admin-key-harness-0123456789",
};

let handler: EdgeHandler;
let sent: Array<{ url: string; body: Record<string, unknown> }>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("check-error-spikes", STUBS);
}, 120_000);

beforeEach(() => {
  sent = [];
  const rows = [{
    error_type: "client", error_code: "AUTH_EXPIRED",
    error_message: "Your account is locked. Restore it at https://evil.example/restore or write to help@evil.example",
    function_name: "www.evil.example", visitor_id: "evil.example/x", created_at: new Date().toISOString(),
  }];
  const query = { select: () => query, gte: () => query, order: () => query, limit: async () => ({ data: rows, error: null }) };
  const g = globalThis as Record<string, unknown>;
  g.__spikeClient = {
    rpc: async (fn: string) => fn === "detect_user_error_spikes"
      ? { data: [{ visitor_id: "https://evil.example/v", recent_error_count: 40, baseline_hourly_rate: 1, spike_multiplier: 40,
          recent_error_types: ["see evil.example"], last_error_at: new Date().toISOString(), is_spike: true }], error: null }
      : fn === "get_error_diagnostics"
        ? { data: [{ error_type: "click https://evil.example", error_code: "X", error_count: 3, unique_users: 1 }], error: null }
        : { data: true, error: null },
    from: () => query,
  };
  g.fetch = async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  };
});

describe("check-error-spikes", () => {
  it("mails the owner a stranger's error text with no live link in it", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/check-error-spikes", {
      method: "POST", headers: { "x-admin-key": env.ADMIN_API_KEY, "content-type": "application/json" }, body: "{}",
    }));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.resend.com/emails");
    const text = String(sent[0].body.text);
    expect(text).toMatch(/AUTH_EXPIRED/);
    expect(text).toMatch(/evil\[\.\]example/);
    // The report's own lines carry no link either: only defanged text is left.
    expect(text, text).not.toMatch(LIVE_LINK);
  });

  it("still refuses a caller without the admin key, and names its build on the preflight", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/check-error-spikes", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect(sent).toEqual([]);
    const pre = await handler(new Request("https://harness.supabase.co/functions/v1/check-error-spikes", { method: "OPTIONS" }));
    expect(pre.headers.get("x-fn-build")).toMatch(/^check-error-spikes\.\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
