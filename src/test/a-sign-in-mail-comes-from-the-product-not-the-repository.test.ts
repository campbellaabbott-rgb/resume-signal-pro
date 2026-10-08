// @vitest-environment node
/**
 * A SIGN-IN MAIL COMES FROM THE PRODUCT, NOT THE REPOSITORY (wave 2 email-ops,
 * register L10-09).
 *
 * WHAT WAS WRONG. auth-email-hook's SITE_NAME was "resume-signal-pro", the
 * internal repository name. It is the From display name of every magic link,
 * email-change, invite and reauthentication mail, and it is printed inside each
 * template ("Your login link for resume-signal-pro"). Every other mail we send
 * says Resume Booster, so the security-sensitive mails were the ones from an
 * unfamiliar sender.
 *
 * WHAT HOLDS NOW, by running the shipped hook with only its network faked (the
 * webhook verifier, React Email's renderer and the queue): the queued magic
 * link is from "Resume Booster <noreply@...>" and its body names Resume Booster
 * and never the repository.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const db = new FakeDb();
const queued: Array<Record<string, unknown>> = [];
let handler: EdgeHandler;

/** A React stand-in that renders function components eagerly into a plain tree. */
const REACT = `
  export function createElement(type, props, ...children) {
    const p = { ...(props || {}), children: children.length <= 1 ? children[0] : children };
    return typeof type === "function" ? type(p) : { type, props: p };
  }
  export const Fragment = "fragment";
  export default { createElement, Fragment };
`;
/** React Email's components as plain tags, and a renderer that keeps only the text. */
const REACT_EMAIL = `
  const tag = (name) => (p) => ({ type: name, props: p });
  export const Body = tag("body"), Button = tag("a"), Container = tag("div"), Head = tag("head"), Heading = tag("h1"),
    Html = tag("html"), Link = tag("a"), Preview = tag("div"), Text = tag("p"), Section = tag("div"), Img = tag("img"), Hr = tag("hr");
  const text = (n) => n == null || n === false ? "" : typeof n === "string" || typeof n === "number" ? String(n)
    : Array.isArray(n) ? n.map(text).join("") : text(n.props && n.props.children);
  export async function renderAsync(tree) { return text(tree); }
`;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LOVABLE_API_KEY: "lov" };
  g.__fakeSupabase = db;
  db.rpcs.enqueue_email = (a) => { queued.push(a.payload as Record<string, unknown>); return { data: 1, error: null }; };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("auth-email-hook", {
    "npm:react@18.3.1": REACT,
    "npm:@react-email/components@0.0.22": REACT_EMAIL,
    "npm:@lovable.dev/email-js": "export const parseEmailWebhookPayload = (x) => x;",
    "npm:@lovable.dev/webhooks-js":
      "export class WebhookError extends Error {}; export async function verifyWebhookRequest({ req }) { return { payload: await req.json() }; }",
    "npm:@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
  });
}, 60_000);

describe("the auth mails carry the product's name", () => {
  it("a magic link is queued from Resume Booster, and its text names Resume Booster, never the repository", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/auth-email-hook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: "run-1", version: "1", data: { action_type: "magiclink", email: "person@example.com", url: "https://resumebooster.work/auth?x=1" } }),
    }));
    expect(res.status).toBe(200);
    expect(queued).toHaveLength(1);
    const [m] = queued;
    expect(String(m.from)).toMatch(/^Resume Booster <noreply@/);
    expect(String(m.html) + String(m.text)).toContain("Resume Booster");
    expect(JSON.stringify(m), "the repository name reached a person's inbox").not.toMatch(/resume-signal-pro/);
  });

  it("the preflight answers its build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/auth-email-hook", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^auth-email-hook\.2026-10-(0[89]|[1-3]\d)\.\d+$/);
  });
});
