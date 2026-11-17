// @vitest-environment node
/**
 * THE SCAN-REPORT MAILS PROMISE NO PUBLIC FIGURE FROM AN OUTCOME ANSWER
 * (S14X-170).
 *
 * WHAT WAS WRONG. The report mail and the fix-plan sequence ask the reader to
 * say how an application went (got interviews, no response, rejected). The
 * answer is written to scan_outcomes, and nothing reads that table: no
 * function, no page, no public figure. The site already says so once the
 * answer is recorded ("no public figure is built from them yet"), but the
 * mails in all nine languages still said the answer "sharpens the public
 * benchmarks" (day 14), that it is "how we measure what actually works"
 * (day 6), and that one click "helps us measure which scores actually land
 * interviews" (every report mail). The score preview also read "Projected ~81"
 * where the site's own report calls the same number a rough guide.
 *
 * WHAT HOLDS NOW, by reading the copy table and by running the shipped
 * handler (Resend and the database faked):
 *   - in every language the three outcome lines say the answers help us study
 *     which scores lead to interviews, and the report ask and the day-14 line
 *     say no public figure is built from them yet;
 *   - none of the three is any language's old line, and English names no
 *     benchmark and no measuring of what works;
 *   - the score preview carries the same rough-guide words as the site's own
 *     report in that language;
 *   - the report mail and the day-6 and day-14 mails print those lines.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";
import { sealScanMail } from "../../supabase/functions/_shared/scan-mail-seal";
import { REPORT_COPY } from "../../supabase/functions/send-scan-report/copy";

const ROOT = resolve(__dirname, "../..");
const LANGUAGES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Lang = typeof LANGUAGES[number];
const link = (text: string) => `<a>${text}</a>`;
const lines = (l: Lang) => ({
  outcomeAsk: REPORT_COPY[l].outcomeAsk,
  day6Outcome: REPORT_COPY[l].day6Outcome(link, link),
  day14Why: REPORT_COPY[l].day14Why,
});

/** What each language says the answers are for: the site's own meaning (scanOutcome.recorded). */
const STUDY: Record<Lang, RegExp> = {
  en: /helps? us study which scores lead to interviews/i,
  "en-GB": /helps? us study which scores lead to interviews/i,
  de: /hilft uns zu untersuchen, welche Scores zu Vorstellungsgesprächen führen/,
  es: /nos ayuda a estudiar qué puntuaciones llevan a entrevistas/,
  fr: /nous aide à étudier quels scores mènent à des entretiens/,
  hi: /समझने में मदद करता है कि कौन-से स्कोर इंटरव्यू तक ले जाते हैं/,
  nl: /helpt (die )?ons te onderzoeken welke scores tot gesprekken leiden/,
  pt: /nos ajuda a estudar quais pontuações levam a entrevistas/,
  tl: /pag-aralan kung aling mga score ang humahantong sa interview/,
};
/** And that nothing public is built from them yet. */
const NO_FIGURE: Record<Lang, RegExp> = {
  en: /no public figure is built from the answers yet/i,
  "en-GB": /no public figure is built from the answers yet/i,
  de: /eine öffentliche Zahl entsteht aus den Antworten noch nicht/i,
  es: /todavía no publicamos ninguna cifra basada en las respuestas/i,
  fr: /aucun chiffre public n'est encore tiré des réponses/i,
  hi: /जवाबों से अभी कोई सार्वजनिक आँकड़ा नहीं बनाया गया है/,
  nl: /er wordt nog geen openbaar cijfer van de antwoorden gemaakt/i,
  pt: /ainda não publicamos nenhum número com base nas respostas/i,
  tl: /wala pa kaming inilalabas na pampublikong numero mula sa mga sagot/i,
};

/** Every language's lines as they stood before S14X-170: none may come back. */
const OLD_ASK = [
  "Applied with this resume? One click helps us measure which scores actually land interviews (anonymous):",
  "Applied with this CV? One click helps us measure which scores actually land interviews (anonymous):",
  "Haben Sie sich mit diesem Lebenslauf beworben? Ein Klick hilft uns zu messen, welche Scores tatsächlich zu Vorstellungsgesprächen führen (anonym):",
  "¿Postulaste con este currículum? Un clic nos ayuda a medir qué puntuaciones consiguen entrevistas de verdad (anónimo):",
  "Vous avez postulé avec ce CV ? Un clic nous aide à mesurer quels scores décrochent vraiment des entretiens (anonyme) :",
  "इस रिज़्यूमे से आवेदन किया? एक क्लिक से हमें पता चलता है कि कौन-से स्कोर सच में इंटरव्यू दिलाते हैं (गुमनाम):",
  "Gesolliciteerd met dit cv? Eén klik helpt ons meten welke scores echt tot gesprekken leiden (anoniem):",
  "Você se candidatou com este currículo? Um clique nos ajuda a medir quais pontuações realmente conseguem entrevistas (anônimo):",
  "Nag-apply ka gamit ang resume na ito? Nakakatulong ang isang click para masukat namin kung aling mga score ang talagang nakakakuha ng interview (anonymous):",
];
const OLD_DAY14 = [
  "Every answer sharpens the public benchmarks — measuring what actually works is the whole product.",
  "Jede Antwort schärft die öffentlichen Vergleichswerte — zu messen, was wirklich funktioniert, ist das ganze Produkt.",
  "Cada respuesta afina los datos de referencia públicos: medir lo que funciona de verdad es todo el producto.",
  "Chaque réponse affine les repères publics : mesurer ce qui marche vraiment, c'est tout le produit.",
  "हर जवाब सार्वजनिक मानकों को बेहतर बनाता है — जो सच में काम करता है उसे मापना ही पूरा उत्पाद है।",
  "Elk antwoord maakt de openbare maatstaven scherper; meten wat echt werkt is het hele product.",
  "Cada resposta aprimora os parâmetros públicos: medir o que realmente funciona é o produto inteiro.",
  "Pinapatalas ng bawat sagot ang mga pampublikong benchmark — ang pagsukat sa talagang gumagana ang buong produkto.",
];
/** The day-6 line's old claim, one phrase per language. */
const OLD_DAY6 = [
  "that's how we measure what actually works", "so messen wir, was wirklich funktioniert", "así medimos lo que funciona de verdad",
  "c'est ainsi que nous mesurons ce qui marche vraiment", "इसी से हम मापते हैं कि असल में क्या काम करता है", "zo meten we wat echt werkt",
  "é assim que medimos o que realmente funciona", "ganyan namin sinusukat kung ano ang talagang gumagana",
];

describe("the outcome lines in the copy table", () => {
  it("in every language say the answers help us study which scores lead to interviews", () => {
    for (const l of LANGUAGES) {
      for (const [key, text] of Object.entries(lines(l))) expect(text, `${l} ${key}`).toMatch(STUDY[l]);
    }
  });

  it("in every language the report ask and the day-14 line say no public figure is built from the answers yet", () => {
    for (const l of LANGUAGES) {
      expect(REPORT_COPY[l].outcomeAsk, `${l} outcomeAsk`).toMatch(NO_FIGURE[l]);
      expect(REPORT_COPY[l].day14Why, `${l} day14Why`).toMatch(NO_FIGURE[l]);
    }
  });

  it("no language says any of the old lines again", () => {
    for (const l of LANGUAGES) {
      const { outcomeAsk, day6Outcome, day14Why } = lines(l);
      expect(OLD_ASK, `${l} outcomeAsk is an old line`).not.toContain(outcomeAsk);
      expect(OLD_DAY14, `${l} day14Why is an old line`).not.toContain(day14Why);
      for (const old of OLD_DAY6) expect(day6Outcome, `${l} day6Outcome`).not.toContain(old);
    }
  });

  it("English names no benchmark and no measuring of what works", () => {
    for (const l of ["en", "en-GB"] as const) {
      for (const [key, text] of Object.entries(lines(l))) {
        expect(text, `${l} ${key}`).not.toMatch(/benchmark|how we measure|helps us measure|measuring what actually works/i);
      }
    }
  });

  it("the score preview carries the site report's rough-guide words in every language", () => {
    for (const l of LANGUAGES) {
      const shard = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/free-scan-page/${l}.json`), "utf8")) as { freeScanPage: { pdf: { projected: string } } };
      const words = /\(([^)]+)\)\s*$/.exec(shard.freeScanPage.pdf.projected)?.[1];
      expect(words, `${l}: the site's report no longer ends its projection with a bracketed caveat`).toBeTruthy();
      const line = REPORT_COPY[l].projected(81);
      expect(line, l).toContain("81");
      expect(line, l).toContain(`(${words})`);
      expect(line, l).not.toMatch(/Projected|Voraussichtlich|Proyección|Projection|Projeção|Inaasahang|Verwacht|अनुमानित ~/);
    }
  });
});

// ── through the handler ─────────────────────────────────────────────────────

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ subject: string; html: string }> = [];
const queued: Array<{ subject: string; html: string }> = [];
const db = new FakeDb();
let handler: EdgeHandler;

const UNSEALED = {
  score: 64, projectedScore: 81, scoreBreakdown: { keywords: 55, format: 80, quantification: 60 }, peerPercentile: 42, applicationPassRate: 38,
  findingsSummary: { critical: 2, warnings: 3, passed: 9 }, redFlags: [{ issue: "No metrics in the last two roles" }],
  fixRoadmap: { steps: [{ order: 1, step: "Add numbers to each bullet", minutes: 10, scoreImpact: 6 }], totalMinutes: 25 }, industry: "technology", reportId: "A1B2C3D4E5F6",
};
let REPORT: typeof UNSEALED & { mailSeal: string };

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", SUPABASE_ANON_KEY: "anon" };
  g.__s170Sent = sent;
  g.__s170Db = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-scan-report", {
    // The sequence is withdrawn as shipped (S14X-012, option B); its own code is run switched on here.
    "./sequence-offered.ts": "export const FIX_PLAN_SEQUENCE_OFFERED = true;",
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__s170Db;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__s170Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
  REPORT = { ...UNSEALED, mailSeal: await sealScanMail(SERVICE, UNSEALED) };
}, 60_000);

afterEach(() => {
  sent.length = 0; queued.length = 0;
  db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = [];
});

function install() {
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
  db.rpcs.save_free_scan_lead = () => ({ data: null, error: null });
  db.rpcs.enqueue_email_delayed = (a) => {
    const p = a.payload as { subject: string; html: string };
    queued.push({ subject: p.subject, html: p.html });
    return { data: 1, error: null };
  };
}
const post = (body: unknown) =>
  handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));

describe("the mails", () => {
  for (const l of ["en", "fr", "tl"] as const) {
    it(`the ${l} report mail asks for the outcome without promising a public figure, and calls the projection a rough guide`, async () => {
      install();
      expect((await post({ email: "jane@example.com", language: l, ...REPORT })).status).toBe(200);
      expect(sent).toHaveLength(1);
      const html = sent[0].html;
      expect(html).toContain(REPORT_COPY[l].outcomeAsk);
      expect(html).toMatch(NO_FIGURE[l]);
      expect(html).toContain(REPORT_COPY[l].projected(81));
      for (const old of OLD_ASK) expect(html).not.toContain(old);
    });
  }

  it("the day-6 and day-14 mails say the same, once the sequence's button is pressed", async () => {
    install();
    await post({ email: "jane@example.com", language: "de", dripOptIn: true, ...REPORT });
    const token = /fix-plan\/confirm#d=([A-Za-z0-9_-]+\.[0-9a-f]{64})"/.exec(sent[0].html)?.[1];
    expect(token).toBeTruthy();
    expect(await (await post({ action: "confirm-drip", token, language: "de" })).json()).toEqual({ success: true, queued: true });
    expect(queued).toHaveLength(4);
    expect(queued[2].html).toMatch(STUDY.de);
    expect(queued[3].html).toMatch(NO_FIGURE.de);
    for (const q of queued) {
      for (const old of OLD_DAY14) expect(q.html).not.toContain(old);
      for (const old of OLD_DAY6) expect(q.html).not.toContain(old);
    }
  });
});
