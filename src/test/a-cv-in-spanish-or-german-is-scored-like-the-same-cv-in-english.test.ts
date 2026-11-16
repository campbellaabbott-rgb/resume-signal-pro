/**
 * A CV IN SPANISH OR GERMAN IS SCORED LIKE THE SAME CV IN ENGLISH (register NB-1).
 *
 * WHAT WAS WRONG. The free scan holds the AI's score to within 12 points of a
 * rule-based score, and draws the score band from it too. That rule score read
 * English only: its section words were "experience", "education", "skills"
 * and their English neighbours, its keyword lists are English (with some
 * Spanish), and it measured length in words, which German has fewer of. The
 * bug audit's probe gave the same strong nurse's CV 62 in English, 37 in
 * Spanish and 33 in German, so whatever the AI read, the Spanish headline
 * could not pass 49 and the German 45, about 25 points under the English one,
 * and nothing on the page said why. French, Portuguese, Italian, Dutch and
 * Hindi translations of the same CV scored 31-37.
 *
 * The rule score now lives in free-keyword-scan/rule-score.ts, and this test
 * RUNS it:
 *   - every translation of five CVs of typical strength (a nurse, a software
 *     engineer, an accountant, a salesperson, a teacher) scores within 5
 *     points of its English original in its own field at every seniority;
 *   - in a field with no keyword list ('general') no CV counts keyword
 *     coverage in any language, as in English, so a translation is not
 *     credited what its original is not;
 *   - a thin CV, whose English names none of its field's terms, is credited
 *     an assumed share in translation: pinned at 5-7 points above the English
 *     (it was 14-20 below), not hidden;
 *   - English, and any CV not read in its own language, scores exactly what a
 *     frozen copy of the old function gives. That includes English CVs the
 *     detector names Spanish (US place names: Los Angeles, Ciudad Juárez) and
 *     every English CV read as any supported language: none carries another
 *     language's own section words in two sections, which the reading needs;
 *   - the own-language reading never scores a CV lower than before.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { resumeHasTerm } from "../../supabase/functions/free-keyword-scan/term-presence";
import { detectResumeLanguage, SUPPORTED_LANGUAGES } from "../../supabase/functions/free-keyword-scan/resume-language";
import {
  ALSO_ENGLISH_WORDS,
  calculateRuleBasedAtsScore,
  ownLanguageSections,
  readsInOwnLanguage,
  readsResumeInOwnLanguage,
  ruleBasedAtsParts,
  SECTION_WORDS,
  UNREAD_KEYWORD_CAP,
  UNREAD_KEYWORD_HITS,
  UNREAD_KEYWORD_RATE,
} from "../../supabase/functions/free-keyword-scan/rule-score";
import { CASHIER, CV_SETS, ENGLISH_THAT_READS_AS_ANOTHER_LANGUAGE, NURSE } from "./fixtures/one-cv-in-several-languages";
import { RESUMES } from "./fixtures/cv-matching-corpus";

// ── THE OLD FUNCTION, FROZEN ────────────────────────────────────────────────
// supabase/functions/free-keyword-scan/index.ts on main 83770b84 (the build
// free-keyword-scan answered as 2026-11-09.2), copied byte for byte. Nothing
// here may change: it is what "English scores exactly as today" is measured
// against.
type SeniorityDetection = { level: string };
// FROZEN-BEGIN
function scoreBeforeTheFix(
  resumeText: string,
  industry: string,
  seniority?: SeniorityDetection,
): number {
  const lines = resumeText.split('\n').map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l =>
    l.startsWith('•') || l.startsWith('-') || l.startsWith('*') ||
    /^[•‣◦⁃∙]/.test(l) || (l.length > 30 && l.length < 300)
  );

  const level = seniority?.level ?? 'mid';

  // Quantification: % of bullets containing a number.
  // Executives rely more on narrative scope than bullet metrics — relax the weight.
  const bulletsWithMetrics = bullets.filter(b => /\d/.test(b)).length;
  const rawQuantPct = bullets.length > 0 ? (bulletsWithMetrics / Math.max(bullets.length, 1)) * 100 : 40;
  // Executives with any metrics get a floor boost; entry-level get a floor so sparse resumes aren't crushed.
  const quantScore =
    level === 'executive' ? Math.max(rawQuantPct, 45)
    : level === 'entry' ? Math.max(rawQuantPct, 30)
    : rawQuantPct;

  // Industry keyword coverage
  const kwList = INDUSTRY_KEYWORDS[industry];
  // Whole tokens only (S13-004): "or" is not in "for", "icu" not in "curriculum".
  const primaryHits = kwList ? kwList.primary.filter(kw => resumeHasTerm(resumeText, kw)).length : 0;
  const primaryTotal = kwList ? Math.max(kwList.primary.length, 1) : 1;
  const keywordCoverage = (primaryHits / primaryTotal) * 100;

  // Length: optimal depends on seniority
  const wordCount = resumeText.split(/\s+/).filter(Boolean).length;
  const lengthScore =
    level === 'executive'
      // Executives can have 2-3 page resumes (600-1500 words) — don't penalize
      ? (wordCount < 200 ? 40 : wordCount < 400 ? 65 : wordCount < 1800 ? 85 : 70)
    : level === 'entry'
      // Entry: 1 page ideal (300-500 words)
      ? (wordCount < 100 ? 25 : wordCount < 250 ? 55 : wordCount < 700 ? 85 : 65)
    : (wordCount < 150 ? 30 : wordCount < 300 ? 55 : wordCount < 1100 ? 85 : 65);

  // Section structure
  const hasExperience = /\b(experience|employment|work history|career)\b/i.test(resumeText);
  const hasEducation = /\b(education|degree|university|college|bachelor|master|phd)\b/i.test(resumeText);
  const hasSkills = /\b(skills|technologies|technical|competencies|tools)\b/i.test(resumeText);
  // Executives don't always have a skills section — relax that penalty
  const structureScore = level === 'executive'
    ? (hasExperience ? 55 : 0) + (hasEducation ? 45 : 0)
    : (hasExperience ? 40 : 0) + (hasEducation ? 30 : 0) + (hasSkills ? 30 : 0);

  const raw = quantScore * 0.30 + keywordCoverage * 0.35 + lengthScore * 0.15 + structureScore * 0.20;
  return Math.round(Math.max(20, Math.min(90, raw)));
}
// FROZEN-END

const LEVELS = ["entry", "mid", "senior", "executive"] as const;
const INDUSTRIES = [...Object.keys(INDUSTRY_KEYWORDS), "general"];
const NON_ENGLISH = SUPPORTED_LANGUAGES.filter((l) => l !== "en");
// The shortest list (pharmacy, 17 terms), the longest (finance, 76), the
// fixtures' fields and no list at all: the unread share depends only on length.
const SAMPLE_INDUSTRIES = ["pharmacy", "education", "healthcare", "technology", "finance", "sales", "general"];
// These loops run thousands of scores; under a loaded machine 5 s is not enough.
const LOOP_BUDGET_MS = 60_000;

const MISREAD: Array<[string, string]> = Object.entries(ENGLISH_THAT_READS_AS_ANOTHER_LANGUAGE);
const ENGLISH_TEXTS: Array<[string, string]> = [
  ...Object.entries(CV_SETS).map(([name, set]) => [`${name} (en)`, set.texts.en!] as [string, string]),
  ["cashier (en)", CASHIER.texts.en!],
  ...RESUMES.map((r) => [`cv-matching ${r.id}`, r.text] as [string, string]),
  ["empty", ""],
  ["one line", "Jane Doe, Senior Accountant, 2015-2024, CPA"],
  ["bullets only", "• Managed 12 people\n• Cut costs\n- Drove 30% growth in revenue\n* Led audits"],
  ["long", Array.from({ length: 140 }, (_, i) => `Led project ${i} for patients with SQL and Python, cutting costs by ${i}%.`).join("\n")],
];
const OTHER_TEXTS: Array<[string, string]> = Object.entries({ ...CV_SETS, cashier: CASHIER }).flatMap(([name, set]) =>
  Object.entries(set.texts).filter(([lang]) => lang !== "en").map(([lang, text]) => [`${name} (${lang})`, text!] as [string, string]));

describe("the audit's probe: the same nurse in English, Spanish and German", () => {
  const probe = (["en", "es", "de"] as const).map((lang) => NURSE.texts[lang]!);
  it("scored 62, 37 and 33 before the fix", () => {
    expect(probe.map((t) => scoreBeforeTheFix(t, "healthcare", { level: "mid" }))).toEqual([62, 37, 33]);
  });
  it("now scores 62 in all three: the English CV what it did, the translations what it does", () => {
    expect(probe.map((t) => calculateRuleBasedAtsScore(t, "healthcare", { level: "mid" }))).toEqual([62, 62, 62]);
  });
});

describe("every translation of a CV of typical strength scores within 5 points of its English original, in its own field", () => {
  for (const [name, set] of Object.entries(CV_SETS)) {
    for (const [lang, text] of Object.entries(set.texts)) {
      if (lang === "en") continue;
      it(`${name}: the ${lang} CV is named ${lang}, carries its own section words, is read in ${lang} and finds all three sections`, () => {
        expect(detectResumeLanguage(text!).language).toBe(lang);
        const p = ruleBasedAtsParts(text!, set.industry, { level: "mid" });
        expect(p.ownSections).toBeGreaterThanOrEqual(2);
        expect(p.readIn).toBe("own-language");
        expect([p.hasExperience, p.hasEducation, p.hasSkills]).toEqual([true, true, true]);
      });
      for (const level of LEVELS) {
        it(`${name}: ${lang} at ${level}`, () => {
          const en = calculateRuleBasedAtsScore(set.texts.en!, set.industry, { level });
          const before = scoreBeforeTheFix(text!, set.industry, { level });
          const now = calculateRuleBasedAtsScore(text!, set.industry, { level });
          expect(Math.abs(now - en), `${lang} ${now} (was ${before}) vs en ${en}`).toBeLessThanOrEqual(5);
        });
      }
    }
  }
});

describe("in a field with no keyword list ('general')", () => {
  it("no CV counts keyword coverage, in any language, as in English", () => {
    for (const [label, text] of [...ENGLISH_TEXTS, ...OTHER_TEXTS]) {
      for (const level of LEVELS) expect(ruleBasedAtsParts(text, "general", { level }).keywordCoverage, `${label} / ${level}`).toBe(0);
    }
  });

  it("a translation scores within 5 points of its English original, or 6 where its length crosses a band the English does not", () => {
    // The engineer's Spanish and French run 23-24% more words than the
    // English (299 and 301 against 243), across entry's 250-word and mid's
    // 300-word bands: 4.5 points of length. In its own field the same CVs
    // are within 5 (above), where the English reads more keywords.
    for (const [name, set] of Object.entries(CV_SETS)) {
      for (const [lang, text] of Object.entries(set.texts)) {
        if (lang === "en") continue;
        for (const level of LEVELS) {
          const en = ruleBasedAtsParts(set.texts.en!, "general", { level });
          const tr = ruleBasedAtsParts(text!, "general", { level });
          const gap = Math.abs(tr.score - en.score);
          expect(gap, `${name} ${lang} ${level}: ${tr.score} vs en ${en.score}`).toBeLessThanOrEqual(6);
          if (gap > 5) expect(tr.lengthScore, `${name} ${lang} ${level}: a gap over 5 is a length band`).not.toBe(en.lengthScore);
        }
      }
    }
  });
});

describe("a thin CV: the unread share is an assumption, and this is what it costs", () => {
  // 50 words, no metric, none of retail's 27 primary terms in English. The
  // translation is credited the share an English CV of its length typically
  // names (about 4 of 27 terms), which this English one does not.
  it("each translation scored 14-20 below the English before the fix, and now scores 5-7 above it", () => {
    for (const [lang, text] of Object.entries(CASHIER.texts)) {
      if (lang === "en") continue;
      expect(readsResumeInOwnLanguage(text!, detectResumeLanguage(text!).language), lang).toBe(true);
      for (const level of LEVELS) {
        const en = calculateRuleBasedAtsScore(CASHIER.texts.en!, CASHIER.industry, { level });
        const before = scoreBeforeTheFix(text!, CASHIER.industry, { level });
        const now = calculateRuleBasedAtsScore(text!, CASHIER.industry, { level });
        expect(en - before, `${lang} ${level} before`).toBeGreaterThanOrEqual(14);
        expect(now - en, `${lang} ${level}: ${now} vs en ${en}`).toBeGreaterThanOrEqual(5);
        expect(now - en, `${lang} ${level}: ${now} vs en ${en}`).toBeLessThanOrEqual(7);
      }
    }
  });
  it("at mid: English 35, Spanish 40, German and French 42", () => {
    expect((["en", "es", "de", "fr"] as const).map((l) => calculateRuleBasedAtsScore(CASHIER.texts[l]!, CASHIER.industry, { level: "mid" })))
      .toEqual([35, 40, 42, 42]);
  });
});

describe("English is read exactly as before", () => {
  it("every English CV, in every field, at every seniority, scores what the old function gave", () => {
    let compared = 0;
    for (const [label, text] of ENGLISH_TEXTS) {
      expect(detectResumeLanguage(text).language, label).toBe("en");
      for (const industry of INDUSTRIES) {
        for (const level of [...LEVELS, undefined]) {
          const s = level ? { level } : undefined;
          const before = scoreBeforeTheFix(text, industry, s);
          expect(calculateRuleBasedAtsScore(text, industry, s), `${label} / ${industry} / ${level}`).toBe(before);
          expect(calculateRuleBasedAtsScore(text, industry, s, "en"), `${label} / ${industry} / ${level} / en`).toBe(before);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(5000);
  }, LOOP_BUDGET_MS);

  it("an English CV the detector names Spanish for its place names is read in English and scores what it did", () => {
    // A detector defect of its own (los, las and ciudad before a capitalised
    // word are place names, not Spanish prose); the rule score does not
    // compound it. Before NB-1 the report was already written in Spanish.
    for (const [label, text] of MISREAD.slice(0, 4)) {
      const language = detectResumeLanguage(text).language;
      expect(language, label).toBe("es");
      expect(ownLanguageSections(text, language), label).toBeLessThan(2);
      for (const industry of INDUSTRIES) {
        for (const level of [...LEVELS, undefined]) {
          const s = level ? { level } : undefined;
          const p = ruleBasedAtsParts(text, industry, s);
          expect(p.readIn, label).toBe("english");
          expect(p.score, `${label} / ${industry} / ${level}`).toBe(scoreBeforeTheFix(text, industry, s));
        }
      }
    }
  }, LOOP_BUDGET_MS);

  it("an English CV read as any supported language scores what it did: it carries none of their section words in two sections", () => {
    // Including the care assistant whose only section-like words are
    // "Diploma", "driving licence", "techniques" and "formation": French,
    // Italian and Dutch section words that are English words too, so they
    // are no evidence of the language.
    for (const language of NON_ENGLISH) {
      for (const [label, text] of [...ENGLISH_TEXTS, ...MISREAD]) {
        expect(readsResumeInOwnLanguage(text, language), `${label} as ${language}`).toBe(false);
        for (const industry of SAMPLE_INDUSTRIES) {
          for (const level of LEVELS) {
            expect(calculateRuleBasedAtsScore(text, industry, { level }, language), `${label} as ${language} / ${industry} / ${level}`)
              .toBe(scoreBeforeTheFix(text, industry, { level }));
          }
        }
      }
    }
  }, LOOP_BUDGET_MS);

  it("a CV in any language, read as English, unidentified or a language the report is not built for, scores what it did", () => {
    for (const language of ["en", "unknown", "pl", "ru", "zh", "ja", "sv", "id", "tr"]) {
      expect(readsInOwnLanguage(language), language).toBe(false);
      for (const [label, text] of [...ENGLISH_TEXTS, ...OTHER_TEXTS]) {
        for (const industry of ["healthcare", "technology", "finance", "general"]) {
          for (const level of LEVELS) {
            expect(calculateRuleBasedAtsScore(text, industry, { level }, language), `${label} / ${language} / ${industry} / ${level}`)
              .toBe(scoreBeforeTheFix(text, industry, { level }));
          }
        }
      }
    }
  }, LOOP_BUDGET_MS);

  it("an English 'general' CV still counts no keyword coverage, as before (a separate decision, not this fix's)", () => {
    const p = ruleBasedAtsParts(NURSE.texts.en!, "general", { level: "mid" });
    expect(p.readIn).toBe("english");
    expect(p.keywordCoverage).toBe(0);
  });
});

describe("the own-language reading only adds", () => {
  it("no translation scores lower than it did, in any field, at any seniority", () => {
    for (const [label, text] of OTHER_TEXTS) {
      for (const industry of INDUSTRIES) {
        for (const level of LEVELS) {
          expect(calculateRuleBasedAtsScore(text, industry, { level }), `${label} / ${industry} / ${level}`)
            .toBeGreaterThanOrEqual(scoreBeforeTheFix(text, industry, { level }));
        }
      }
    }
  }, LOOP_BUDGET_MS);

  it("a CV partly in English is read in its language when it carries that language's section words, and in English when it does not", () => {
    const es = NURSE.texts.es!;
    const en = calculateRuleBasedAtsScore(NURSE.texts.en!, "healthcare", { level: "mid" });
    const englishHeadings = es.replace("Resumen profesional", "Summary").replace("Experiencia laboral", "Experience")
      .replace("Habilidades", "Skills").replace("Formación académica", "Education");
    const englishSkills = es.replace(/Habilidades\n.*\n/, "Skills\nPatient assessment, critical care, BLS\n");
    for (const [label, text] of [["English headings over a Spanish body", englishHeadings], ["a Spanish CV with an English skills list", englishSkills]]) {
      const p = ruleBasedAtsParts(text, "healthcare", { level: "mid" });
      expect([p.language, p.readIn], label).toEqual(["es", "own-language"]);
      expect(Math.abs(p.score - en), label).toBeLessThanOrEqual(5);
    }
    // One Spanish sentence over an English CV: one Spanish section word, read in English.
    const summary = "Resumen: enfermera con ocho años de experiencia en cuidados intensivos y urgencias.\n" + NURSE.texts.en!;
    expect(ownLanguageSections(summary, "es")).toBe(1);
    expect(calculateRuleBasedAtsScore(summary, "healthcare", { level: "mid" }, "es")).toBe(scoreBeforeTheFix(summary, "healthcare", { level: "mid" }));
  });

  it("the unread share is what an English CV of the same length typically names, up to 12 terms and a third of the list", () => {
    for (const [label, text] of OTHER_TEXTS) {
      for (const industry of SAMPLE_INDUSTRIES.filter((i) => i !== "general")) {
        const p = ruleBasedAtsParts(text, industry, { level: "mid" });
        const share = Math.min(UNREAD_KEYWORD_CAP, (Math.min(UNREAD_KEYWORD_HITS, p.lengthWords * UNREAD_KEYWORD_RATE) / p.primaryTotal) * 100);
        expect(p.keywordCoverage, `${label} / ${industry}`).toBe(Math.max((p.primaryHits / p.primaryTotal) * 100, share));
      }
    }
    // 160 English-sized words name the full 12; the thin CV's ~50 about 4.
    expect(Math.min(UNREAD_KEYWORD_HITS, 160 * UNREAD_KEYWORD_RATE)).toBeCloseTo(12, 9);
  });

  it("what the lists do read still counts above the unread share", () => {
    // Spanish has its own healthcare terms merged into the list: a CV that
    // names many of them is credited for them, not flattened to the share.
    const rich = "Enfermera. Paciente, pacientes, enfermería, urgencias, quirófano, historia clínica, signos vitales, medicamentos, cuidados intensivos, consulta médica, diagnóstico, tratamiento médico, atención médica, hospitalario. Experiencia laboral 2015 - 2019. Formación: Grado. Habilidades: triaje.";
    const p = ruleBasedAtsParts(rich, "healthcare", { level: "mid" }, "es");
    expect(p.readIn).toBe("own-language");
    expect(p.primaryHits).toBeGreaterThan(13);
    expect(p.keywordCoverage).toBe((p.primaryHits / p.primaryTotal) * 100);
  });

  it("a German CV, with 6-17% fewer words than its English original, is read in English-sized words and keeps its length band", () => {
    for (const [name, set] of Object.entries(CV_SETS)) {
      const de = set.texts.de;
      if (!de) continue;
      const pEn = ruleBasedAtsParts(set.texts.en!, set.industry, { level: "mid" });
      const pDe = ruleBasedAtsParts(de, set.industry, { level: "mid" });
      expect(de.split(/\s+/).filter(Boolean).length, name).toBeLessThan(pEn.lengthWords);
      expect(pDe.lengthScore, `${name}: ${Math.round(pDe.lengthWords)} English-sized words against ${pEn.lengthWords}`).toBe(pEn.lengthScore);
    }
  });

  it("a long CV whose English-sized count passes the top length band keeps the band its words reach", () => {
    // The bands fall again past the top one (1,100 words at mid), so a count
    // that only rose could lower a score: the length reads both counts.
    const line = "Projektleitung Qualitätssicherung Prozessoptimierung Lieferantenmanagement Vertragsverhandlungen Budgetverantwortung Mitarbeiterführung Kundenbetreuung Risikobewertung Dokumentation";
    const de = "Berufserfahrung\nAusbildung\nKenntnisse\n" + Array.from({ length: 105 }, () => line).join("\n");
    for (const level of LEVELS) {
      const p = ruleBasedAtsParts(de, "general", { level }, "de");
      expect(p.readIn).toBe("own-language");
      expect(p.lengthWords).toBeGreaterThan(1800);
      expect(p.score, level).toBeGreaterThanOrEqual(scoreBeforeTheFix(de, "general", { level }));
    }
    expect(ruleBasedAtsParts(de, "general", { level: "mid" }, "de").lengthScore).toBe(85);
  });
});

describe("the section words", () => {
  it("cover exactly the supported languages other than English", () => {
    expect(Object.keys(SECTION_WORDS).sort()).toEqual([...NON_ENGLISH].sort());
  });

  it("count a word of its own, or a German or Dutch compound's last part, and nothing inside another word", () => {
    const sections = (text: string, language: string) => {
      const p = ruleBasedAtsParts(text, "general", { level: "mid" }, language);
      return [p.hasExperience, p.hasEducation, p.hasSkills];
    };
    // "transformación" is not "formación", "Universitätsmedizin" is not a university.
    expect(sections("Lideré la transformación digital del área.", "es")).toEqual([false, false, false]);
    expect(sections("Stationsleitung, Charité Universitätsmedizin", "de")).toEqual([false, false, false]);
    expect(sections("Führungserfahrung. Hochschulstudium. IT-Kenntnisse.", "de")).toEqual([true, true, true]);
    expect(sections("Werkervaring. Beroepsopleiding. Computervaardigheden.", "nl")).toEqual([true, true, true]);
    // A PDF's decomposed accent spells the same word.
    expect(sections("Expérience professionnelle. Éducation. Compétences.".normalize("NFD"), "fr")).toEqual([true, true, true]);
    // A language's words count only for that language.
    expect(sections("Berufserfahrung. Ausbildung. Kenntnisse.", "es")).toEqual([false, false, false]);
  });

  it("that are English words too count for their section once a CV is read in the language, never as evidence of it", () => {
    for (const word of ALSO_ENGLISH_WORDS) {
      expect(Object.values(SECTION_WORDS).some((w) => [...w.experience, ...w.education, ...w.skills].some((x) => x.replace(/^-/, "") === word)), word).toBe(true);
    }
    expect(ownLanguageSections("Formation. Licence. Techniques. Master. Technologies.", "fr")).toBe(0);
    expect(ownLanguageSections("Diploma. Master. Bachelor.", "nl")).toBe(0);
    const french = ruleBasedAtsParts("Expérience professionnelle. Formation. Compétences.", "general", { level: "mid" }, "fr");
    expect(french.ownSections).toBe(2);
    expect([french.readIn, french.hasEducation]).toEqual(["own-language", true]);
  });
});

describe("the scanner reads the module, with the language it detected", () => {
  const SCAN = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8"));
  it("index.ts imports the rule score and keeps no copy of its own", () => {
    expect(SCAN).toMatch(/import \{ calculateRuleBasedAtsScore, readsResumeInOwnLanguage, ruleBasedAtsParts \} from "\.\/rule-score\.ts";/);
    expect(SCAN).not.toMatch(/function calculateRuleBasedAtsScore\(/);
  });
  it("the clamp's score and the fallback report's score both pass the résumé's detected language", () => {
    expect(SCAN).toMatch(/const ruleParts = ruleBasedAtsParts\(resumeText, finalIndustry, seniorityDetection, resumeLanguage\.language\);\s*const ruleBasedAts = ruleParts\.score;/);
    expect(SCAN).toMatch(/calculateRuleBasedAtsScore\(resumeText, fallbackIndustry, seniorityDetection, resumeLanguage\.language\)/);
  });
  it("the clamp is the one /methodology describes, unchanged", () => {
    expect(SCAN).toContain("analysis.atsScoreEstimate = Math.max(ruleBasedAts - 12, Math.min(ruleBasedAts + 12, aiAts));");
  });
  it("the report cache keys a résumé read in its own language apart, and every other résumé as before", () => {
    // A report cached before the fix holds the capped headline; replaying it
    // for 7 days would hide the fix from exactly the résumés it is for.
    expect(SCAN).toMatch(/const ownLanguageKey = readsResumeInOwnLanguage\(resumeText, detectResumeLanguage\(resumeText\)\.language\) \? '\|nb1-own-language' : '';/);
    expect(SCAN).toMatch(/const raw = `\$\{resumeHash\}\|\$\{jdPart\}\|\$\{ctxPart\}\|\$\{keyCountry\}\|\$\{REPORT_ENGINE_VERSION\}\$\{ownLanguageKey\}`;/);
  });
  it("the rule score's log line names the detected language and the reading apart", () => {
    // So an English calibration reads only 'language en' lines: Polish,
    // Chinese and unidentified CVs are read in English but are not English.
    expect(SCAN).toMatch(/Rule score: \$\{ruleBasedAts\} \(language \$\{ruleParts\.language\}, read \$\{ruleParts\.readIn\}/);
  });
  it("the module carries every line of the frozen function the fix did not have to touch", () => {
    // (The frozen copy was diffed against main 83770b84's function when this
    // test was written: identical but for its name.) The coverage line, the
    // word-count line and the three section lines gained an own-language
    // branch, and the length bands became a function of the count so a CV in
    // its own language is read at both counts; nothing else moved.
    const self = readFileSync(__filename, "utf8");
    const frozen = self.slice(self.indexOf("// FROZEN-BEGIN\n") + 16, self.indexOf("// FROZEN-END"));
    const mod = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/rule-score.ts"), "utf8");
    const kept = frozen.split("\n").map((l) => l.trim()).filter((l) => l && !/^(function |resumeText: string,|industry: string,|seniority\?: SeniorityDetection,|\): number \{|\}$|const keywordCoverage = |const wordCount = |const hasExperience = |const hasEducation = |const hasSkills = |return Math\.round)/.test(l));
    for (const line of kept) expect(mod, line).toContain(line);
  });
});
