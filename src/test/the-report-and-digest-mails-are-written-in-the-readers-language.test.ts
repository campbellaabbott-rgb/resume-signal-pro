// @vitest-environment node
/**
 * THE REPORT AND DIGEST MAILS ARE WRITTEN IN THE READER'S LANGUAGE (audit
 * 2026-10-31, S13-102).
 *
 * WHAT WAS WRONG. Someone reading the site in French got a French scan page and
 * then an English report mail, four English fix-plan mails and an English
 * saved-search digest: the promise the page made was kept in a language they
 * had not chosen.
 *
 * WHAT HOLDS NOW, by reading the two copy tables and by running the shipped
 * handlers (Resend and the database faked):
 *   - every one of the nine languages has every line, none blank, none a copy of
 *     English except where the word is the same;
 *   - the report mail takes the page's language, else the browser's, and English
 *     only when neither is one we carry; the fix-plan mails take the language of
 *     the request whose button started them;
 *   - the digest takes the language kept on the search; NULL, junk or a database
 *     with no such column yet is English;
 *   - British English says CV and job advert; the retention clock stays the same
 *     two numbers in every language; the sentences the scanner sealed and the
 *     name a person gave a search stay as they were.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";
import { sealScanMail } from "../../supabase/functions/_shared/scan-mail-seal";
import { mailLanguageOf, REPORT_COPY, type ReportCopy } from "../../supabase/functions/send-scan-report/copy";
import { DIGEST_COPY, storedLanguage, type DigestCopy } from "../../supabase/functions/send-search-digest/copy";

const LANGUAGES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;

/** Every line a table renders, with its functions called on stand-in values. */
function renderAll(entry: object): Record<string, string> {
  const link = (text: string) => `<a>${text}</a>`;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "function") {
      const f = value as (...a: unknown[]) => string;
      const args: unknown[] = /Rescan|Builder|Footer|^footer$|^tip$/.test(key) ? [link]
        : key === "day6Intro" ? [64, link]
        : key === "day6Outcome" ? [link, link]
        : key === "preheader" ? [64, 25, true]
        : key === "onetNote" ? ["15-1252", "Software Developers"]
        : key === "day2Intro" ? [64, "A1B2"]
        : key === "day2Heading" ? [true]
        : /^(countLine|lead)$/.test(key) ? ["7", 7, false]
        : key === "subjectPlain" ? ["7", 7, "nurse", "My search"]
        : /^subject(FirstMatch|Strong)$/.test(key) ? ["7", 7, "My search"]
        : /^(verdict|band|stepEffort)$/.test(key) ? [38, 2]
        : [7];
      out[key] = f(...args);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[`${key}.${k}`] = String(v);
    }
  }
  return out;
}

describe("the copy tables", () => {
  const tables: Array<[string, Record<string, object>]> = [["report", REPORT_COPY as Record<string, ReportCopy>], ["digest", DIGEST_COPY as Record<string, DigestCopy>]];
  for (const [name, table] of tables) {
    it(`the ${name} table has every line in all nine languages, none blank`, () => {
      expect(Object.keys(table).sort()).toEqual([...LANGUAGES].sort());
      const en = renderAll(table.en);
      for (const lang of LANGUAGES) {
        const rendered = renderAll(table[lang]);
        expect(Object.keys(rendered).sort(), lang).toEqual(Object.keys(en).sort());
        for (const [key, text] of Object.entries(rendered)) {
          if (key === "percentileMark") continue; // Tagalog writes no mark after a percentile.
          expect(text.trim().length, `${name} ${lang} ${key}`).toBeGreaterThan(0);
        }
      }
    });

    it(`the ${name} table's other languages are not English under another key`, () => {
      const en = renderAll(table.en);
      const keys = Object.keys(en).filter((k) => !/percentileMark|barFormat|barQuantification|fitMatch|stepMinutes|stepOnlyMinutes|stepPoints|stepEffort|^view$|category\./.test(k));
      for (const lang of LANGUAGES.filter((l) => l !== "en" && l !== "en-GB")) {
        const rendered = renderAll(table[lang]);
        const same = keys.filter((k) => rendered[k] === en[k]);
        expect(same, `${name} ${lang} still says these in English`).toEqual([]);
      }
    });
  }

  it("British English says CV and job advert, and Modelling", () => {
    for (const [name, table] of [["report", REPORT_COPY], ["digest", DIGEST_COPY]] as const) {
      for (const [key, text] of Object.entries(renderAll(table["en-GB"]))) {
        const words = text.replace(/resumebooster\.work/gi, "");
        expect(words, `${name} en-GB ${key} says resume`).not.toMatch(/\bresumes?\b/i);
        expect(words, `${name} en-GB ${key} says posting`).not.toMatch(/\bjob posting\b/i);
        expect(words, `${name} en-GB ${key} says Modeling`).not.toMatch(/\bModeling\b/);
      }
    }
  });

  it("the retention clock says the same 24 hours and 7 days in every language", () => {
    for (const lang of LANGUAGES) {
      const line = REPORT_COPY[lang].footerRetention;
      expect(line, lang).toMatch(/24/);
      expect(line, lang).toMatch(/\b7\b/);
      expect(line, lang).toMatch(/resumebooster\.work\/trust/);
    }
  });

  it("Portuguese is Brazilian and names no other AI host than the three", () => {
    const pt = Object.values(renderAll(REPORT_COPY.pt)).join(" ");
    expect(pt).toMatch(/(^|\s)você(\s|$)/);
    expect(pt).not.toMatch(/\bcandidatura enviada\b|\bficheiro\b/);
    for (const lang of LANGUAGES) {
      const all = Object.values(renderAll(REPORT_COPY[lang])).concat(Object.values(renderAll(DIGEST_COPY[lang]))).join(" ");
      expect(all, lang).not.toMatch(/\b(Gemini|Copilot|Cursor|Perplexity|Windsurf)\b/);
    }
  });

  it("the language rule: the page's, else the browser's first we carry, else English", () => {
    expect(mailLanguageOf({ language: "fr" }, "de")).toBe("fr");
    expect(mailLanguageOf({ language: "en-GB" }, "de")).toBe("en-GB");
    expect(mailLanguageOf({ language: "pt-BR" }, null)).toBe("pt");
    expect(mailLanguageOf({ language: "ja" }, "de-DE,de;q=0.9")).toBe("de");
    expect(mailLanguageOf({}, "ja,nl;q=0.5,en;q=0.1")).toBe("nl");
    expect(mailLanguageOf({}, "en-GB,en;q=0.9")).toBe("en-GB");
    expect(mailLanguageOf({}, "ja,ko")).toBe("en");
    expect(mailLanguageOf(null, null)).toBe("en");
    expect(mailLanguageOf({ language: 7 }, "*")).toBe("en");
    expect(storedLanguage("fr")).toBe("fr");
    expect(storedLanguage("en-GB")).toBe("en-GB");
    expect(storedLanguage(null)).toBe("en");
    expect(storedLanguage("xx")).toBe("en");
    expect(storedLanguage(7)).toBe("en");
  });
});

// ── the report and the fix-plan mails, through the handler ──────────────────

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
type ReportSent = { to: string[]; subject: string; html: string };
const reportSent: ReportSent[] = [];
const queued: Array<{ subject: string; html: string }> = [];
const reportDb = new FakeDb();
let report: EdgeHandler;

const UNSEALED = {
  score: 64, projectedScore: 81, scoreBreakdown: { keywords: 55, format: 80, quantification: 60 }, peerPercentile: 42, applicationPassRate: 38,
  findingsSummary: { critical: 2, warnings: 3, passed: 9 }, redFlags: [{ issue: "No metrics in the last two roles" }],
  fixRoadmap: { steps: [{ order: 1, step: "Add numbers to each bullet", minutes: 10, scoreImpact: 6 }], totalMinutes: 25 }, industry: "technology", reportId: "A1B2C3D4E5F6",
};
let REPORT: typeof UNSEALED & { mailSeal: string };

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", SUPABASE_ANON_KEY: "anon" };
  g.__lRepSent = reportSent;
  g.__lRepDb = reportDb;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  report = await loadEdgeHandler("send-scan-report", {
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__lRepDb;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__lRepSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
  REPORT = { ...UNSEALED, mailSeal: await sealScanMail(SERVICE, UNSEALED) };
}, 60_000);

function installReport() {
  reportDb.rpcs.mail_door_take = () => ({ data: true, error: null });
  reportDb.rpcs.save_free_scan_lead = () => ({ data: null, error: null });
  reportDb.rpcs.enqueue_email_delayed = (a) => {
    const p = a.payload as { subject: string; html: string };
    queued.push({ subject: p.subject, html: p.html });
    return { data: 1, error: null };
  };
}
const postReport = (body: unknown, headers: Record<string, string> = {}) =>
  report(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const dripToken = (html: string) => /fix-plan\/confirm#d=([A-Za-z0-9_-]+\.[0-9a-f]{64})"/.exec(html)?.[1] ?? null;

afterEach(() => {
  reportSent.length = 0; queued.length = 0;
  reportDb.tables = {}; reportDb.writes = []; reportDb.rpcs = {}; reportDb.faults = [];
});

describe("the report mail", () => {
  it("is written in the language the page sent, with its date and html lang", async () => {
    installReport();
    expect((await postReport({ email: "jane@example.com", language: "fr", ...REPORT }, { "accept-language": "de" })).status).toBe(200);
    expect(reportSent).toHaveLength(1);
    expect(reportSent[0].subject).toBe("Votre CV a obtenu 64/100 — voici votre plan de corrections");
    const html = reportSent[0].html;
    expect(html).toMatch(/<html lang="fr">/);
    expect(html).toContain("Rapport de diagnostic du CV");
    expect(html).toContain("Ce CV passera environ 38 % des filtres ATS");
    expect(html).toContain("supprimé dans les 24 heures");
    expect(html).not.toMatch(/Your CV|Your resume|Top issues|fix plan/);
    expect(html, "the sentence the scanner sealed changed").toContain("Add numbers to each bullet");
  });

  it("the page's language does not break the scanner's seal", async () => {
    installReport();
    await postReport({ email: "jane@example.com", language: "de", ...REPORT });
    expect(reportSent[0].subject).toBe("Ihr Lebenslauf erreichte 64/100 — hier ist Ihr Verbesserungsplan");
    expect(reportSent[0].html, "the seal failed, so the steps were dropped").toContain("Add numbers to each bullet");
  });

  it("takes the browser's language when the page sent none", async () => {
    installReport();
    await postReport({ email: "jane@example.com", ...REPORT }, { "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" });
    expect(reportSent[0].subject).toBe("Seu currículo marcou 64/100 — aqui está seu plano de correções");
    expect(reportSent[0].html).toMatch(/<html lang="pt">/);
  });

  it("an unsealed request's mail is also in the reader's language", async () => {
    installReport();
    await postReport({ email: "jane@example.com", language: "es", ...UNSEALED, redFlags: [], fixRoadmap: null });
    expect(reportSent[0].subject).toBe("Tu currículum obtuvo 64/100 — el resumen de tu escaneo");
  });

  it("is English only when no language is known", async () => {
    installReport();
    await postReport({ email: "jane@example.com", ...REPORT }, { "accept-language": "ja,ko" });
    expect(reportSent[0].subject).toBe("Your resume scored 64/100 — here's your fix plan");
    expect(reportSent[0].html).toMatch(/<html lang="en">/);
    expect(reportSent[0].html).toContain("Resume Diagnostic Report");
  });

  it("a British reader gets a CV", async () => {
    installReport();
    await postReport({ email: "jane@example.com", language: "en-GB", ...REPORT });
    expect(reportSent[0].subject).toBe("Your CV scored 64/100 — here's your fix plan");
    expect(reportSent[0].html).toContain("CV Diagnostic Report");
  });

  it("the button's page keeps its address in every language, and the outcome links keep theirs", async () => {
    installReport();
    await postReport({ email: "jane@example.com", language: "hi", dripOptIn: true, ...REPORT });
    expect(dripToken(reportSent[0].html)).toBeTruthy();
    expect(reportSent[0].html).toContain("मेरे सुधार योजना ईमेल शुरू करें");
    expect(reportSent[0].html).toMatch(/outcome=interview&rid=A1B2C3D4E5F6/);
  });
});

describe("the four fix-plan mails", () => {
  const pressed = async (language: string | undefined, headers: Record<string, string> = {}) => {
    installReport();
    await postReport({ email: "jane@example.com", dripOptIn: true, ...REPORT });
    const token = dripToken(reportSent[0].html);
    expect(token).toBeTruthy();
    const res = await postReport({ action: "confirm-drip", token, ...(language ? { language } : {}) }, headers);
    expect(await res.json()).toEqual({ success: true, queued: true });
    expect(queued).toHaveLength(4);
  };

  it("are queued in the language of the request whose button started them", async () => {
    await pressed("nl");
    expect(queued.map((q) => q.subject)).toEqual([
      "Dag 2: je drie cv-verbeteringen met de meeste impact",
      "Dag 4: je cv-verbeterplan afmaken",
      "Dag 6: hebben de verbeteringen gewerkt? Controleer het gratis",
      "Eén vraag: heeft het nieuwe cv je gesprekken opgeleverd?",
    ]);
    for (const q of queued) {
      expect(q.html).toMatch(/<html lang="nl">/);
      expect(q.html).toContain("Meld je af");
      expect(q.html).not.toMatch(/Unsubscribe|Rescan|fix plan/);
    }
    expect(queued[0].html, "the sealed step changed").toContain("Add numbers to each bullet");
  });

  it("take the browser's language when the button's page sent none", async () => {
    await pressed(undefined, { "accept-language": "tl" });
    expect(queued[0].subject).toBe("Araw 2: ang tatlong ayos sa resume na may pinakamalaking epekto");
  });

  it("are English when no language is known", async () => {
    await pressed(undefined);
    expect(queued.map((q) => q.subject)).toEqual([
      "Day 2: your three highest-impact resume fixes",
      "Day 4: finishing your resume fix plan",
      "Day 6: did the fixes work? Verify free",
      "One question: did the new resume get interviews?",
    ]);
  });

  it("keep their links in every language", async () => {
    await pressed("es");
    expect(queued[0].html).toMatch(/\/builder\?utm_source=email&(amp;)?utm_medium=drip&(amp;)?utm_campaign=day2/);
    expect(queued[2].html).toMatch(/outcome=interview&rid=A1B2C3D4E5F6/);
    expect(queued[3].html).toMatch(/outcome=rejected&rid=A1B2C3D4E5F6/);
  });
});

// ── the digest, through the handler ─────────────────────────────────────────

const digestSent: Array<{ subject: string; html: string }> = [];
const digestDb = new FakeDb();
let digest: EdgeHandler;
const SID = "5e7a0c1d-1111-4111-8111-111111111111";
let capped = false;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.__lDigSent = digestSent;
  g.__lDigDb = digestDb;
  (digestDb as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => ({ data: { user: { email: "seeker@example.com" } }, error: null }) } };
  digest = await loadEdgeHandler("send-search-digest", {
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__lDigDb;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__lDigSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

async function runDigest(row: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  digestSent.length = 0;
  digestDb.tables = {}; digestDb.rpcs = {};
  const g = globalThis as Record<string, unknown>;
  (g.Deno as { env: { get: (k: string) => string | undefined } }).env.get = (k: string) =>
    ({ SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" } as Record<string, string>)[k];
  g.fetch = async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify(b.countOnly ? { total: 1200, countCapped: capped, newSince: b.newSince } : { jobs: [{ id: "a", company: "Acme", title: "Nurse", location: "Leeds", applyUrl: "https://acme.example/a", postedAt: new Date().toISOString() }], newSince: b.newSince }), { status: 200 });
  };
  let handed = false;
  digestDb.rpcs.search_digest_claim_batch = () => {
    if (handed) return { data: [], error: null };
    handed = true;
    return { data: [{ sd_id: SID, sd_user_id: "abcd-user", sd_name: "Mes <b>alertes</b>", sd_params: { q: "infirmier" }, sd_prev_sent_at: "2026-10-06T14:23:00.000Z", sd_fit_threshold: 0, sd_cadence: "weekly", ...extra }], error: null };
  };
  digestDb.rpcs.search_digest_record_sent = (a) => ({ data: (a.p_posting_ids as string[]).length, error: null });
  digestDb.rows("user_job_searches").push({ id: SID, digest_last_sent_at: "2026-11-03T14:23:00.000Z", digest_opt_in: true, ...row });
  await digest(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
  }));
}

describe("the saved-search digest", () => {
  it("is written in the language kept on the search, with the reader's own words untouched", async () => {
    await runDigest({ locale: "fr" });
    expect(digestSent).toHaveLength(1);
    expect(digestSent[0].subject).toContain("nouvelles correspondances");
    expect(digestSent[0].subject).toContain("Mes <b>alertes</b>");
    expect(digestSent[0].html).toMatch(/<html lang="fr">/);
    expect(digestSent[0].html).toContain("<b>1200</b>");
    expect(digestSent[0].html, "the search's name went into the mail unescaped").toContain("Mes &lt;b&gt;alertes&lt;/b&gt;");
    expect(digestSent[0].html).not.toMatch(/You turned on|See all|since we last checked/);
  });

  it("a count the board capped is written the reader's way", async () => {
    capped = true;
    await runDigest({ locale: "de" });
    expect(digestSent[0].subject).toContain("1.200+");
    await runDigest({ locale: null });
    expect(digestSent[0].subject).toContain("1,200+");
    capped = false;
  });

  it("a search with no language kept is English", async () => {
    await runDigest({ locale: null });
    expect(digestSent[0].html).toMatch(/<html lang="en">/);
    expect(digestSent[0].html).toContain("You turned on the digest");
  });

  it("a value that is not one of the nine is English", async () => {
    await runDigest({ locale: "klingon" });
    expect(digestSent[0].html).toMatch(/<html lang="en">/);
  });

  it("a database with no locale column yet still sends, in English", async () => {
    digestDb.faults.length = 0;
    const realFrom = digestDb.from.bind(digestDb);
    digestDb.from = ((table: string) => {
      const q = realFrom(table);
      if (table !== "user_job_searches") return q;
      const realSelect = q.select.bind(q);
      (q as unknown as { select: (c?: string) => unknown }).select = (c?: string) =>
        c === "locale"
          ? { eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42703", message: "column user_job_searches.locale does not exist" } }) }) }
          : realSelect(c);
      return q;
    }) as typeof digestDb.from;
    try {
      await runDigest({ locale: "de" });
    } finally {
      digestDb.from = realFrom;
    }
    expect(digestSent).toHaveLength(1);
    expect(digestSent[0].html).toMatch(/<html lang="en">/);
  });
});
