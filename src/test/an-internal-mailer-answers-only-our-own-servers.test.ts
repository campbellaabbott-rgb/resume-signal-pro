// @vitest-environment node
/**
 * AN INTERNAL MAILER ANSWERS ONLY OUR OWN SERVERS.
 *
 * WHAT WAS WRONG (defect sweep 2026-10-02, 1.15 and 2.08). send-product-email,
 * send-analysis-email and send-affiliate-commission-email send from the
 * verified reports@resumebooster.work to whatever address the body names, with
 * a subject and part of the body the body also supplies. None checked its
 * caller: the first two are verify_jwt=false, and the third accepted the
 * publishable key that ships in every visitor's browser. So each was a relay
 * for mail that passes SPF and DKIM for our domain -- "Refund of $299 pending",
 * "You earned $500.00 commission!" -- as often as a script cared to post it.
 * Two values (overallScore, atsScore) even reached the HTML unescaped.
 *
 * THE FIX. Each refuses any caller whose bearer is not the service-role key,
 * before it reads its mail configuration, and every one of our functions that
 * calls them now sends that key instead of the publishable one.
 *
 * So the handlers are RUN, bundled from the shipped index.ts with only Resend
 * and the database faked, and the callers are census'd: every reference to
 * these three names anywhere in the repository is either a server caller
 * carrying the service key, or a comment/test -- never a browser invoke.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bearerOf, isServiceRoleCaller, sameSecret } from "../../supabase/functions/_shared/service-caller";

const ROOT = resolve(__dirname, "../..");
const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const ANON = "anon_publishable_key_for_the_harness_0123456789";

type Sent = { from: string; to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const RESEND = "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__sent.push(m); return { data: { id: 'em_1' }, error: null }; } }; } }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
  "https://esm.sh/resend@2.0.0": RESEND,
  "https://esm.sh/resend@4.0.0": RESEND,
};

const handlers: Record<string, EdgeHandler> = {};
const db = new FakeDb();
db.rpcs.log_email_send = () => ({ data: null, error: null });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    SUPABASE_ANON_KEY: ANON,
    RESEND_API_KEY: "re_harness",
  };
  g.__sent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  for (const fn of ["send-product-email", "send-analysis-email", "send-affiliate-commission-email"]) {
    handlers[fn] = await loadEdgeHandler(fn, STUBS);
  }
}, 60_000);

afterEach(() => { sent.length = 0; });

const BODIES: Record<string, Record<string, unknown>> = {
  "send-product-email": {
    email: "victim@corp.example", productType: "basic_keyword_fix",
    productName: "Refund of $299 pending - action required",
    generatedContent: { overallScore: '<a href="https://evil.example">Claim refund</a>' },
  },
  "send-analysis-email": {
    email: "victim@corp.example",
    analysisData: { atsScore: { score: '<a href="https://evil.example">x</a>' } },
  },
  "send-affiliate-commission-email": {
    affiliateEmail: "victim@corp.example", productName: "Pro Plan", saleAmount: 99900, commissionAmount: 50000, referralCode: "abc123",
  },
};

const post = (fn: string, auth: string | null, body = BODIES[fn]) =>
  handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth === null ? {} : { authorization: auth }), apikey: ANON },
    body: JSON.stringify(body),
  }));

describe("the three internal mailers refuse every caller but the service role", () => {
  for (const fn of Object.keys(BODIES)) {
    it(`${fn}: no bearer, the publishable key, or a near-miss -> 401 and nothing sent`, async () => {
      for (const auth of [null, `Bearer ${ANON}`, `Bearer ${SERVICE.slice(0, -1)}x`, `Bearer ${SERVICE} `.slice(0, 7), "Basic abc"]) {
        const res = await post(fn, auth);
        expect(res.status, `${fn} with ${String(auth).slice(0, 20)}`).toBe(401);
      }
      expect(sent, `${fn} sent mail for a caller it refused`).toEqual([]);
    });

    it(`${fn}: the service-role bearer is served, to the address our server named`, async () => {
      const res = await post(fn, `Bearer ${SERVICE}`);
      expect(res.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toEqual(["victim@corp.example"]);
      expect(sent[0].from).toMatch(/@resumebooster\.work>$/);
    });

    it(`${fn}: the preflight answers its build, so a deploy is provable without a send`, async () => {
      const res = await handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
      // Built on 2026-10-04 (the internal-only build) or any later day.
      const m = new RegExp(`^${fn}\\.(\\d{4}-\\d{2}-\\d{2})\\.\\d+$`).exec(res.headers.get("x-fn-build") ?? "");
      expect(m, `x-fn-build = ${res.headers.get("x-fn-build")}`).not.toBeNull();
      expect(m![1] >= "2026-10-04").toBe(true);
    });
  }

  it("a score is a number, never markup, even from a trusted caller", async () => {
    await post("send-product-email", `Bearer ${SERVICE}`);
    await post("send-analysis-email", `Bearer ${SERVICE}`);
    for (const m of sent) expect(m.html, m.subject).not.toMatch(/evil\.example|<a href="https:\/\/evil/);
    sent.length = 0;
    await post("send-product-email", `Bearer ${SERVICE}`, { ...BODIES["send-product-email"], generatedContent: { overallScore: 85 } });
    expect(sent[0].html).toMatch(/>85%</);
  });

  it("the commission notice links to our own domain, not a stranger's", async () => {
    await post("send-affiliate-commission-email", `Bearer ${SERVICE}`);
    const links = [...sent[0].html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toMatch(/^https:\/\/resumebooster\.work\//);
  });
});

describe("the caller check itself", () => {
  const H = (o: Record<string, string>) => new Headers(o);
  it("reads only a Bearer token, case-insensitively, trimmed", () => {
    expect(bearerOf(H({ authorization: "Bearer abc" }))).toBe("abc");
    expect(bearerOf(H({ authorization: "bearer   abc  " }))).toBe("abc");
    expect(bearerOf(H({ authorization: "Basic abc" }))).toBe("");
    expect(bearerOf(H({}))).toBe("");
  });
  it("never matches an empty or short configured key (an unset env var)", () => {
    expect(isServiceRoleCaller(H({ authorization: "Bearer " }), "")).toBe(false);
    expect(isServiceRoleCaller(H({ authorization: "Bearer short" }), "short")).toBe(false);
    expect(isServiceRoleCaller(H({ authorization: `Bearer ${SERVICE}` }), SERVICE)).toBe(true);
    expect(isServiceRoleCaller(H({ apikey: SERVICE }), SERVICE)).toBe(false);
    expect(sameSecret("a", "ab")).toBe(false);
  });
});

// ── the census: every caller, everywhere ─────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|sql|sh)$/.test(name)) out.push(p);
  }
  return out;
}

const INTERNAL = ["send-product-email", "send-analysis-email", "send-affiliate-commission-email"];

// Read ONCE, at load: every source file in the places a caller could live
// (edge functions, the browser bundle, scripts, migrations for a pg_cron
// caller, the worker) that names any of the three. Reading the tree once per
// assertion cost seconds per test in a loaded suite.
const HAYSTACK: Array<[string, string]> = ["src", "scripts", "supabase", "worker/src"]
  .flatMap((d) => { try { return walk(resolve(ROOT, d)); } catch { return []; } })
  .map((f) => [f, readFileSync(f, "utf8")] as [string, string])
  .filter(([, src]) => INTERNAL.some((fn) => src.includes(fn)));

describe("every caller of an internal mailer is one of our servers, carrying the service key", () => {
  it("finds the server callers it exists to watch (an empty census passes vacuously)", () => {
    const callers = HAYSTACK.filter(([f, src]) => f.includes("/supabase/functions/") && /fetch\(`\$\{[^}]+\}\/functions\/v1\/send-(product|analysis|affiliate-commission)-email`/.test(src));
    const names = [...new Set(callers.map(([f]) => f.split("/supabase/functions/")[1].split("/")[0]))].sort();
    expect(names).toEqual(["analyze-resume", "retry-failed-deliveries", "stripe-webhook", "verify-product-purchase"]);
  });

  for (const fn of INTERNAL) {
    it(`${fn}: each fetch carries the service-role key, and no browser code invokes it`, () => {
      let fetches = 0;
      for (const [f, src] of HAYSTACK) {
        if (!src.includes(fn)) continue;
        if (f.includes("/src/") && !f.includes("/src/test/")) {
          expect(src, `${f} references ${fn}: a browser has no business calling an internal mailer`).not.toMatch(new RegExp(`invoke\\(\\s*["'\`]${fn}`));
        }
        const lines = src.split("\n");
        lines.forEach((l, i) => {
          if (!new RegExp(`fetch\\(.*functions/v1/${fn}`).test(l)) return;
          fetches++;
          const window = lines.slice(i, i + 9).join("\n");
          expect(window, `${f}:${i + 1} calls ${fn} without the service-role key`).toMatch(/Bearer \$\{(?:Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)|supabaseServiceKey)\}/);
          expect(window, `${f}:${i + 1} still sends the publishable key to ${fn}`).not.toMatch(/SUPABASE_ANON_KEY/);
        });
      }
      expect(fetches, `no server fetch of ${fn} was found -- has the call moved?`).toBeGreaterThan(0);
    });
  }
});
