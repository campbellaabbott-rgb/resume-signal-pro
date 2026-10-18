// @vitest-environment node
/**
 * THE SELLER WAS NAMED IN NO MARKETING MAIL (commercial-readiness plan item
 * 10; 15 U.S.C. 7704(a)(5) wants a postal address in every one).
 *
 * The saved-search digest, the market pulse and the fix-plan drip end in
 * sellerFooterHtml() (supabase/functions/_shared/seller.ts), which is "" while
 * the owner has not set the seller. Run here: the shipped send-scan-report
 * queues its four drip mails with the shared module as shipped (no line) and
 * with a seller set (the line, escaped, in every mail).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { signDripLink } from "../../supabase/functions/_shared/scan-drip-link";
import { sellerFooterHtml, sellerFooterText } from "../../supabase/functions/_shared/seller";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const SET = { legalName: "Example & Sons LLC", postalAddress: "1 Example Street, Springfield, CA 90000, USA" };

const db = new FakeDb();
const enqueued: Array<{ payload: { html: string } }> = [];
let shipped: EdgeHandler;
let withSeller: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__sellerDb = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  const stubs = {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__sellerDb;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 'em' }, error: null }) }; } }",
  };
  shipped = await loadEdgeHandler("send-scan-report", stubs);
  // The identity module with a seller set; the real line builder reads it.
  withSeller = await loadEdgeHandler("send-scan-report", {
    ...stubs,
    "_shared/seller-identity.ts": `export const SELLER_IDENTITY = ${JSON.stringify(SET)};`,
  });
}, 120_000);

function install() {
  db.tables = {};
  enqueued.length = 0;
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
  db.rpcs.enqueue_email_delayed = (a) => { enqueued.push(a as { payload: { html: string } }); return { data: enqueued.length, error: null }; };
  db.rpcs.delete_email = () => ({ data: true, error: null });
}
const press = async (handler: EdgeHandler) => {
  const token = await signDripLink(SERVICE, { email: "jane@example.com", score: 64, reportId: "A1B2C3D4E5F6", steps: [{ step: "Add numbers", minutes: 10, scoreImpact: 6 }] });
  return handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" }, body: JSON.stringify({ action: "confirm-drip", token }),
  }));
};

describe("the fix-plan drip's footer", () => {
  // S12-010 (owner decision 2026-10-12): with no seller set, the sequence,
  // which is marketing, does not start at all rather than go out unsigned.
  it("as shipped, with no seller set, queues nothing", async () => {
    install();
    const res = await press(shipped);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ queued: false, reason: "paused_no_seller_identity" });
    expect(enqueued).toHaveLength(0);
  });

  it("with the seller set, every mail ends with the name and postal address, escaped", async () => {
    install();
    expect(await (await press(withSeller)).json()).toEqual({ success: true, queued: true });
    expect(enqueued).toHaveLength(4);
    for (const e of enqueued) {
      expect(e.payload.html).toContain("Example &amp; Sons LLC · 1 Example Street, Springfield, CA 90000, USA");
    }
  });
});

describe("the shared line", () => {
  it("is empty while either half is unset, and names both once set", () => {
    expect(sellerFooterHtml()).toBe("");
    expect(sellerFooterText()).toBe("");
    expect(sellerFooterHtml({ legalName: "A", postalAddress: "" })).toBe("");
    expect(sellerFooterText(SET)).toBe("Example & Sons LLC · 1 Example Street, Springfield, CA 90000, USA");
    expect(sellerFooterHtml(SET)).toContain("Example &amp; Sons LLC");
  });
});
