/**
 * A CV IN SPANISH OR GERMAN IS SCORED LIKE THE SAME CV IN ENGLISH (register NB-1).
 *
 * WHAT WAS WRONG. The free scan holds the AI's score to within 12 points of a
 * rule-based score, and draws the score band from it too. That rule score read
 * English only: its section words were "experience", "education", "skills"
 * and their English neighbours, and its keyword lists are English (with some
 * Spanish). The bug audit's probe gave the same strong nurse's CV 62 in
 * English, 37 in Spanish and 33 in German, so whatever the AI read, the
 * Spanish headline could not pass 49 and the German 45, about 25 points under
 * the English one, and nothing on the page said why. French, Portuguese,
 * Italian, Dutch and Hindi translations of the same CV scored 31-37.
 *
 * The rule score now lives in free-keyword-scan/rule-score.ts, and this test
 * RUNS it: every translation of three CVs (a nurse, a software engineer, an
 * accountant) scores within 5 points of its English original at every
 * seniority; English, and any CV the detector does not name as a supported
 * non-English language, scores exactly what a frozen copy of the old function
 * gives; the own-language reading never scores a CV lower than before, and an
 * English CV the detector misread would move by no more than the clamp's width.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { resumeHasTerm } from "../../supabase/functions/free-keyword-scan/term-presence";
import { detectResumeLanguage, SUPPORTED_LANGUAGES } from "../../supabase/functions/free-keyword-scan/resume-language";
import {
  calculateRuleBasedAtsScore,
  readsInOwnLanguage,
  ruleBasedAtsParts,
  SECTION_WORDS,
  UNREAD_KEYWORD_CAP,
} from "../../supabase/functions/free-keyword-scan/rule-score";
import { CV_SETS, NURSE } from "./fixtures/one-cv-in-several-languages";
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
const SAMPLE_INDUSTRIES = ["pharmacy", "education", "healthcare", "technology", "finance", "general"];
// These loops run thousands of scores; under a loaded machine 5 s is not enough.
const LOOP_BUDGET_MS = 60_000;

const ENGLISH_TEXTS: Array<[string, string]> = [
  ...Object.entries(CV_SETS).map(([name, set]) => [`${name} (en)`, set.texts.en!] as [string, string]),
  ...RESUMES.map((r) => [`cv-matching ${r.id}`, r.text] as [string, string]),
  ["empty", ""],
  ["one line", "Jane Doe, Senior Accountant, 2015-2024, CPA"],
  ["bullets only", "• Managed 12 people\n• Cut costs\n- Drove 30% growth in revenue\n* Led audits"],
  ["long", Array.from({ length: 140 }, (_, i) => `Led project ${i} for patients with SQL and Python, cutting costs by ${i}%.`).join("\n")],
];
const OTHER_TEXTS: Array<[string, string]> = Object.entries(CV_SETS).flatMap(([name, set]) =>
  Object.entries(set.texts).filter(([lang]) => lang !== "en").map(([lang, text]) => [`${name} (${lang})`, text!] as [string, string]));

describe("the audit's probe: the same nurse in English, Spanish and German", () => {
  const probe = (["en", "es", "de"] as const).map((lang) => NURSE.texts[lang]!);
  it("scored 62, 37 and 33 before the fix", () => {
    expect(probe.map((t) => scoreBeforeTheFix(t, "healthcare", { level: "mid" }))).toEqual([62, 37, 33]);
  });
  it("now scores 62, 62 and 58: the English CV what it did, the translations within 5 of it", () => {
    expect(probe.map((t) => calculateRuleBasedAtsScore(t, "healthcare", { level: "mid" }))).toEqual([62, 62, 58]);
  });
});

describe("every translation scores within 5 points of its English original", () => {
  for (const [name, set] of Object.entries(CV_SETS)) {
    for (const [lang, text] of Object.entries(set.texts)) {
      if (lang === "en") continue;
      it(`${name}: the ${lang} CV is named ${lang}, read in it, and finds all three sections`, () => {
        expect(detectResumeLanguage(text!).language).toBe(lang);
        const p = ruleBasedAtsParts(text!, set.industry, { level: "mid" });
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

  it("an English CV misread as a supported language gains at most the clamp's 12 points and loses nothing", () => {
    // 0.35 x the one-third cap is 11.7 points of the raw score; rounding can
    // make it 12 on the integer, never more.
    for (const language of NON_ENGLISH) {
      for (const [label, text] of ENGLISH_TEXTS) {
        for (const industry of SAMPLE_INDUSTRIES) {
          for (const level of LEVELS) {
            const before = scoreBeforeTheFix(text, industry, { level });
            const misread = calculateRuleBasedAtsScore(text, industry, { level }, language);
            expect(misread - before, `${label} as ${language} / ${industry} / ${level}`).toBeGreaterThanOrEqual(0);
            expect(misread - before, `${label} as ${language} / ${industry} / ${level}`).toBeLessThanOrEqual(12);
          }
        }
      }
    }
  }, LOOP_BUDGET_MS);

  it("a CV in its own language with no field list ('general') gets the unread share, not zero", () => {
    for (const [label, text] of OTHER_TEXTS) {
      const p = ruleBasedAtsParts(text, "general", { level: "mid" });
      expect(p.readIn, label).toBe("own-language");
      expect(p.keywordCoverage, label).toBe(UNREAD_KEYWORD_CAP);
    }
  });

  it("what the lists do read still counts above the unread share", () => {
    // Spanish has its own healthcare terms merged into the list: a CV that
    // names many of them is credited for them, not flattened to the share.
    const rich = "Enfermera. Paciente, pacientes, enfermería, urgencias, quirófano, historia clínica, signos vitales, medicamentos, cuidados intensivos, consulta médica, diagnóstico, tratamiento médico, atención médica, hospitalario. Experiencia laboral 2015 - 2019. Formación: Grado. Habilidades: triaje.";
    const p = ruleBasedAtsParts(rich, "healthcare", { level: "mid" }, "es");
    expect(p.primaryHits).toBeGreaterThan(13);
    expect(p.keywordCoverage).toBe((p.primaryHits / p.primaryTotal) * 100);
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
});

describe("the scanner reads the module, with the language it detected", () => {
  const SCAN = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8"));
  it("index.ts imports the rule score and keeps no copy of its own", () => {
    expect(SCAN).toMatch(/import \{ calculateRuleBasedAtsScore, ruleBasedAtsParts \} from "\.\/rule-score\.ts";/);
    expect(SCAN).not.toMatch(/function calculateRuleBasedAtsScore\(/);
  });
  it("the clamp's score and the fallback report's score both pass the résumé's detected language", () => {
    expect(SCAN).toMatch(/const ruleParts = ruleBasedAtsParts\(resumeText, finalIndustry, seniorityDetection, resumeLanguage\.language\);\s*const ruleBasedAts = ruleParts\.score;/);
    expect(SCAN).toMatch(/calculateRuleBasedAtsScore\(resumeText, fallbackIndustry, seniorityDetection, resumeLanguage\.language\)/);
  });
  it("the clamp is the one /methodology describes, unchanged", () => {
    expect(SCAN).toContain("analysis.atsScoreEstimate = Math.max(ruleBasedAts - 12, Math.min(ruleBasedAts + 12, aiAts));");
  });
  it("the module carries every line of the frozen function the fix did not have to touch", () => {
    // (The frozen copy was diffed against main 83770b84's function when this
    // test was written: identical but for its name.) The coverage line and the
    // three section lines gained an own-language branch; nothing else moved.
    const self = readFileSync(__filename, "utf8");
    const frozen = self.slice(self.indexOf("// FROZEN-BEGIN\n") + 16, self.indexOf("// FROZEN-END"));
    const mod = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/rule-score.ts"), "utf8");
    const kept = frozen.split("\n").map((l) => l.trim()).filter((l) => l && !/^(function |resumeText: string,|industry: string,|seniority\?: SeniorityDetection,|\): number \{|\}$|const keywordCoverage = |const hasExperience = |const hasEducation = |const hasSkills = |return Math\.round)/.test(l));
    for (const line of kept) expect(mod, line).toContain(line);
  });
});
