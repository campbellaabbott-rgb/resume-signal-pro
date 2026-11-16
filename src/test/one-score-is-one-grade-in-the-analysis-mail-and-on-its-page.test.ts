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
 *
 * AND (bug round 2026-11-12, lane full-analysis):
 * - S14X-209: the level printed the fixed choice ("mid") under a CSS
 *   capitalize; it is now the page's label in the mail's language
 *   ("Mittlere Ebene"), from a table held equal to the locale files.
 * - S14X-219: the job-match block read analysisData.jobMatch, which
 *   analyze-resume never writes, so it never showed; it reads the analysis's
 *   jobDescriptionAlignment.matchScore now.
 * - S14X-041: a section the analysis could not write (the posting comparison,
 *   the LinkedIn review) is named in the mail, not silently left out.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ANALYSIS_MAIL_COPY } from "../../supabase/functions/send-analysis-email/copy";
import { EXPERIENCE_LABELS, INDUSTRY_LABELS, MAIL_GRADE_FLOORS, SECTION_MISSING_LINES, experienceLabel, industryLabel, mailGrade, mailScoreColor } from "../../supabase/functions/send-analysis-email/grade";
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

const LANGUAGES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const locale = (lang: string) => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${lang}.json`), "utf8")) as { analysisResults: { enum: { experienceLevel: Record<string, string> } } };

describe("the level is the page's label, in the mail's language (S14X-209)", () => {
  it("every language's level labels are the locale file's, for every choice", () => {
    for (const lang of LANGUAGES) {
      const file = locale(lang);
      for (const level of ANALYSIS_ENUMS.experienceLevel) {
        expect(experienceLabel(lang, level), `${lang} ${level}`).toBe(file.analysisResults.enum.experienceLevel[level]);
      }
    }
    expect(Object.keys(EXPERIENCE_LABELS.en)).toEqual([...ANALYSIS_ENUMS.experienceLevel]);
  });

  it("a German mail for 'mid' says Mittlere Ebene, never the choice, and no CSS recases it", async () => {
    const de = await mail({ atsScore: { score: 70 }, experienceLevel: "mid" }, "de");
    expect(de.html).toContain(">Mittlere Ebene</strong>");
    expect(de.html).not.toMatch(/>mid<\/strong>/i);
    expect(de.html).not.toContain("text-transform: capitalize");
    const es = await mail({ atsScore: { score: 70 }, experienceLevel: "Executive" }, "es");
    expect(es.html).toContain(">ejecutivo</strong>");
  });

  it("a value that is not a choice reads as the page reads it; none is the mail's default", async () => {
    expect(experienceLabel("en", "very_senior")).toBe("very senior");
    expect(experienceLabel("de", " ")).toBeNull();
    const none = await mail({ atsScore: { score: 70 } }, "nl");
    expect(none.html).toContain(`>${esc(ANALYSIS_MAIL_COPY.nl.levelDefault)}</strong>`);
  });
});

describe("the job match is the analysis's own score (S14X-219)", () => {
  it("an analyze-resume-shaped analysis with a posting shows its match score and the fit line", async () => {
    const m = await mail({ atsScore: { score: 70 }, hasJobDescription: true, jobDescriptionAlignment: { matchScore: 64, extractedKeywords: [], missingKeywords: [] } });
    expect(m.html).toContain(esc(ANALYSIS_MAIL_COPY.en.jobMatch(64)));
    expect(m.html).toContain(esc(ANALYSIS_MAIL_COPY.en.jobFit.weak));
    const good = await mail({ atsScore: { score: 70 }, hasJobDescription: true, jobDescriptionAlignment: { matchScore: 81 } }, "fr");
    expect(good.html).toContain(esc(ANALYSIS_MAIL_COPY.fr.jobMatch(81)));
    expect(good.html).toContain(esc(ANALYSIS_MAIL_COPY.fr.jobFit.good));
  });

  it("the score is a number from 0 to 100, never markup, and no score or no posting shows no block", async () => {
    expect((await mail({ atsScore: { score: 70 }, hasJobDescription: true, jobDescriptionAlignment: { matchScore: 140 } })).html).toContain(esc(ANALYSIS_MAIL_COPY.en.jobMatch(100)));
    for (const data of [
      { hasJobDescription: true, jobDescriptionAlignment: { matchScore: "<a href=x>9</a>" } },
      { hasJobDescription: true, jobDescriptionAlignment: { matchScore: null } },
      { hasJobDescription: false, jobDescriptionAlignment: { matchScore: 64 } },
      { hasJobDescription: true },
    ]) {
      const html = (await mail({ atsScore: { score: 70 }, ...data })).html;
      expect(html, JSON.stringify(data)).not.toContain("Job Match Score");
      expect(html).not.toContain("<a href=x>");
    }
  });

  it("an analysis stored with the old jobMatch shape still shows its score", async () => {
    expect((await mail({ atsScore: { score: 70 }, hasJobDescription: true, jobMatch: { score: 77 } })).html).toContain(esc(ANALYSIS_MAIL_COPY.en.jobMatch(77)));
  });
});

describe("a section the analysis could not write is named in the mail (S14X-041)", () => {
  it("every mail language has both lines, each its own sentence", () => {
    for (const lang of ["en", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const) {
      expect(SECTION_MISSING_LINES[lang].jobDescription.length, lang).toBeGreaterThan(30);
      expect(SECTION_MISSING_LINES[lang].linkedIn.length, lang).toBeGreaterThan(30);
      expect(SECTION_MISSING_LINES[lang].linkedIn).not.toBe(SECTION_MISSING_LINES[lang].jobDescription);
      if (lang !== "en") expect(SECTION_MISSING_LINES[lang].jobDescription).not.toBe(SECTION_MISSING_LINES.en.jobDescription);
    }
  });

  it("missingSections names the posting comparison or the LinkedIn review in the buyer's language", async () => {
    const en = await mail({ atsScore: { score: 70 }, hasJobDescription: false, missingSections: ["jobDescription"] });
    expect(en.html).toContain(esc(SECTION_MISSING_LINES.en.jobDescription));
    expect(en.html).not.toContain(esc(SECTION_MISSING_LINES.en.linkedIn));
    const de = await mail({ atsScore: { score: 70 }, missingSections: ["jobDescription", "linkedIn"] }, "de");
    expect(de.html).toContain(esc(SECTION_MISSING_LINES.de.jobDescription));
    expect(de.html).toContain(esc(SECTION_MISSING_LINES.de.linkedIn));
  });

  it("an analysis from the function before missingSections that says it had a posting but has no comparison is named too", async () => {
    const old = await mail({ atsScore: { score: 70 }, hasJobDescription: true }, "es");
    expect(old.html).toContain(esc(SECTION_MISSING_LINES.es.jobDescription));
  });

  it("a whole analysis names nothing missing", async () => {
    const whole = await mail({ atsScore: { score: 70 }, hasJobDescription: true, jobDescriptionAlignment: { matchScore: 70 }, missingSections: [] });
    expect(whole.html).not.toContain(esc(SECTION_MISSING_LINES.en.jobDescription));
    expect(whole.html).not.toContain(esc(SECTION_MISSING_LINES.en.linkedIn));
    const none = await mail({ atsScore: { score: 70 }, missingSections: ["<b>x</b>", 7] });
    expect(none.html).not.toContain("<b>x</b>");
  });
});
