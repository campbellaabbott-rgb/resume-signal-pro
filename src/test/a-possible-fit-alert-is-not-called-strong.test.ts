// @vitest-environment node
/**
 * A POSSIBLE-FIT ALERT IS NOT CALLED STRONG (S14X-171).
 *
 * WHAT WAS WRONG. The account's saved-search card offers three fit bars: any
 * new posting, "Possible fit+" (10) and "Strong fit only" (20). The digest
 * treated every bar above zero as the strong one, so an alert set to possible
 * fits was mailed as "1 new strong match for you".
 *
 * WHAT HOLDS NOW: the subject says "strong" only for a bar of 20 or more; a
 * lower bar gets a possible-match subject, written in all nine languages, none
 * of which carries its language's word for strong.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { DIGEST_COPY, type MailLanguage } from "../../supabase/functions/send-search-digest/copy.ts";

const LANGS: MailLanguage[] = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
/** Each language's word for "strong", as its subjectStrong writes it. */
const STRONG: Record<MailLanguage, RegExp> = {
  en: /strong/i, "en-GB": /strong/i, de: /stark/i, es: /fuerte/i, fr: /forte/i, hi: /मज़बूत/, nl: /sterk/i, pt: /forte/i, tl: /malakas/i,
};

describe("the copy", () => {
  it("has a possible-match subject in every language, with the count, the name and no word for strong", () => {
    for (const lang of LANGS) {
      const c = DIGEST_COPY[lang] as unknown as { subjectPossible?: (c: string, n: number, name: string) => string; subjectStrong: (c: string, n: number, name: string) => string };
      expect(typeof c.subjectPossible, `${lang}.subjectPossible`).toBe("function");
      for (const n of [1, 3]) {
        const s = c.subjectPossible!(String(n), n, "Nurse jobs");
        expect(s, lang).toContain(String(n));
        expect(s, lang).toContain("Nurse jobs");
        expect(s, `${lang}: ${s}`).not.toMatch(STRONG[lang]);
        expect(c.subjectStrong(String(n), n, "Nurse jobs"), `${lang} strong`).toMatch(STRONG[lang]);
      }
    }
    for (const lang of ["de", "es", "fr", "hi", "nl", "pt", "tl"] as const) {
      expect((DIGEST_COPY[lang] as unknown as { subjectPossible: (c: string, n: number, name: string) => string }).subjectPossible("2", 2, "X"), lang)
        .not.toBe((DIGEST_COPY.en as unknown as { subjectPossible: (c: string, n: number, name: string) => string }).subjectPossible("2", 2, "X"));
    }
  });
});

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ subject: string }> = [];
const db = new FakeDb();
let search: EdgeHandler;
const SID = "5e7a0c1d-3333-4333-8333-333333333333";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__s171Sent = sent;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => ({ data: { user: { email: "seeker@example.com" } }, error: null }) } };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      const jobs = [{ id: "j1", company: "Acme", title: "Ward nurse", location: "Leeds", applyUrl: "https://acme.example/1", postedAt: null }];
      return new Response(JSON.stringify(b.countOnly ? { total: 1, newSince: b.newSince } : { jobs, newSince: b.newSince }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  search = await loadEdgeHandler("send-search-digest", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__s171Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);
afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

async function runWithBar(threshold: number) {
  let fresh = false;
  db.rpcs.search_digest_claim_batch = () => ({
    data: (fresh = !fresh) ? [{ sd_id: SID, sd_user_id: "u-1", sd_name: "Nurse jobs", sd_params: { q: "nurse" }, sd_prev_sent_at: "2026-11-01T14:23:00.000Z", sd_fit_threshold: threshold, sd_cadence: "weekly" }] : [],
    error: null,
  });
  db.rpcs.search_digest_record_sent = () => ({ data: 1, error: null });
  db.rows("user_job_searches").push({ id: SID, digest_last_sent_at: "2026-11-08T14:23:00.000Z", digest_opt_in: true });
  db.rows("user_profiles").push({ user_id: "u-1", matching_resume_text: "registered nurse acute ward ".repeat(10), matching_scan_id: null });
  db.rows("job_board_postings").push({ id: "j1", description: "registered nurse acute ward ".repeat(20) });
  await search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
  }));
}

describe("the mail", () => {
  it("an alert set to possible fits is not mailed as a strong match", async () => {
    await runWithBar(10);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).not.toMatch(/strong/i);
    expect(sent[0].subject).toMatch(/^1 new possible match for you — Nurse jobs$/);
  });

  it("an alert set to strong fits keeps the strong subject", async () => {
    await runWithBar(20);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/^1 new strong match for you — Nurse jobs$/);
  });
});
