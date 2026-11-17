/**
 * A POSTING NOT IN ENGLISH IS FLAGGED (MCP upgrade 3, W1 lane L4: U3-08r,
 * critique M10).
 *
 * WHAT WAS WRONG. The excerpt picks lines with English patterns only. A
 * "remote data engineer in Europe" search returns German, Dutch, French and
 * Spanish postings, whose sponsorship or work-permit lines it never picks
 * out, and the answer said nothing about that: an AI reading an empty
 * excerpt reports "doesn't mention sponsorship" for a posting that may well
 * say it, in its own language.
 *
 * WHAT IS NOW TRUE. requirementsExcerptOf adds excerptLanguage, "not English:
 * lines in other languages are not picked out", to a posting with lines in
 * another language, and leaves those lines out of postingExcerpt, so the
 * sentence is literally true. A line is in another language when most of
 * its letters are in another script, or when it holds more function words
 * of another language than of English. A whole text with too few English
 * function words is flagged only beside a sign of another language (its
 * function words, accented letters or script), so English written in
 * fragments is never flagged. It never names a language.
 *
 * Found in review of the first version: it judged the whole text only, so
 * it told the seeker that English postings written as bullet fragments were
 * "not English", said nothing for a bilingual posting whose work-rights or
 * requirement lines were French or German, and picked German lines that sat
 * under an English heading while saying such lines were not picked out.
 *
 * Judged on the 463 real postings of the posting-language corpus (259
 * labelled English, 204 in 20 other languages): every posting in another
 * language is flagged, and the seven English-labelled ones that are flagged
 * each hold paragraphs in another language (named below).
 */
import { describe, expect, it } from "vitest";
import { EXCERPT_NOT_ENGLISH, requirementsExcerptOf } from "../../supabase/functions/agent-mcp/posting-excerpt";
import C14 from "./fixtures/posting-excerpt-c14.json";
import LANG from "./fixtures/posting-language-corpus-2026-11-15.json";

const CASES = (LANG as { cases: Array<{ id: string; truth: string; text: string }> }).cases;
const flagged = (text: string) => requirementsExcerptOf(text).excerptLanguage === EXCERPT_NOT_ENGLISH;

describe("the flag", () => {
  it("says what it means in the spec's words", () => {
    expect(EXCERPT_NOT_ENGLISH).toBe("not English: lines in other languages are not picked out");
  });

  it("is set on every posting of the language corpus written in another language, and on no English-labelled one without paragraphs in another language", () => {
    const english = CASES.filter((c) => c.truth === "en");
    const other = CASES.filter((c) => c.truth !== "en");
    const flaggedEnglish = english.filter((c) => flagged(c.text)).map((c) => c.id);
    const missed = other.filter((c) => !flagged(c.text)).map((c) => `${c.truth} ${c.id}`);
    console.log(`[L4] language corpus: English-labelled flagged ${flaggedEnglish.length}/${english.length}; other languages flagged ${other.length - missed.length}/${other.length}`);
    expect(english.length).toBe(259);
    expect(other.length).toBe(204);
    expect(missed).toEqual([]);
    // The corpus labels these by the language their page was served in. Each
    // holds paragraphs in another language, which are not picked out: GKN's
    // and Marken's bodies are Hungarian after an English title block, ABB's
    // internship alternates Chinese and English lines, and the four Brazilian
    // Bosch postings open with a Portuguese paragraph about Bosch (one also
    // lists its benefits in Portuguese) before English duties.
    const OTHER_PARAGRAPH: Record<string, RegExp> = {
      "site:/jobs/posting/workday/aampower~wd1~AAM-Career-Site/JREQ-226298": /Az alábbi feladatokra lehet számítani a pozícióban/,
      "site:/jobs/posting/workday/abb~wd3~external_career_page/JR00051285": /岗位职责/,
      "site:/jobs/posting/workday/hcmportal~wd5~Search/R26032973-1": /A Marken a UPS 100%-os tulajdonában álló leányvállalata/,
      "smartrecruiters:BoschGroup:br:744000161481004": /Na Bosch, moldamos o futuro/,
      "smartrecruiters:BoschGroup:br:744000161483349": /Na Bosch, moldamos o futuro/,
      "smartrecruiters:BoschGroup:br:744000161510719": /Na Bosch, moldamos o futuro/,
      "smartrecruiters:BoschGroup:br:744000161551460": /Na Bosch, moldamos o futuro/,
    };
    expect(flaggedEnglish.sort()).toEqual(Object.keys(OTHER_PARAGRAPH).sort());
    for (const [id, words] of Object.entries(OTHER_PARAGRAPH)) {
      const text = CASES.find((c) => c.id === id)!.text;
      expect(text, id).toMatch(words);
      const ex = requirementsExcerptOf(text).postingExcerpt;
      expect(ex.join("\n"), id).not.toMatch(words);
    }
  });

  it("is not set on any c14 posting (all English), cut or whole", () => {
    for (const p of (C14 as { postings: Array<{ id: string; cutText: string; wholeText?: string }> }).postings) {
      expect(flagged(p.cutText), p.id).toBe(false);
      if (p.wholeText) expect(flagged(p.wholeText), p.id).toBe(false);
    }
  });

  it("is not set on a terse English list, or on English that names Des Moines, MIT or an au pair", () => {
    expect(flagged("Requirements:\n· SQL\n· Python\n· Airflow\n· dbt\n· 3+ years")).toBe(false);
    expect(flagged("Based in Des Moines. MIT or equivalent degree preferred. Previous au pair or nanny experience welcome. You will report to the director of the school.")).toBe(false);
  });

  it("is not set on an empty description", () => {
    expect("excerptLanguage" in requirementsExcerptOf("")).toBe(false);
  });

  it("is not set on English postings written in fragments, of 25 words or more", () => {
    const tech = "Senior Backend Engineer\nStack: Go, Python, PostgreSQL, Kafka, Kubernetes, Terraform, AWS.\nRequirements:\n- 5+ years backend development\n- Strong Go\n- Distributed systems\n- PostgreSQL performance tuning\n- Kafka, event-driven architecture\n- CI/CD pipelines, GitHub Actions\n- Observability: Prometheus, Grafana, OpenTelemetry\n- Bachelor's degree Computer Science or equivalent\nNice to have:\n- Rust\n- gRPC\n- Terraform modules\nLocation: Berlin, hybrid. Salary: EUR 80-95k. Visa sponsorship available.";
    const retail = "Sales Assistant\nLocation: Manchester\nHours: 20 per week\nPay: £11.44 per hour\nKey responsibilities:\n- Customer service\n- Till operation\n- Stock replenishment\n- Visual merchandising\n- Store opening/closing\n- Cash handling\nSkills:\n- Retail experience preferred\n- Excellent communication\n- Team player\n- Flexible availability including weekends\n- Right to work in the UK required";
    const terse = "Requirements:\n· Python\n· SQL\n· Airflow\n· dbt\n· Snowflake\n· AWS (S3, Lambda, Glue)\n· Kubernetes\n· Terraform\n· CI/CD\n· Git\n· 5+ years data engineering\n· BSc Computer Science\n· Spark\n· Kafka\n· Looker\n· Tableau\n· Excel\nLocation: London, UK\nSalary: £70,000 - £85,000\nHybrid: 2 days office";
    for (const t of [tech, retail, terse]) {
      expect(t.split(/[^\p{L}]+/u).filter(Boolean).length, t.slice(0, 30)).toBeGreaterThanOrEqual(25);
      expect(flagged(t), t.slice(0, 30)).toBe(false);
    }
    expect(requirementsExcerptOf(retail).postingExcerpt).toContain("- Right to work in the UK required");
  });

  it("is set on a bilingual posting whose work-rights line is only in French, and no French line is picked", () => {
    const bi = [
      "Data Analyst - Montreal",
      "We are looking for a data analyst to join our team in Montreal. You will work with the product and finance teams on weekly reporting and forecasting.",
      "Requirements",
      "- 3+ years of experience with SQL and Python",
      "- Degree in statistics, economics or a related field",
      "About us",
      "We are a Montreal software company serving retailers across North America.",
      "Analyste de données - Montréal",
      "Nous recherchons un analyste de données pour rejoindre notre équipe à Montréal. Vous travaillerez avec les équipes produit et finance sur les rapports hebdomadaires.",
      "Vous devez être légalement autorisé à travailler au Canada; nous ne parrainons pas de permis de travail pour ce poste.",
      "Nous sommes une entreprise de logiciels de Montréal au service des détaillants en Amérique du Nord.",
    ].join("\n");
    const ex = requirementsExcerptOf(bi);
    expect(ex.excerptLanguage).toBe(EXCERPT_NOT_ENGLISH);
    expect(ex.postingExcerpt).toEqual(["- 3+ years of experience with SQL and Python", "- Degree in statistics, economics or a related field"]);
  });

  it("is set on German lines under English headings, and then no German line is picked", () => {
    const under = [
      "Über uns",
      "Wir sind ein mittelständisches Unternehmen aus München und entwickeln Software für die Logistik. Unsere Teams arbeiten eng zusammen und wir legen großen Wert auf Qualität und Verlässlichkeit.",
      "Requirements",
      "- Mindestens drei Jahre Berufserfahrung in der Softwareentwicklung mit Java oder Kotlin",
      "- Abgeschlossenes Studium der Informatik oder eine vergleichbare Ausbildung",
      "- Sehr gute Deutschkenntnisse in Wort und Schrift",
    ].join("\n");
    const profil = "About us: We are a fast-growing fintech and we are building the future of payments for the people of Europe. Our team is international and our office language is English.\nDein Profil:\n- Mindestens drei Jahre Erfahrung im Vertrieb\n- Sehr gute Deutschkenntnisse in Wort und Schrift\n- Eine gültige Arbeitserlaubnis für Deutschland ist zwingend erforderlich\n- Führerschein Klasse B\n- Reisebereitschaft innerhalb der DACH-Region";
    for (const t of [under, profil]) {
      const ex = requirementsExcerptOf(t);
      expect(ex.excerptLanguage, t.slice(0, 20)).toBe(EXCERPT_NOT_ENGLISH);
      expect(ex.postingExcerpt.join("\n"), t.slice(0, 20)).not.toMatch(/Mindestens|Deutschkenntnisse|Studium|Arbeitserlaubnis|Führerschein/);
    }
  });

  it("is set on a posting with Chinese lines beside English ones, and on a short text all in another script", () => {
    const mixed = "Data Analyst Intern\n岗位职责：负责数据分析与报表制作，支持业务团队的日常决策。\nResponsibilities: build weekly reports for the business team.\n任职要求：统计学或相关专业，熟练使用SQL。\nRequirements: a degree in statistics and strong SQL skills.";
    const ex = requirementsExcerptOf(mixed);
    expect(ex.excerptLanguage).toBe(EXCERPT_NOT_ENGLISH);
    expect(ex.postingExcerpt.join("\n")).not.toMatch(/[一-鿿]/);
    expect(flagged("営業職を募集しています。日本での就労資格が必要です。")).toBe(true);
  });

  it("rides beside the lines, which are still picked from any English lines", () => {
    const de = CASES.find((c) => c.truth === "de")!.text;
    const ex = requirementsExcerptOf(`${de}\nApplicants must have the right to work in Germany.`);
    expect(ex.excerptLanguage).toBe(EXCERPT_NOT_ENGLISH);
    expect(ex.postingExcerpt).toContain("Applicants must have the right to work in Germany.");
  });
});
