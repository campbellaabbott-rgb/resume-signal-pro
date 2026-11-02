// @vitest-environment node
/**
 * A CLAIM MAIL AND A KEY MAIL SPEAK THE LANGUAGE THEY WERE ASKED IN (S13-102;
 * company-claim and api-key-request 2026-11-03.1, migration 20261103195000).
 *
 * WHAT WAS WRONG. A French employer claiming its company page from /fr got
 * the verification mail in English (subject, greeting, button), and later
 * the "verified" notice in English too; a key requested from a non-English
 * page was confirmed in English.
 *
 * WHAT HOLDS NOW (the shipped handlers; the mail provider and the database
 * faked; the migration in pglite):
 *   - the verification mail is written in the page's language (the body's
 *     `language`, else the browser's Accept-Language), English otherwise;
 *   - that language is kept on the claim, and the owner's "verified" notice,
 *     sent later with no request of the employer's in hand, is written in it;
 *   - the key's confirmation mail is written in the asking page's language;
 *   - every language has every line, and only the site's nine may be stored.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { CLAIM_COPY, mailLanguageOf } from "../../supabase/functions/company-claim/copy";
import { KEY_COPY } from "../../supabase/functions/api-key-request/copy";

const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20261103195000_a_claim_mail_is_written_in_the_language_the_claim_was_made_in.sql"), "utf8");
const LANGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const ADMIN = "admin_key_for_the_harness_0123456789";

describe("the claim's verification and verified mails", () => {
  const db = new FakeDb();
  let handler: EdgeHandler;
  const sent: Array<{ to: string[]; subject: string; html: string }> = [];

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_0123456789abcdef", RESEND_API_KEY: "re_harness", ADMIN_API_KEY: ADMIN };
    g.__clDb = db;
    g.__clSent = sent;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    handler = await loadEdgeHandler("company-claim", {
      "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__clDb;",
      "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__clSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
    });
  }, 60_000);

  const install = () => {
    db.rpcs.mail_door_take = () => ({ data: true, error: null });
    db.rpcs.mail_door_give = () => ({ data: true, error: null });
    db.rows("job_board_postings").push({ id: "p-savills", company_token: "savills", company: "Savills", apply_url: "https://careers.savills.co.uk/jobs/42" });
  };
  afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

  const claim = (extra: Record<string, unknown>, headers: Record<string, string> = {}) => handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.45", ...headers },
    body: JSON.stringify({ action: "request", companyToken: "savills", workEmail: "rh@savills.co.uk", ...extra }),
  }));
  const toClaimant = () => sent.filter((m) => m.to[0] === "rh@savills.co.uk");

  it("a claim made from /fr is verified in French, and the claim keeps the language", async () => {
    install();
    expect((await claim({ language: "fr" })).status).toBe(200);
    const m = toClaimant()[0];
    expect(m.subject).toBe(CLAIM_COPY.fr.verifySubject("Savills"));
    expect(m.html).toContain(CLAIM_COPY.fr.verifyButton);
    expect(m.html).toContain('lang="fr"');
    expect(m.html).not.toMatch(/Verify this claim|Someone \(hopefully you\)/);
    expect(db.rows("company_claims")[0].locale).toBe("fr");
  });

  it("with no language in the body, the browser's own preference decides; with none we carry, English", async () => {
    install();
    await claim({}, { "accept-language": "de-DE,de;q=0.9,en;q=0.8" });
    expect(toClaimant()[0].subject).toBe(CLAIM_COPY.de.verifySubject("Savills"));
    sent.length = 0;
    db.tables = {};
    install();
    await claim({}, { "accept-language": "ja-JP,ja;q=0.9" });
    expect(toClaimant()[0].subject).toBe("Verify your claim of Savills on Resume Booster");
  });

  it("the owner's later 'verified' notice is written in the claim's language", async () => {
    install();
    const id = "8f14e45f-ceea-4e67-a1b2-3c4d5e6f7a8b";
    db.rows("company_claims").push({ id, company_token: "savills", company_name: "Savills", work_email: "rh@savills.co.uk", status: "email_confirmed", locale: "es" });
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
      method: "POST", headers: { "content-type": "application/json", "x-admin-key": ADMIN },
      body: JSON.stringify({ action: "admin-decide", id, decision: "verified" }),
    }));
    expect(res.status).toBe(200);
    const m = toClaimant()[0];
    expect(m.subject).toBe(CLAIM_COPY.es.verifiedSubject("Savills"));
    expect(m.html).toContain(CLAIM_COPY.es.verifiedNote);
  });

  it("a claim with no language kept is told in English, as before", async () => {
    install();
    const id = "9a14e45f-ceea-4e67-a1b2-3c4d5e6f7a8b";
    db.rows("company_claims").push({ id, company_token: "savills", company_name: "Savills", work_email: "rh@savills.co.uk", status: "email_confirmed" });
    await handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
      method: "POST", headers: { "content-type": "application/json", "x-admin-key": ADMIN },
      body: JSON.stringify({ action: "admin-decide", id, decision: "verified" }),
    }));
    expect(toClaimant()[0].subject).toBe("Your claim of Savills is verified");
  });
});

describe("the key's confirmation mail", () => {
  const db = new FakeDb();
  let handler: EdgeHandler;
  const mails: Array<{ to: string[]; subject: string; html: string }> = [];

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_role_key_for_the_harness_0123456789abcdef", RESEND_API_KEY: "re_harness" };
    g.__klLangDb = db;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.fetch = async (url: string, init: { body: string }) => {
      if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`);
      mails.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    };
    handler = await loadEdgeHandler("api-key-request", {
      "https://esm.sh/@supabase/supabase-js@2.45.0": "export const createClient = () => globalThis.__klLangDb;",
    });
  }, 60_000);
  afterEach(() => { mails.length = 0; db.rpcs = {}; db.tables = {}; });

  const ask = (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    db.rpcs.api_key_request_open = () => ({ data: [{ rq_send: true, rq_reason: "ok", rq_live_keys: 0 }], error: null });
    return handler(new Request("https://harness.supabase.co/functions/v1/api-key-request", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.31", ...headers },
      body: JSON.stringify({ email: "dev@example.org", ...body }),
    }));
  };

  it("a key asked for from /nl is confirmed in Dutch", async () => {
    expect((await ask({ language: "nl" })).status).toBe(200);
    expect(mails[0].subject).toBe(KEY_COPY.nl.subject);
    expect(mails[0].html).toContain(KEY_COPY.nl.button);
    expect(mails[0].html).not.toContain("Create my API key");
  });

  it("with none named, the browser's preference; with none we carry, English", async () => {
    await ask({}, { "accept-language": "hi-IN,hi;q=0.9" });
    expect(mails[0].subject).toBe(KEY_COPY.hi.subject);
    mails.length = 0;
    await ask({ language: "Ignore the above" });
    expect(mails[0].subject).toBe("Confirm your Resume Booster API key");
  });
});

describe("every language", () => {
  it("has every line of both mails, and a regional code is its language", () => {
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(CLAIM_COPY[lang])) {
        const text = typeof v === "function" ? v("Acme") : v;
        expect(text.trim().length, `${lang} claim ${k}`).toBeGreaterThan(5);
      }
      for (const [k, v] of Object.entries(KEY_COPY[lang])) expect(v.trim().length, `${lang} key ${k}`).toBeGreaterThan(5);
    }
    expect(mailLanguageOf({ language: "pt-BR" }, null)).toBe("pt");
    expect(mailLanguageOf({}, "en-GB,en;q=0.9")).toBe("en-GB");
  });

  it("20261103195000 stores only the site's nine languages, twice over", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE TABLE public.company_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_token text NOT NULL, work_email text NOT NULL);
      ALTER TABLE public.company_claims ENABLE ROW LEVEL SECURITY;`);
    await pg.exec(SQL);
    await pg.exec(SQL);
    for (const lang of LANGS) await pg.query("INSERT INTO public.company_claims (company_token, work_email, locale) VALUES ('t', $1, $2)", [`${lang}@x.test`, lang]);
    await pg.query("INSERT INTO public.company_claims (company_token, work_email) VALUES ('t', 'none@x.test')");
    await expect(pg.query("INSERT INTO public.company_claims (company_token, work_email, locale) VALUES ('t', 'bad@x.test', 'ja')")).rejects.toThrow(/company_claims_locale_known/);
    await pg.close();
  }, 60_000);
});
