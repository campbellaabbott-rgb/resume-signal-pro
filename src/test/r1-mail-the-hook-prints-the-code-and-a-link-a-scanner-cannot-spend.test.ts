// @vitest-environment node
/**
 * THE HOOK PRINTS THE CODE AND A LINK A SCANNER CANNOT SPEND (R1 mail, plan
 * group CP-A items 1 and 2; register CP-010, CP-009).
 *
 * WHAT WAS WRONG. Every auth mail carried only GoTrue's one-time verify link.
 * A mail scanner that fetches links spent it before the person clicked, a link
 * cannot finish a sign-in inside a connector pop-up, and the code GoTrue issued
 * with the mail (payload.data.token) was never printed. An email change mailed
 * one token's link to one address and told the other nothing.
 *
 * WHAT HOLDS NOW, by running the shipped auth-email-hook with only its network
 * faked (the signed-webhook verifier, React Email's renderer, the queue):
 *   - the queued mail prints the code above the button, with its expiry and
 *     the "ignore it" line, in the HTML and the plain text;
 *   - the button opens resumebooster.work/auth?mode=confirm with the token
 *     hash parsed out of payload.data.url and the action type, and falls back
 *     to payload.data.url only when no hash parses (Lovable's default link);
 *   - each queued mail carries idempotency_key 'auth:'+run_id;
 *   - email_change: the link goes only to payload.data.email; the other
 *     address gets a notice with no link, and a stranger never sees the
 *     account holder's address in full;
 *   - Lovable's contract is untouched: the verifier gets LOVABLE_API_KEY and
 *     parseEmailWebhookPayload, a bad signature is a 401, a version other
 *     than '1' is a 400.
 *
 * Lovable's "set up emails" step can regenerate this function. If it does,
 * this file fails: it is the guard the plan asks for (CP-A, review item
 * "Lovable can silently undo CP-A").
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const db = new FakeDb();
const queued: Array<Record<string, unknown>> = [];
let handler: EdgeHandler;

/** A React stand-in that calls function components eagerly into a plain tree. */
const REACT = `
  export function createElement(type, props, ...children) {
    const p = { ...(props || {}), children: children.length <= 1 ? children[0] : children };
    return typeof type === "function" ? type(p) : { type, props: p };
  }
  export const Fragment = "fragment";
  export default { createElement, Fragment };
`;
/**
 * React Email's components as tags, and a renderer that keeps the text and
 * the href of every link, so the test can read the button's target. Plain
 * text mode prints a link as "text [href]", as React Email's does.
 */
const REACT_EMAIL = `
  const tag = (name) => (p) => ({ type: name, props: p });
  export const Body = tag("body"), Button = tag("a"), Container = tag("div"), Head = tag("head"), Heading = tag("h1"),
    Html = tag("html"), Link = tag("a"), Preview = tag("div"), Text = tag("p"), Section = tag("div"), Img = tag("img"), Hr = tag("hr");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html = (n) => n == null || n === false ? "" : typeof n === "string" || typeof n === "number" ? esc(n)
    : Array.isArray(n) ? n.map(html).join("")
    : "<" + n.type + (n.props && n.props.href ? ' href="' + esc(n.props.href) + '"' : "") + ">" + html(n.props && n.props.children) + "</" + n.type + ">";
  const text = (n) => n == null || n === false ? "" : typeof n === "string" || typeof n === "number" ? String(n)
    : Array.isArray(n) ? n.map(text).join("")
    : text(n.props && n.props.children) + (n.props && n.props.href ? " [" + n.props.href + "]" : "") + (n.type === "p" || n.type === "h1" ? "\\n" : "");
  export async function renderAsync(tree, opts) { return opts && opts.plainText ? text(tree) : html(tree); }
`;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LOVABLE_API_KEY: "lov" };
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("auth-email-hook", {
    "npm:react@18.3.1": REACT,
    "npm:@react-email/components@0.0.22": REACT_EMAIL,
    "npm:@lovable.dev/email-js": `
      export function parseEmailWebhookPayload(body) { return JSON.parse(body); }
      parseEmailWebhookPayload.isLovableParser = true;
    `,
    "npm:@lovable.dev/webhooks-js": `
      export class WebhookError extends Error { constructor(code, message) { super(message); this.code = code; } }
      export async function verifyWebhookRequest({ req, secret, parser }) {
        globalThis.__verifyArgs = { secret, parser };
        if (req.headers.get("x-test-signature") === "bad") throw new WebhookError("invalid_signature", "signature mismatch");
        const body = await req.text();
        return { body, payload: parser(body), timestamp: "0" };
      }
    `,
    "npm:@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
  });
}, 60_000);

beforeEach(() => {
  queued.length = 0;
  delete (db as unknown as { auth?: unknown }).auth;
  db.tables = {}; db.writes = [];
  db.rpcs = { enqueue_email: (a) => { queued.push(a.payload as Record<string, unknown>); return { data: 1, error: null }; } };
});

const HASH = "9f2b6c1d4e8a7f3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d";
const verifyUrl = (type: string, token = HASH) =>
  `https://bwhdazbotpblihdxcmho.supabase.co/auth/v1/verify?token=${token}&type=${type}&redirect_to=https%3A%2F%2Fresumebooster.work%2F`;
const hook = (data: Record<string, unknown>, extra: { run_id?: string; version?: string; headers?: Record<string, string> } = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/auth-email-hook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(extra.headers ?? {}) },
    body: JSON.stringify({ run_id: extra.run_id ?? "run-1", version: extra.version ?? "1", type: "auth", data }),
  }));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const confirmFor = (type: string) => `https://resumebooster.work/auth?mode=confirm&token_hash=${HASH}&type=${type}`;

describe("each auth mail prints the code above a button that opens our confirm page", () => {
  for (const type of ["magiclink", "recovery", "signup", "invite"]) {
    it(`${type}: code, expiry, the ignore line, then a Continue button to /auth?mode=confirm with the hash and the type`, async () => {
      const res = await hook({ action_type: type, email: "Person@Example.com", url: verifyUrl(type), token: "483920" }, { run_id: `run-${type}` });
      expect(res.status).toBe(200);
      expect(queued).toHaveLength(1);
      const [m] = queued;
      const html = String(m.html);
      const text = String(m.text);
      expect(html).toContain("483920");
      expect(text, "the plain-text part has no code").toContain("483920");
      expect(html).toContain("It expires in 15 minutes.");
      expect(html).toContain("If you didn't ask for this, you can ignore it.");
      const links = hrefs(html);
      expect(links, "the button must open our confirm page, never GoTrue's spendable verify link").toContain(confirmFor(type));
      expect(links.some((l) => l.includes("/auth/v1/verify"))).toBe(false);
      expect(html.indexOf("483920"), "the code must come before the button").toBeLessThan(html.indexOf(`href="${confirmFor(type).replace(/&/g, "&amp;")}"`));
      expect(m.idempotency_key).toBe(`auth:run-${type}`);
      expect(m.to).toBe("person@example.com");
      expect(String(m.from)).toMatch(/^Resume Booster <noreply@notify\.resumebooster\.work>$/);
      expect(db.rows("email_send_log").map((r) => [r.message_id, r.status])).toEqual([[m.message_id, "pending"]]);
    });
  }

  it("Lovable's default link carries no hash we can read: the button keeps payload.data.url", async () => {
    const lovableDefault = "https://resumebooster.work/#access_token=abc&type=magiclink";
    await hook({ action_type: "magiclink", email: "a@example.com", url: lovableDefault, token: "111222" });
    expect(hrefs(String(queued[0].html))).toEqual([lovableDefault]);
    expect(String(queued[0].html)).toContain("111222");
  });

  it("a link whose token is the six-digit code itself is not a hash: the button keeps payload.data.url", async () => {
    const url = verifyUrl("magiclink", "654321");
    await hook({ action_type: "magiclink", email: "a@example.com", url, token: "654321" });
    expect(hrefs(String(queued[0].html))).toEqual([url]);
  });

  it("a payload that names token_hash directly is read first", async () => {
    await hook({ action_type: "recovery", email: "a@example.com", url: "https://resumebooster.work/auth", token_hash: HASH, token: "100200" });
    expect(hrefs(String(queued[0].html))).toEqual([confirmFor("recovery")]);
  });

  it("reauthentication prints the code and no link", async () => {
    await hook({ action_type: "reauthentication", email: "a@example.com", token: "777888" });
    const html = String(queued[0].html);
    expect(html).toContain("777888");
    expect(html).toContain("It expires in 15 minutes.");
    expect(hrefs(html)).toEqual([]);
  });
});

describe("the page's own redirect is read back from the link (S12-178, S12-180)", () => {
  const withRedirect = (type: string, redirect: string) =>
    `https://bwhdazbotpblihdxcmho.supabase.co/auth/v1/verify?token=${HASH}&type=${type}&redirect_to=${encodeURIComponent(redirect)}`;

  it("the safe next the sign-in page asked for rides the confirm link, so another device lands there too", async () => {
    await hook({ action_type: "magiclink", email: "a@example.com", url: withRedirect("magiclink", "https://resumebooster.work/auth?mode=confirm&next=%2Fjobs%3Fq%3Dnurse"), token: "121212" });
    expect(hrefs(String(queued[0].html))).toEqual([`${confirmFor("magiclink")}&next=%2Fjobs%3Fq%3Dnurse`]);
  });

  it("an off-site or scheme next is dropped, never copied into the mail", async () => {
    for (const evil of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      queued.length = 0;
      await hook({ action_type: "magiclink", email: "a@example.com", url: withRedirect("magiclink", `https://resumebooster.work/auth?mode=confirm&next=${encodeURIComponent(evil)}`), token: "131313" });
      expect(hrefs(String(queued[0].html)), evil).toEqual([confirmFor("magiclink")]);
    }
  });

  it("the language the page named writes the mail: subject, words and lang, with the code and link unchanged", async () => {
    await hook({ action_type: "recovery", email: "a@example.com", url: withRedirect("recovery", "https://resumebooster.work/auth?mode=reset&lng=de"), token: "141414" }, { run_id: "run-de" });
    const [m] = queued;
    const html = String(m.html);
    expect(m.subject).toBe("Passwort zurücksetzen");
    expect(html).toContain("Er läuft in 15 Minuten ab.");
    expect(html).toContain("Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.");
    expect(html).not.toContain("It expires in");
    expect(html).toContain("141414");
    expect(hrefs(html)).toEqual([confirmFor("recovery")]);
  });

  it("every language the site speaks has its own words, and an unknown one reads as English", async () => {
    const seen = new Set<string>();
    for (const lng of ["en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl", "xx"]) {
      queued.length = 0;
      await hook({ action_type: "magiclink", email: "a@example.com", url: withRedirect("magiclink", `https://resumebooster.work/auth?mode=confirm&lng=${lng}`), token: "151515" });
      seen.add(String(queued[0].subject));
      expect(String(queued[0].html), lng).toContain("151515");
    }
    expect(seen.size, [...seen].join(" | ")).toBe(8);
    queued.length = 0;
    await hook({ action_type: "magiclink", email: "a@example.com", url: withRedirect("magiclink", "https://resumebooster.work/auth?mode=confirm&lng=xx"), token: "161616" });
    expect(queued[0].subject).toBe("Your sign-in code");
  });
});

describe("email_change: the link only to payload.data.email, a notice with no link to the other address", () => {
  it("data.email is the current address: its link mail names the new address; the new address gets a linkless notice with the old one masked", async () => {
    const res = await hook({ action_type: "email_change", email: "old@example.com", new_email: "new@example.org", url: verifyUrl("email_change"), token: "246810" }, { run_id: "run-ec" });
    expect(res.status).toBe(200);
    expect(queued.map((q) => [q.to, q.label, q.idempotency_key])).toEqual([
      ["old@example.com", "email_change", "auth:run-ec"],
      ["new@example.org", "email_change_notice", "auth:run-ec:notice"],
    ]);
    const [link, notice] = queued.map((q) => String(q.html));
    expect(hrefs(link)).toEqual([confirmFor("email_change")]);
    expect(link).toContain("246810");
    expect(link, "the current address sees where the change goes").toContain("new@example.org");
    expect(hrefs(notice), "the notice must carry no link at all").toEqual([]);
    expect(notice).not.toContain("246810");
    expect(notice, "a stranger typed as the new address must not learn the account holder's address").not.toContain("old@example.com");
    expect(notice).toContain("o***@example.com");
    expect(db.rows("email_send_log").map((r) => [r.recipient_email, r.template_name, r.status])).toEqual([
      ["old@example.com", "email_change", "pending"],
      ["new@example.org", "email_change_notice", "pending"],
    ]);
  });

  it("data.email is the new address (a fan-out's second half): the link goes to it, the current address gets the notice in full", async () => {
    await hook({ action_type: "email_change", email: "new@example.org", old_email: "old@example.com", new_email: "new@example.org", url: verifyUrl("email_change"), token: "135791" }, { run_id: "run-ec2" });
    expect(queued.map((q) => [q.to, q.label])).toEqual([["new@example.org", "email_change"], ["old@example.com", "email_change_notice"]]);
    const [link, notice] = queued.map((q) => String(q.html));
    expect(link).not.toContain("old@example.com");
    expect(link).toContain("o***@example.com");
    expect(notice).toContain("old@example.com");
    expect(notice).toContain("new@example.org");
    expect(hrefs(notice)).toEqual([]);
  });

  it("with only one address in the payload and no user id there is no one else to tell: one mail", async () => {
    await hook({ action_type: "email_change", email: "solo@example.com", url: verifyUrl("email_change"), token: "112233" });
    expect(queued.map((q) => q.label)).toEqual(["email_change"]);
  });

  // LEAD DECISION H (third fixer round): Account.tsx already offers "Change
  // email" (m9 is live). When Lovable's payload names only the new address
  // (data.email is the new address, no old_email), the account's CURRENT
  // address is read from the user record by the payload's user id with the
  // service role, and gets the no-link notice in full.
  it("data.email is the new address and the payload carries no old_email: the current address is read by the payload's user id and gets the notice in full", async () => {
    const looked: string[] = [];
    (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async (id: string) => { looked.push(id); return { data: { user: { id, email: "current@example.com", new_email: "new@example.org" } }, error: null }; } } };
    const res = await hook({ action_type: "email_change", email: "new@example.org", new_email: "new@example.org", user_id: "u-77", url: verifyUrl("email_change"), token: "778899" }, { run_id: "run-ec3" });
    expect(res.status).toBe(200);
    expect(looked).toEqual(["u-77"]);
    expect(queued.map((q) => [q.to, q.label, q.idempotency_key])).toEqual([["new@example.org", "email_change", "auth:run-ec3"], ["current@example.com", "email_change_notice", "auth:run-ec3:notice"]]);
    const [link, notice] = queued.map((q) => String(q.html));
    expect(hrefs(notice)).toEqual([]);
    expect(notice).not.toContain("778899");
    expect(notice, "the current address is told in full where the change goes").toContain("new@example.org");
    expect(notice).toContain("current@example.com");
    expect(link, "the new address must not learn the current one in full").not.toContain("current@example.com");
    expect(link).toContain("c***@example.com");
  });

  it("the user id may ride as user.id or id; a lookup that fails queues the link and no notice, without failing the hook", async () => {
    const looked: string[] = [];
    (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async (id: string) => { looked.push(id); return { data: { user: { id, email: "current@example.com" } }, error: null }; } } };
    await hook({ action_type: "email_change", email: "new@example.org", user: { id: "u-78" }, url: verifyUrl("email_change"), token: "112233" });
    expect(looked).toEqual(["u-78"]);
    expect(queued.map((q) => q.to)).toEqual(["new@example.org", "current@example.com"]);
    queued.length = 0;
    (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => { throw new Error("admin api down"); } } };
    const res = await hook({ action_type: "email_change", email: "new@example.org", id: "u-79", url: verifyUrl("email_change"), token: "112233" });
    expect(res.status).toBe(200);
    expect(queued.map((q) => q.label)).toEqual(["email_change"]);
  });

  it("with old_email in the payload the user record is not read", async () => {
    let looked = 0;
    (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => { looked++; return { data: { user: null }, error: null }; } } };
    await hook({ action_type: "email_change", email: "new@example.org", old_email: "old@example.com", user_id: "u-80", url: verifyUrl("email_change"), token: "135791" });
    expect(looked).toBe(0);
    expect(queued.map((q) => q.to)).toEqual(["new@example.org", "old@example.com"]);
  });

  it("a notice that fails to queue does not fail the link that queued", async () => {
    let n = 0;
    db.rpcs.enqueue_email = (a) => (++n === 2 ? { data: null, error: { message: "boom" } } : (queued.push(a.payload as Record<string, unknown>), { data: 1, error: null }));
    const res = await hook({ action_type: "email_change", email: "old@example.com", new_email: "new@example.org", url: verifyUrl("email_change"), token: "246810" });
    expect(res.status).toBe(200);
    expect(queued.map((q) => q.label)).toEqual(["email_change"]);
    expect(db.rows("email_send_log").filter((r) => r.status === "failed").map((r) => r.template_name)).toEqual(["email_change_notice"]);
  });
});

describe("Lovable's signed contract is kept exactly", () => {
  it("the verifier gets LOVABLE_API_KEY and Lovable's own payload parser", async () => {
    await hook({ action_type: "magiclink", email: "a@example.com", url: verifyUrl("magiclink"), token: "123123" });
    const args = (globalThis as Record<string, unknown>).__verifyArgs as { secret: string; parser: { isLovableParser?: boolean } };
    expect(args.secret).toBe("lov");
    expect(args.parser.isLovableParser).toBe(true);
  });

  it("a bad signature is a 401 and queues nothing", async () => {
    const res = await hook({ action_type: "magiclink", email: "a@example.com" }, { headers: { "x-test-signature": "bad" } });
    expect(res.status).toBe(401);
    expect(queued).toEqual([]);
  });

  it("a payload version other than '1' is a 400; a payload with no run_id is a 400", async () => {
    expect((await hook({ action_type: "magiclink", email: "a@example.com" }, { version: "2" })).status).toBe(400);
    expect((await hook({ action_type: "magiclink", email: "a@example.com" }, { run_id: "" })).status).toBe(400);
    expect(queued).toEqual([]);
  });

  it("the preflight and every answer name this build and expose it", async () => {
    const pre = await handler(new Request("https://harness.supabase.co/functions/v1/auth-email-hook", { method: "OPTIONS" }));
    expect(pre.headers.get("x-fn-build")).toBe("auth-email-hook.2026-10-14.1");
    expect(pre.headers.get("access-control-expose-headers")).toBe("x-fn-build");
    const res = await hook({ action_type: "magiclink", email: "a@example.com", url: verifyUrl("magiclink"), token: "123123" });
    expect(res.headers.get("x-fn-build")).toBe("auth-email-hook.2026-10-14.1");
  });
});
