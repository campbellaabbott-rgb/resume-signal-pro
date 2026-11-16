/**
 * A CLEAN CV IN EACH OF THE NINE LANGUAGES READS AS GOOD (bug audit NB-6).
 *
 * The report is written in nine languages, and the parse check read
 * sections in English only and counted letters as [a-zA-Z]: a clean Spanish,
 * German or Hindi CV was told "no standard resume sections found" (and, in
 * Hindi, "unusually low text-to-symbol ratio", its vowel signs being marks),
 * so the page said extraction had failed and showed every section missing.
 * Now one table of section words (resume-structure.ts SECTION_WORDS, which
 * the rule score reads too) serves the parse check and the structure the
 * model is told, and letters are letters and marks of any script.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeParseQuality, parseResumeStructure, SECTION_WORDS } from "../../supabase/functions/free-keyword-scan/resume-structure";
import { detectResumeLanguage, SUPPORTED_LANGUAGES } from "../../supabase/functions/free-keyword-scan/resume-language";
import { NURSE } from "./fixtures/one-cv-in-several-languages";

const FN = resolve(__dirname, "../../supabase/functions");

/** The nurse's CV in Tagalog, the ninth language (the shared fixture holds the other eight). */
const TL = `Maria Santos
maria.santos@example.com | +63 917 123 4567 | Lungsod Quezon
Buod
Rehistradong nars na may walong taong karanasan sa intensive care at emergency. Mahusay sa pagtatasa ng pasyente, pagpaplano ng pangangalaga at pamumuno ng koponan.
Karanasan sa Trabaho
Charge Nurse, St. Luke's Medical Center, Lungsod Quezon 2019 - kasalukuyan
- Pinamunuan ang koponan ng 14 na nars sa isang ICU na may 32 kama at nabawasan ang mga pagkakamali sa gamot nang 30 porsiyento
- Inugnay ang mga plano ng pangangalaga kasama ang mga doktor, parmasyutiko at pamilya para sa 20 pasyente bawat shift
- Sinanay ang 25 bagong nars sa electronic health records at pagkontrol ng impeksiyon
Staff Nurse, Philippine General Hospital, Maynila 2015 - 2019
- Nagbigay ng kritikal na pangangalaga sa mga pasyenteng katatapos ng operasyon at binantayan ang kanilang vital signs
- Nagbigay ng gamot at IV therapy sa 6 na pasyente bawat shift
- Nabawasan ang pagkahulog ng mga pasyente nang 40 porsiyento sa pamamagitan ng bagong protocol ng oras-oras na pag-ikot
Mga Kasanayan
Pagtatasa ng pasyente, kritikal na pangangalaga, BLS, ACLS, electronic health records, IV therapy, triage, pangangalaga ng sugat, pagkontrol ng impeksiyon
Edukasyon
Bachelor of Science in Nursing, Unibersidad ng Pilipinas Maynila, 2015
`;

const CVS: Record<string, string> = { ...(NURSE.texts as Record<string, string>), tl: TL };

describe("the nine languages the report is written in", () => {
  it("the table holds every supported language but English, and the fixture covers all nine", () => {
    expect(Object.keys(SECTION_WORDS).sort()).toEqual(SUPPORTED_LANGUAGES.filter((l) => l !== "en").sort());
    expect(Object.keys(CVS).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  for (const lang of SUPPORTED_LANGUAGES) {
    it(`a clean ${lang} CV is read as ${lang}, its parse check is good, and its four sections are found`, () => {
      const text = CVS[lang];
      const detected = detectResumeLanguage(text).language;
      expect(detected).toBe(lang);
      const q = computeParseQuality(text, detected);
      expect(q.issues).toEqual([]);
      expect(q.verdict).toBe("good");
      const sections = parseResumeStructure(text, detected).sections;
      for (const s of ["Summary", "Experience", "Education", "Skills"]) expect(sections, `${lang} ${s}`).toContain(s);
    });
  }

  it("the two copies of resume-structure.ts are byte-identical", () => {
    const a = readFileSync(resolve(FN, "free-keyword-scan/resume-structure.ts"), "utf8");
    const b = readFileSync(resolve(FN, "free-keyword-scan-stream/resume-structure.ts"), "utf8");
    expect(a === b).toBe(true);
  });

  it("NB-17: each parse issue carries a stable code, in the same order", () => {
    const q = computeParseQuality("hello world", "en");
    expect(q.issueCodes).toEqual(["few_words", "no_sections"]);
    expect(q.issues).toHaveLength(q.issueCodes.length);
  });
});
