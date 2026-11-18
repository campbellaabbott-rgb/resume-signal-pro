// @vitest-environment node
/**
 * THE FULL ANALYSIS NAMES A RÉSUMÉ'S LANGUAGE AS THE FREE SCAN DOES
 * (RC-S13-024).
 *
 * WHAT WAS WRONG. analyze-resume carried an old copy of the free scanner's
 * résumé-language detector: eight languages, everything else English, every
 * Devanagari CV Hindi. The report language line (report-language.ts) tells
 * every part of the paid analysis which language the text written for the
 * résumé is in (the summary, the rewritten bullets, the keywords, the
 * suggested edits), so a Marathi or Nepali CV got Hindi rewrites and a Polish
 * CV the English or unnamed path, while the free scan that sold it had
 * already named the language.
 *
 * NOW analyze-resume/resume-language.ts is the scanner's file, byte for byte,
 * in all three functions that carry it, and the paid analysis names what the
 * scan names: Marathi, Nepali and Polish by name, and a language neither
 * knows (Czech) as no answer, never a guess.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportLanguage, reportLanguageInstruction, sureLanguageOf } from "../../supabase/functions/analyze-resume/report-language";
import { detectResumeLanguage as scannersDetector } from "../../supabase/functions/free-keyword-scan/resume-language";
import slice from "./fixtures/free-scan-wave/s13-024-resume-language.json";

const FUNCTIONS = resolve(__dirname, "../../supabase/functions");

const MARATHI = "प्रकल्प व्यवस्थापक म्हणून मला ८ वर्षांचा अनुभव आहे. मी संघाचे व्यवस्थापन केले आणि व्यवसाय विकासासाठी काम केले. कौशल्ये: बजेट व्यवस्थापन, डेटा विश्लेषण. शिक्षण: पुणे विद्यापीठातून पदव्युत्तर पदवी.";
const NEPALI = "परियोजना प्रबन्धकको रूपमा मसँग ८ वर्षको अनुभव छ। मैले टोलीको व्यवस्थापन गरें र व्यवसाय विकासमा काम गरेको छु। सीपहरू: बजेट व्यवस्थापन, डाटा विश्लेषण। शिक्षा: त्रिभुवन विश्वविद्यालयबाट स्नातकोत्तर।";
const POLISH = "Kierownik sprzedaży z ponad dziesięcioletnim doświadczeniem w zarządzaniu zespołem. Odpowiedzialny za rozwój firmy i zwiększenie sprzedaży; umiejętności handlowe i znajomość rynku. ".repeat(6);
const CZECH = "Projektový manažer s osmiletou praxí ve vedení týmu a rozvoji obchodu. Zodpovědný za rozpočet a spolupráci se zákazníky ve společnosti. Dovednosti: analýza dat, vyjednávání, řízení rizik. Vzdělání: magisterský titul na Univerzitě Karlově v Praze, obor ekonomie a management podniku, specializace účetnictví a daně.";

describe("the paid analysis names the résumé's language", () => {
  it("a Marathi, a Nepali and a Polish CV are named as themselves, not as Hindi or as nothing", () => {
    expect(reportLanguage("en", MARATHI).resume).toEqual({ code: "mr", name: "Marathi" });
    expect(reportLanguage("en", NEPALI).resume).toEqual({ code: "ne", name: "Nepali" });
    expect(reportLanguage("en", POLISH).resume).toEqual({ code: "pl", name: "Polish" });
  });

  it("with no page language the Polish CV's report is in Polish, and an English page puts a Marathi CV's text for the résumé in Marathi", () => {
    expect(reportLanguage(undefined, POLISH)).toEqual({ code: "pl", name: "Polish", source: "resume", resume: { code: "pl", name: "Polish" } });
    expect(reportLanguageInstruction(reportLanguage("en", MARATHI))).toMatch(/the résumé is written in Marathi, so text written to be pasted into the résumé/);
  });

  it("a language neither detector has a list for is no answer, never a guess", () => {
    expect(reportLanguage("es", CZECH).resume).toBeNull();
    expect(reportLanguageInstruction(reportLanguage("es", CZECH))).toMatch(/is written in the language the résumé itself is written in\b/);
  });

  it("on every text of the scanner's corpus slice, the paid analysis names exactly what the free scan names", () => {
    const cases = (slice as { cases: Array<{ id: string; text: string }> }).cases;
    expect(cases.length).toBeGreaterThanOrEqual(80);
    for (const c of cases) {
      expect(reportLanguage("en", c.text).resume, c.id).toEqual(sureLanguageOf(scannersDetector(c.text)));
    }
  });
});

describe("one detector, three copies", () => {
  it("analyze-resume's resume-language.ts is the free scanner's file, byte for byte, as the scanner's fallback is", () => {
    const scanner = readFileSync(resolve(FUNCTIONS, "free-keyword-scan/resume-language.ts"), "utf8");
    expect(readFileSync(resolve(FUNCTIONS, "free-keyword-scan-stream/resume-language.ts"), "utf8")).toBe(scanner);
    expect(readFileSync(resolve(FUNCTIONS, "analyze-resume/resume-language.ts"), "utf8")).toBe(scanner);
  });
});
