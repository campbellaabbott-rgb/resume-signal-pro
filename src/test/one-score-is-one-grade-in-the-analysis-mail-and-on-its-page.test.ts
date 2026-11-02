// @vitest-environment node
/**
 * ONE SCORE IS ONE GRADE IN THE ANALYSIS MAIL AND ON ITS PAGE (S13-101;
 * send-analysis-email 2026-11-03.1).
 *
 * WHAT WAS WRONG. send-analysis-email graded and coloured a score on 80 and
 * 60, while the analysis page its button opens grades on 85, 70 and 50: a
 * buyer who scored 82 read "Excellent!" in green in the inbox and "Good" on
 * the page. And it printed the industry as the analysis's fixed choice, so
 * the mail said "Industry: data_engineering".
 *
 * WHAT HOLDS NOW (the shipped handler, Resend and the database faked): the
 * mail reads the page's thresholds, read here from the page's own source;
 * an 82 gets the mail's "good" line and never its top one; the colours are
 * the page's; and the industry is the label the page shows, in the mail's
 * language, from tables held equal to the locale files.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ANALYSIS_MAIL_COPY } from "../../supabase/functions/send-analysis-email/copy";
import { INDUSTRY_LABELS, MAIL_GRADE_FLOORS, industryLabel, mailGrade, mailScoreColor } from "../../supabase/functions/send-analysis-email/grade";
import { ANALYSIS_ENUMS } from "@/lib/analysis-enums";

const ROOT = resolve(__dirname, "../..");
const page = readFileSync(resolve(ROOT, "src/components/AnalysisResults.tsx"), "utf8");
const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";

/** The page's thresholds, labels and colours, in calculateResumeScore's order. */
const pageBands = (() => {
  const body = page.slice(page.indexOf("function calculateResumeScore"), page.indexOf("return { score, label, color }"));
  return [...body.matchAll(/score >= (\d+)\) \{\s*label = "(\w+)";\s*color = "([\w-]+)"/g)].map((m) => [Number(m[1]), m[2], m[3]] as const);
})();

const sent: Array<{ subject: string; html: string }> = [];
/** A line as the mail prints it (escaped text). */
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const nothing = { select: () => nothing, eq: () => nothing, limit: () => nothing, maybeSingle: async () => ({ data: null, error: null }) };
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__gradeSent = sent;
  g.__gradeDb = { rpc: async () => ({ data: null, error: null }), from: () => nothing };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-analysis-email", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__gradeDb;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__gradeSent.push(m); return { data: { id: 'em_1' }, error: null }; } }; } }",
  });
}, 60_000);

beforeEach(() => { sent.length = 0; });

const mail = async (analysisData: Record<string, unknown>, language = "en") => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/send-analysis-email", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ email: "buyer@example.com", analysisData, language }),
  }));
  expect(res.status).toBe(200);
  return sent[sent.length - 1];
};

describe("the mail grades a score on the page's bands", () => {
  it("reads the page's thresholds (the premise)", () => {
    expect(pageBands).toEqual([[85, "excellent", "text-success"], [70, "good", "text-success"], [50, "needsImprovement", "text-warning"]]);
  });

  it("its top line starts where the page's excellent does, its middle where good does", () => {
    expect(MAIL_GRADE_FLOORS).toEqual([[pageBands[0][0], "high"], [pageBands[1][0], "mid"]]);
    expect([mailGrade(85), mailGrade(84), mailGrade(70), mailGrade(69)]).toEqual(["high", "mid", "mid", "low"]);
  });

  it("an 82 is the mail's good line, never its excellent one, as on the page", async () => {
    const m = await mail({ atsScore: { score: 82 } });
    expect(m.html).toContain(esc(ANALYSIS_MAIL_COPY.en.grade.mid));
    expect(m.html).not.toContain(esc(ANALYSIS_MAIL_COPY.en.grade.high));
    const de = await mail({ atsScore: { score: 82 } }, "de");
    expect(de.html).toContain(esc(ANALYSIS_MAIL_COPY.de.grade.mid));
    expect(de.html).not.toContain(esc(ANALYSIS_MAIL_COPY.de.grade.high));
  });

  it("a 65 is amber, as the page's warning, and a 45 red", async () => {
    expect(mailScoreColor(72)).toBe("#22c55e");
    expect(mailScoreColor(65)).toBe("#eab308");
    expect(mailScoreColor(45)).toBe("#ef4444");
    expect((await mail({ atsScore: { score: 65 } })).html).toContain("border: 8px solid #eab308");
  });
});

describe("the industry is the page's label, in the mail's language", () => {
  it("data_engineering is named, never spelled as the choice", async () => {
    const en = await mail({ atsScore: { score: 70 }, industry: "data_engineering" });
    expect(en.html).toContain(">Data Engineering</strong>");
    expect(en.html).not.toContain("data_engineering");
    const es = await mail({ atsScore: { score: 70 }, industry: "data_engineering" }, "es");
    expect(es.html).toContain(">Ingeniería de datos</strong>");
  });

  it("a value that is not a choice reads as the page reads it; none is the mail's default", async () => {
    expect(industryLabel("en", "aerospace_ops")).toBe("aerospace ops");
    expect(industryLabel("fr", "  ")).toBeNull();
    const none = await mail({ atsScore: { score: 70 } }, "fr");
    expect(none.html).toContain(`>${esc(ANALYSIS_MAIL_COPY.fr.industryDefault)}</strong>`);
  });

  it("every language's labels are the locale file's, for every choice", () => {
    for (const lang of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const file = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${lang}.json`), "utf8")) as { analysisResults: { enum: { industry: Record<string, string> } } };
      for (const choice of ANALYSIS_ENUMS.industry) {
        expect(industryLabel(lang, choice), `${lang} ${choice}`).toBe(file.analysisResults.enum.industry[choice]);
      }
    }
    expect(Object.keys(INDUSTRY_LABELS.en)).toEqual([...ANALYSIS_ENUMS.industry]);
  });
});
