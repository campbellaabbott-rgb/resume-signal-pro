// @vitest-environment node
/**
 * A RÉSUMÉ NEVER RIDES A STRIPE SESSION, AND WHAT THE SITE SAYS ABOUT KEEPING
 * ONE IS WHAT THE CODE DOES.
 *
 * WHAT WAS WRONG (register 1.21, 1.55).
 *   1. create-checkout copied the first 500 characters of every full-analysis
 *      buyer's résumé into the Stripe session's metadata. Stripe kept it, and
 *      stripe-webhook stored the session again in webhook_events, which has no
 *      retention. Nothing ever read it.
 *   2. Meanwhile /trust, the FAQ, the hero, /data-api, llms.txt and the SEO
 *      pages told every visitor, in nine languages, that résumés are never
 *      stored. The product stores them: a 24-hour temporary store filled on
 *      every upload, a 7-day report cache that quotes the opening of the CV,
 *      saved versions, the matching résumé, the apply agent's CV file. Four of
 *      the clocks that were written down were enforced by nothing.
 *
 * WHAT THIS FILE HOLDS IN PLACE.
 *   - create-checkout and stripe-webhook are RUN (bundled with esbuild against
 *     stubs, the way the other edge tests run them) and asked to carry or store
 *     a résumé; neither does.
 *   - The migration's key list, trigger, scrub, jobs and self-verify exist, and
 *     the numbers the page prints are the numbers the code enforces.
 *   - No served surface makes the categorical claim again while the product
 *     stores résumés -- and the precondition is asserted, so the guard cannot
 *     pass by finding no storage.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { FakeDb, loadEdgeHandler } from "./helpers/edge-harness";
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";
import { RESUME_BEARING_METADATA_KEYS, withoutResumeText } from "../../supabase/functions/_shared/webhook-payload";
import {
  AI_CACHE_MAX_HOURS,
  PRIVACY_EMAIL,
  REPORT_CACHE_DAYS,
  SHARED_ANALYSIS_DAYS,
  TEMP_RESUME_HOURS,
} from "@/lib/resume-retention";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const MIGRATION = readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.startsWith("20261004150000_"));
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const locale = (l: string) => JSON.parse(read(`src/i18n/locales/${l}.json`));
const at = (o: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);

// A recognisable résumé header, so "no part of it" is checkable as a substring.
const RESUME_HEADER = "Jordan Probe-Candidate\njordan.probe@example.com | +1 555 0100 | 12 Harness Lane, Testville";
const RESUME = `${RESUME_HEADER}\n\nEXPERIENCE\nSenior Analyst, Example Corp (2019-2026)\n- Led a team of six analysts.\n`.repeat(3);

// ---------------------------------------------------------------------------
// 1. create-checkout, run.
// ---------------------------------------------------------------------------
describe("create-checkout sends Stripe no résumé text", () => {
  type StripeCall = { params: { metadata: Record<string, string> } & Record<string, unknown> };
  const stripeCalls: StripeCall[] = [];
  const startCalls: Array<Record<string, unknown>> = [];
  let handler: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test_harness" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
    g.__stripeCalls = stripeCalls;
    const db = new FakeDb();
    db.rpcs.check_rate_limit = () => ({ data: true, error: null });
    db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
    db.rpcs.record_checkout_start = (args) => { startCalls.push(args); return { data: true, error: null }; };
    g.__fakeSupabase = db;
    handler = await loadEdgeHandler("create-checkout", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/stripe@18.5.0": `export default class Stripe {
        constructor() {
          this.checkout = { sessions: { create: async (params) => {
            globalThis.__stripeCalls.push({ params });
            const li = params.line_items[0].price_data;
            return { id: "cs_test_harness_" + globalThis.__stripeCalls.length, url: "https://checkout.stripe.test/x", amount_total: li.unit_amount, currency: li.currency, mode: params.mode };
          } } };
          this.promotionCodes = { list: async () => ({ data: [] }) };
        }
      }`,
      "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__fakeSupabase;",
    });
  }, 60_000);

  async function checkout(body: Record<string, unknown>) {
    return handler(new Request("https://harness.supabase.co/functions/v1/create-checkout", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", origin: "https://resumebooster.work" },
      body: JSON.stringify(body),
    }));
  }

  it("a body that still carries the résumé (an old cached bundle) mints a session whose metadata holds none of it", async () => {
    const res = await checkout({ resumeData: RESUME, currency: "usd", hasLinkedIn: false, tempSessionId: "8a6f7d3e-1b2c-4d5e-9f00-112233445566" });
    expect(res.status).toBe(200);
    expect(stripeCalls).toHaveLength(1);
    const params = stripeCalls[0].params;
    // Nothing a person wrote: not the key, and not a byte of the text anywhere in the request to Stripe.
    expect(Object.keys(params.metadata).sort()).toEqual(["baseAmountUSD", "originalCurrency", "product_type"]);
    const sent = JSON.stringify(params);
    for (const fragment of ["Jordan Probe-Candidate", "jordan.probe@example.com", "555 0100", "Harness Lane", "EXPERIENCE"]) {
      expect(sent, `Stripe was sent "${fragment}"`).not.toContain(fragment);
    }
    // The temporary-store id is a bearer reference to the text (get_temp_resume
    // is anon-callable for its 24 hours), so it does not go to Stripe either.
    expect(sent).not.toContain("8a6f7d3e-1b2c-4d5e-9f00-112233445566");
    // The product is still the full analysis, so delivery still recognises it.
    expect(params.metadata.product_type).toBe("full_analysis");
    // And the checkout-start record carries none of it.
    expect(JSON.stringify(startCalls)).not.toContain("Jordan Probe-Candidate");
  });

  it("the body the page sends now carries no résumé, and the checkout still works", async () => {
    const res = await checkout({ currency: "eur", hasLinkedIn: true, tempSessionId: "8a6f7d3e-1b2c-4d5e-9f00-112233445566" });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://checkout.stripe.test/x");
    expect(stripeCalls.at(-1)!.params.metadata).toMatchObject({ originalCurrency: "eur", product_type: "full_analysis" });
  });

  it("answers its build on the preflight, so the deploy is provable without minting a session", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/create-checkout", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toBe("create-checkout.2026-10-04.no-resume-metadata");
  });
});

describe("the homepage no longer posts the résumé to create-checkout", () => {
  it("the createCheckout call's body names no résumé text", () => {
    const code = codeOf(read("src/pages/Index.tsx"));
    const start = code.indexOf("resilientCallers.createCheckout({");
    expect(start, "the checkout call moved -- point this guard at it").toBeGreaterThan(0);
    const body = code.slice(start, code.indexOf("});", start));
    expect(body).not.toMatch(/resumeData|contentToAnalyze|resumeText/);
    expect(body).toMatch(/tempSessionId/);
  });
});

describe("no function that mints a Checkout session writes résumé text into its metadata", () => {
  const FN = resolve(ROOT, "supabase/functions");
  const minters = readdirSync(FN, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(FN, d.name, "index.ts")))
    .map((d) => d.name)
    .filter((n) => codeOf(read(`supabase/functions/${n}/index.ts`)).includes("checkout.sessions.create("));

  it("finds the minters (a guard over nothing would pass)", () => {
    expect(minters).toContain("create-checkout");
    expect(minters).toContain("create-product-checkout");
  });

  for (const fn of minters) {
    it(`${fn}: every metadata block is free of résumé, LinkedIn and job-description text`, () => {
      const code = codeOf(read(`supabase/functions/${fn}/index.ts`));
      let i = code.indexOf("metadata: {");
      while (i >= 0) {
        const block = code.slice(i, code.indexOf("}", i) + 1);
        expect(block, `${fn}: ${block}`).not.toMatch(/resume(Data|Text|_text|Content)|contentToAnalyze|linkedin(Text|_text|Content)|job_?description(Text|_text)?/i);
        i = code.indexOf("metadata: {", i + 1);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. stripe-webhook, run.
// ---------------------------------------------------------------------------
describe("stripe-webhook stores no résumé text from the events old sessions still send", () => {
  type Logged = { p_payload?: { id?: string; metadata?: Record<string, string> } } & Record<string, unknown>;
  const logged: Logged[] = [];
  let handler: (req: Request) => Promise<Response>;
  const pending: Promise<unknown>[] = [];

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = {
      STRIPE_WEBHOOK_SECRET: "whsec_harness",
      STRIPE_SECRET_KEY: "sk_test_harness",
      SUPABASE_URL: "https://harness.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service_harness",
    };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
    g.fetch = async () => new Response("{}", { status: 200 });
    const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
    db.rpcs.log_webhook_event = (args) => { logged.push(args as Logged); return { data: null, error: null }; };
    g.__fakeSupabase = db;
    handler = await loadEdgeHandler("stripe-webhook", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/stripe@18.5.0":
        "export default class Stripe { constructor() { this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) }; } }",
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase; export class SupabaseClient {}",
      "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } }",
    });
  }, 60_000);

  async function deliver(type: string, object: Record<string, unknown>) {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
      body: JSON.stringify({ id: `evt_${type}_${logged.length}`, type, data: { object } }),
    }));
    while (pending.length) await pending.shift();
    return res;
  }

  it("an expired session minted before the fix is logged without its résumé, everything else intact", async () => {
    const res = await deliver("checkout.session.expired", {
      id: "cs_legacy_expired",
      object: "checkout.session",
      payment_status: "unpaid",
      metadata: { resumeData: JSON.stringify(RESUME).slice(0, 500), originalCurrency: "usd", baseAmountUSD: "5", product_type: "full_analysis" },
    });
    expect(res.status).toBe(200);
    const first = logged.find((a) => "p_payload" in a)!;
    expect(first, "the webhook logged no payload at all").toBeTruthy();
    expect(JSON.stringify(first.p_payload)).not.toContain("Jordan Probe-Candidate");
    expect(first.p_payload?.metadata).toEqual({ originalCurrency: "usd", baseAmountUSD: "5", product_type: "full_analysis" });
    expect(first.p_payload?.id).toBe("cs_legacy_expired");
  });

  it("answers its build on every response", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", { method: "GET" }));
    expect(res.headers.get("x-fn-build")).toBe("stripe-webhook.2026-10-04.no-resume-payload");
  });
});

describe("withoutResumeText", () => {
  it("drops every résumé-bearing key and nothing else", () => {
    const o = { id: "cs_1", metadata: { resumeData: "x", product_type: "full_analysis" }, amount_total: 500 };
    expect(withoutResumeText(o)).toEqual({ id: "cs_1", metadata: { product_type: "full_analysis" }, amount_total: 500 });
    expect(o.metadata.resumeData, "the event the handler reads is not mutated").toBe("x");
  });
  it("returns the object untouched when there is nothing to drop", () => {
    const o = { id: "ch_1", metadata: { charge_id: "ch_1" } };
    expect(withoutResumeText(o)).toBe(o);
    expect(withoutResumeText(null)).toBeNull();
    expect(withoutResumeText({ id: "x" })).toEqual({ id: "x" });
  });
});

// ---------------------------------------------------------------------------
// 3. The migration: one key list, a trigger that proves itself, the clocks.
// ---------------------------------------------------------------------------
describe("migration 20261004150000", () => {
  const sql = MIGRATION ? read(`supabase/migrations/${MIGRATION}`) : "";
  const code = sqlCodeOf(sql);

  it("exists under its assigned stamp", () => {
    expect(MIGRATION, "the migration 20261004150000_* is missing").toBeTruthy();
  });

  it("strips exactly the keys the webhook strips (one list in two runtimes)", () => {
    const m = /v_keys\s+constant\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i.exec(code);
    expect(m, "strip_resume_keys no longer declares its key list where this guard reads it").toBeTruthy();
    const sqlKeys = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(sqlKeys).toEqual([...RESUME_BEARING_METADATA_KEYS].sort());
  });

  it("attaches the strip to webhook_events on insert and on update of payload", () => {
    expect(code).toMatch(/CREATE TRIGGER webhook_events_strip_resume_text\s+BEFORE INSERT OR UPDATE OF payload ON public\.webhook_events\s+FOR EACH ROW EXECUTE FUNCTION public\.webhook_events_strip_resume_text\(\)/i);
  });

  it("scrubs the payloads already stored, keeping the events", () => {
    expect(code).toMatch(/UPDATE public\.webhook_events\s+SET payload = public\.strip_resume_keys\(payload\)/i);
    expect(code).not.toMatch(/DELETE FROM public\.webhook_events\s+WHERE(?![^;]*v_id)/i);
  });

  it("closes the helper to the API roles by name and keeps it callable by service_role", () => {
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.strip_resume_keys\(jsonb\) FROM PUBLIC, anon, authenticated;/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.strip_resume_keys\(jsonb\) TO service_role;/);
  });

  it("schedules a deletion job for every clock the page prints, each at the published length", () => {
    const job = (name: string) => {
      const m = new RegExp(`\\('${name}',\\s*'([^']+)',\\s*\\$c\\$([^$]+)\\$c\\$\\)`).exec(code);
      expect(m, `job ${name} is not scheduled`).toBeTruthy();
      return { schedule: m![1], command: m![2] };
    };
    expect(job("temp-resume-retention").command).toMatch(/DELETE FROM public\.temp_resume_storage WHERE expires_at < now\(\);/);
    expect(job("ai-response-cache-retention").command).toMatch(/DELETE FROM public\.ai_response_cache WHERE expires_at < now\(\);/);
    expect(job("scan-report-cache-retention").command).toContain(`interval '${REPORT_CACHE_DAYS} days'`);
    expect(job("shared-analysis-retention").command).toMatch(/DELETE FROM public\.resume_analyses WHERE expires_at < now\(\);/);
    // "No copy outlives its stated time by more than an hour" -- the page says so.
    expect(job("temp-resume-retention").schedule).toBe("*/15 * * * *");
    for (const n of ["ai-response-cache-retention", "scan-report-cache-retention", "shared-analysis-retention"]) {
      expect(job(n).schedule, n).toMatch(/^\d{1,2} \* \* \* \*$/);
    }
  });

  it("re-states the column defaults the page's numbers depend on", () => {
    expect(code).toContain(`ALTER TABLE public.temp_resume_storage ALTER COLUMN expires_at SET DEFAULT (now() + interval '${TEMP_RESUME_HOURS} hours');`);
    expect(code).toContain(`ALTER TABLE public.resume_analyses ALTER COLUMN expires_at SET DEFAULT (now() + interval '${SHARED_ANALYSIS_DAYS} days');`);
  });

  it("ends in a self-verifying block that proves the trigger on a probe row and refuses the file otherwise", () => {
    const lastDo = code.lastIndexOf("DO $$");
    const tail = code.slice(lastDo);
    expect(lastDo).toBeGreaterThan(0);
    expect(tail.trim().endsWith("END $$;")).toBe(true);
    for (const must of [
      /INSERT INTO public\.webhook_events/,
      /UPDATE public\.webhook_events/,
      /DELETE FROM public\.webhook_events WHERE id = v_id/,
      /has_function_privilege\('anon', 'public\.strip_resume_keys\(jsonb\)'/,
      /FROM cron\.job/,
      /RAISE EXCEPTION 'self-verify: % webhook_events payload\(s\) still carry/,
    ]) {
      expect(tail).toMatch(must);
    }
  });
});

describe("the numbers the page prints are the numbers the code enforces", () => {
  it("the free report cache is read for exactly the days the page states", () => {
    const fks = codeOf(read("supabase/functions/free-keyword-scan/index.ts"));
    const m = /cached\.created_at\)\.getTime\(\) > Date\.now\(\) - (\d+) \* 24 \* 3600 \* 1000/.exec(fks);
    expect(m, "the report-cache read window moved -- point this guard at it").toBeTruthy();
    expect(Number(m![1])).toBe(REPORT_CACHE_DAYS);
  });

  it("no AI cache window outlives the copies the page lists", () => {
    const ttls: Array<[string, number]> = [];
    for (const fn of ["analyze-resume", "generate-summary", "free-keyword-scan-stream"]) {
      const m = /CACHE_TTL_HOURS\s*=\s*(\d+)/.exec(codeOf(read(`supabase/functions/${fn}/index.ts`)));
      expect(m, `${fn}: CACHE_TTL_HOURS not found`).toBeTruthy();
      ttls.push([fn, Number(m![1])]);
    }
    expect(Math.max(...ttls.map(([, h]) => h)), JSON.stringify(ttls)).toBe(AI_CACHE_MAX_HOURS);
    expect(AI_CACHE_MAX_HOURS).toBeLessThanOrEqual(REPORT_CACHE_DAYS * 24);
  });

  it("the erasure address is the one the privacy policy names", () => {
    expect(read("src/pages/Privacy.tsx")).toContain(PRIVACY_EMAIL);
  });

  for (const l of LOCALES) {
    it(`${l}: every short line states the clocks the code enforces`, () => {
      const d = locale(l);
      for (const key of ["hero.benefits.private", "hero.factAutoDelete", "howItWorks.dataNotStored", "scanProgress.securityNote", "trustIndicators.badges.autoDelete.label"]) {
        expect(String(at(d, key)), `${l} ${key}`).toContain(String(REPORT_CACHE_DAYS));
      }
      const faq = String(at(d, "faq.questions.dataStorage.answer"));
      for (const n of [TEMP_RESUME_HOURS, REPORT_CACHE_DAYS, SHARED_ANALYSIS_DAYS]) expect(faq, `${l} FAQ`).toContain(String(n));
      // The trust page interpolates, so no clock is typed into a translation.
      expect(String(at(d, "trustPage.retention.rows.upload.howLong"))).toContain("{{tempHours}}");
      expect(String(at(d, "trustPage.retention.rows.report.howLong"))).toContain("{{reportDays}}");
      expect(String(at(d, "trustPage.retention.rows.paid.howLong"))).toContain("{{analysisDays}}");
      expect(String(at(d, "trustPage.security.freeScan.description"))).toMatch(/\{\{tempHours\}\}[\s\S]*\{\{reportDays\}\}/);
    });
  }

  it("every {{placeholder}} in the trust page's strings is a value the page passes (and the prerender fills)", () => {
    const trust = codeOf(read("src/pages/Trust.tsx"));
    const m = /const clocks = \{([\s\S]*?)\};/.exec(trust);
    expect(m, "Trust.tsx no longer builds `clocks` where this guard reads it").toBeTruthy();
    const passed = new Set([...m![1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]));
    const prerender = codeOf(read("scripts/prerender-seo.mjs"));
    const pm = /const clocks = \{([\s\S]*?)\};/.exec(prerender);
    expect(pm, "prerender-seo.mjs no longer builds `clocks` for /trust").toBeTruthy();
    const filled = new Set([...pm![1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]));
    for (const l of LOCALES) {
      const d = locale(l);
      const text = JSON.stringify([at(d, "trustPage.retention"), at(d, "trustPage.security")]);
      for (const [, name] of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
        expect(passed.has(name), `${l}: {{${name}}} is not passed by Trust.tsx`).toBe(true);
        expect(filled.has(name), `${l}: {{${name}}} is not filled by the /trust prerender`).toBe(true);
      }
    }
  });

  it("every retention row the page renders exists in all nine locales, and every locale row is rendered", () => {
    const trust = codeOf(read("src/pages/Trust.tsx"));
    const m = /const RETENTION_ROWS = \[([\s\S]*?)\] as const;/.exec(trust);
    expect(m, "Trust.tsx no longer lists RETENTION_ROWS where this guard reads it").toBeTruthy();
    const rendered = [...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
    for (const l of LOCALES) {
      const rows = at(locale(l), "trustPage.retention.rows") as Record<string, Record<string, string>>;
      expect(Object.keys(rows).sort(), l).toEqual([...rendered].sort());
      for (const r of rendered) for (const f of ["what", "where", "howLong"]) {
        expect(rows[r]?.[f], `${l} trustPage.retention.rows.${r}.${f}`).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The categorical claim cannot come back while the product stores résumés.
// ---------------------------------------------------------------------------
describe("no served surface says résumés are not stored", () => {
  // The precondition, asserted: the product does keep résumés. If this ever
  // fails because storage was removed, the claim may be true again -- revisit
  // the copy, do not delete the assertion.
  it("the product keeps résumés (so the categorical claim would be false)", () => {
    expect(codeOf(read("src/components/account/ApplyProfilePanel.tsx"))).toMatch(/storage\.from\("resumes"\)\.upload\(/);
    expect(codeOf(read("src/components/SaveResumeVersion.tsx"))).toMatch(/resume_text:\s*resumeText/);
    expect(codeOf(read("src/pages/Index.tsx"))).toMatch(/rpc\('store_temp_resume'/);
  });

  // Every way the claim has been written on this site, in each language it
  // was translated into. Matched against served text only: locale values,
  // llms.txt, and code with its comments removed. The changelog is not
  // scanned -- it records what was said on a date, and rewriting history is
  // its own kind of false.
  const BANNED: RegExp[] = [
    /\b(resumes?|résumés?|cvs?|your data|your document)\b[^.;]{0,40}?\b(is|are)\s+(never|not)\s+(stored|saved|kept|retained)/i,
    /\bnever\s+(stored|store|saved|retained)\b[^.;]{0,30}\b(resumes?|résumés?|cvs?)\b/i,
    /\bnever stored\b/i,
    /\b(and|but) never saved\b/i,
    /\bzero[- ]storage\b/i,
    /\bprocessed (&|and) discarded\b/i,
    /\bverarbeitet (&|und) gelöscht\b/i, /\btraité et supprimé/i, /संसाधित और हटाया/, /\bverwerkt (&|en) verwijderd\b/i, /\bnaproseso at tinanggal\b/i,
    /\bno permanent (resume|résumé|cv) storage\b/i,
    /\b(processed|analy[sz]ed) in memory\b/i,
    /\bimmediately discarded\b/i,
    /\bdo not store (or collect )?your (resume|résumé|cv)/i,
    /\bnothing kept\b/i,
    // de
    /\bnie gespeichert\b/i, /speichern ihre lebenslaufinhalte nicht/i, /\bkeine[ -]speicherung\b/i, /im arbeitsspeicher verarbeitet/i, /keine dauerhafte speicherung/i,
    // es
    /\bnunca (guardamos|se guarda|se almacena|almacenamos|almacenad)/i, /\bno almacenamos\b/i, /\bsin almacenamiento\b/i, /\bse descarta inmediatamente\b/i, /\bcero almacenamiento\b/i, /\b(se procesa|se analiza) en memoria\b/i, /\bprocesado y descartado\b/i,
    // fr
    /\bjamais stock/i, /\bne stockons (pas|jamais)\b/i, /\baucun stockage\b/i, /\bz[ée]ro stockage\b/i, /\btrait[ée] en m[ée]moire\b/i,
    // hi
    /कभी सेव/, /कभी संग्रहीत नहीं/, /स्टोर या एकत्र नहीं/, /ज़ीरो स्टोरेज/, /शून्य भंडारण/, /स्टोर नहीं करते/, /कोई स्थायी रिज़्यूमे स्टोरेज नहीं/,
    // nl
    /\bnooit opgeslagen\b/i, /slaan je cv-inhoud niet op/i, /slaan je cv nooit op/i, /\bgeen[ -]opslag/i, /\bgeen permanente opslag\b/i, /in het geheugen verwerkt/i,
    // pt
    /\bnunca (são )?(guardados|armazenad)/i, /\bnão armazenamos\b/i, /\bsem armazenamento\b/i, /\b(zero armazenamento|armazenamento zero)\b/i, /\bimediatamente descartad/i, /\bprocessado (em memória|e descartado)\b/i,
    // tl
    /hindi namin ini-?store/i, /hindi kailanman iniimbak/i, /hindi naka-store/i, /hindi namin iniimbak/i, /\bwalang storage\b/i, /walang permanenteng storage/i, /hindi namin kailanman itinatabi/i,
  ];

  function strings(o: unknown, path = ""): Array<[string, string]> {
    if (typeof o === "string") return [[path, o]];
    if (Array.isArray(o)) return o.flatMap((v, i) => strings(v, `${path}[${i}]`));
    if (o && typeof o === "object") return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
    return [];
  }

  function walk(dir: string, exts: RegExp): string[] {
    return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
      const rel = `${dir}/${n}`;
      if (statSync(resolve(ROOT, rel)).isDirectory()) return walk(rel, exts);
      return exts.test(n) && !/\.test\.tsx?$/.test(n) ? [rel] : [];
    });
  }

  const offenders = (text: string) => BANNED.filter((re) => re.test(text)).map(String);

  for (const l of LOCALES) {
    it(`${l}.json`, () => {
      const hits = strings(locale(l)).flatMap(([p, v]) => offenders(v).map((re) => `${p}: ${re} in "${v.slice(0, 120)}"`));
      expect(hits).toEqual([]);
    });
  }

  it("public/llms.txt", () => {
    expect(offenders(read("public/llms.txt"))).toEqual([]);
  });

  it("the SPA pages, components and page data, and the prerender script", () => {
    const files = [
      ...walk("src/pages", /\.tsx?$/),
      ...walk("src/components", /\.tsx?$/),
      ...walk("src/data", /\.ts$/),
      "scripts/prerender-seo.mjs",
    ];
    expect(files.length, "the walk found nothing to read").toBeGreaterThan(50);
    const hits = files.flatMap((f) => offenders(codeOf(read(f))).map((re) => `${f}: ${re}`));
    expect(hits).toEqual([]);
  });
});
