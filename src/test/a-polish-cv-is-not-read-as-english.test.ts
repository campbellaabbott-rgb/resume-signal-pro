/**
 * A POLISH CV IS NOT READ AS ENGLISH (register S13-024).
 *
 * The résumé-language detector knew eight languages and called everything
 * else English, and called every Devanagari CV Hindi. A Polish, Russian,
 * Turkish, Swedish or Indonesian CV got an English report with English keyword
 * gaps; a Marathi or Nepali CV got a Hindi one. Now a script one language owns
 * names it, a shared script names a language only on that language's own
 * words, Polish, Turkish, Swedish, Indonesian and Malay have word lists, a
 * Latin-script text that is neither English nor listed is 'unknown', and when
 * the report is not built for the language the response carries a
 * languageNotice saying so and the prompt warns the model.
 *
 * Measured (corpus in ~/.config/resumebooster/free-scan-wave-corpora/S13-024):
 * 2,603 real texts (macOS localized strings in 38 locales, the repo's locale
 * files, the 2,067 real postings) and 48 labelled synthetic CVs. Main right on
 * 2,145, the branch on 2,487; no English text called unknown. Held out (228
 * blocks from other system apps): main right on 19, the branch on 174, worse
 * on none.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectResumeLanguage, formatLanguageForPrompt, languageNoticeOf } from "../../supabase/functions/free-keyword-scan/resume-language";
import slice from "./fixtures/free-scan-wave/s13-024-resume-language.json";

const CV: Record<string, string> = {
  pl: "Kierownik projektu z 8-letnim doświadczeniem w zarządzaniu zespołem. Odpowiedzialny za współpracę z klientami oraz rozwój firmy. Umiejętności: zarządzanie budżetem, analiza danych. Wykształcenie: magister.",
  ru: "Руководитель проекта с опытом работы более 8 лет. Отвечал за управление командой и развитие бизнеса. Навыки: управление бюджетом, анализ данных, переговоры. Образование: магистр экономики, Московский университет.",
  tr: "8 yıllık deneyime sahip proje yöneticisi. Ekip yönetimi ve iş geliştirme için sorumlu olarak çalıştım. Beceriler: bütçe yönetimi, veri analizi. Eğitim: yüksek lisans, bir şirket ile proje.",
  sv: "Projektledare med 8 års erfarenhet av att leda team och utveckla affärer. Ansvarig för budget och arbete med kunder inom företaget. Kunskaper: dataanalys. Utbildning: magisterexamen från Uppsala universitet.",
  id: "Manajer proyek dengan pengalaman 8 tahun dalam mengelola tim dan pengembangan bisnis di perusahaan teknologi. Bertanggung jawab untuk anggaran yang besar karena pertumbuhan. Pendidikan: Universitas Indonesia.",
  mr: "प्रकल्प व्यवस्थापक म्हणून मला ८ वर्षांचा अनुभव आहे. मी संघाचे व्यवस्थापन केले आणि व्यवसाय विकासासाठी काम केले. कौशल्ये: बजेट व्यवस्थापन, डेटा विश्लेषण. शिक्षण: पुणे विद्यापीठातून पदव्युत्तर पदवी.",
  ne: "परियोजना प्रबन्धकको रूपमा मसँग ८ वर्षको अनुभव छ। मैले टोलीको व्यवस्थापन गरें र व्यवसाय विकासमा काम गरेको छु। सीपहरू: बजेट व्यवस्थापन, डाटा विश्लेषण। शिक्षा: त्रिभुवन विश्वविद्यालयबाट स्नातकोत्तर।",
};
const CZECH = "Projektový manažer s osmiletou praxí ve vedení týmu a rozvoji obchodu. Zodpovědný za rozpočet a spolupráci se zákazníky ve společnosti. Dovednosti: analýza dat, vyjednávání, řízení rizik. Vzdělání: magisterský titul na Univerzitě Karlově v Praze, obor ekonomie a management podniku, specializace účetnictví a daně.";
const TERSE_EN = "JOHN SMITH\nSoftware Engineer | Austin, TX\nSKILLS\nPython, Java, AWS, Docker, Kubernetes, React, Node.js, SQL, Git\nWORK HISTORY\nAcme Corp, Backend Developer, 2019-2024\n- Built REST APIs serving 2M requests/day\n- Cut latency 30% via caching\n- Migrated 40 services to Kubernetes\nGlobex, Junior Developer, 2017-2019\n- Wrote unit tests, raised coverage to 85%\nEDUCATION\nBSc Computer Science, UT Austin, 2017";

describe("the audit's six CVs", () => {
  for (const [code, text] of Object.entries(CV)) {
    it(`${code} is ${code}, and the report is not built for it`, () => {
      const r = detectResumeLanguage(text);
      expect(r.language).toBe(code);
      expect(r.supported).toBe(false);
    });
  }
  it("a Marathi or Nepali CV is not Hindi; a Hindi one still is", () => {
    expect(detectResumeLanguage("मुझे 8 वर्षों का अनुभव है। मैंने टीम का प्रबंधन किया और बिक्री बढ़ाई।").language).toBe("hi");
  });
});

describe("what the detector has no list for, it says", () => {
  it("Czech is unknown, in the Latin script", () => {
    const r = detectResumeLanguage(CZECH);
    expect(r).toMatchObject({ language: "unknown", script: "Latin", supported: false });
  });
  // Recheck (2026-11-01): Bulgarian and Serbian were named Russian on words
  // the three share ("или", "при"). Each now has words of its own; none is
  // graded.
  it("Bulgarian is named on its own words, never as Russian, and is not graded", () => {
    const r = detectResumeLanguage("Мениджър проекти с осем години опит в управлението на екипи и развитието на бизнеса в международни компании. Отговарях за бюджета и за връзките с клиентите в региона.");
    expect(r).toMatchObject({ language: "bg", script: "Cyrillic", supported: false });
  });
  it("Bulgarian and Serbian prose that writes 'или' and 'при' is not Russian", () => {
    const bg = detectResumeLanguage("Той е роден в София и е работил като инженер в няколко компании, които са известни в региона. При това той е автор на книги или статии за историята на града, след като е завършил университета.");
    expect(bg.language).not.toBe("ru");
    const sr = detectResumeLanguage("Он је рођен у Београду и радио је као инжењер у неколико компанија које су познате у региону. При томе је аутор књига или чланака о историји града, након што је завршио факултет током рата.");
    expect(sr.language).not.toBe("ru");
    expect(sr.language).toBe("sr");
  });
  it("Chinese, Japanese and Arabic are named by their scripts and words", () => {
    expect(detectResumeLanguage("项目经理，拥有八年团队管理和业务发展经验。负责预算管理与客户合作。技能：数据分析、谈判。教育背景：北京大学经济学硕士。").language).toBe("zh");
    expect(detectResumeLanguage("プロジェクトマネージャーとして8年の経験があります。チームの管理と事業開発を担当しました。スキル：予算管理、データ分析。").language).toBe("ja");
    expect(detectResumeLanguage("مدير مشروع لديه خبرة ثماني سنوات في إدارة الفرق وتطوير الأعمال. كان مسؤولا عن الميزانية والتعاون مع العملاء في الشركة.").language).toBe("ar");
  });
  it("a terse English CV of tool names stays English", () => {
    expect(detectResumeLanguage(TERSE_EN)).toMatchObject({ language: "en", supported: true });
  });
  it("an English CV that names its languages in their scripts stays English", () => {
    expect(detectResumeLanguage(`${TERSE_EN}\nLANGUAGES: English, हिन्दी, Русский`).language).toBe("en");
  });
});

describe("the report says so", () => {
  it("a notice for an unsupported language and for an unknown one; none for a supported one", () => {
    expect(languageNoticeOf(detectResumeLanguage(CV.pl))).toMatchObject({ reason: "unsupported", language: "pl", name: "Polish" });
    expect(languageNoticeOf(detectResumeLanguage(CV.pl))!.message).toMatch(/Polish/);
    expect(languageNoticeOf(detectResumeLanguage(CZECH))).toMatchObject({ reason: "unknown", language: "unknown", name: null });
    expect(languageNoticeOf(detectResumeLanguage(TERSE_EN))).toBeNull();
  });
  it("the prompt names the language and warns about the English keyword evidence", () => {
    const pl = formatLanguageForPrompt(detectResumeLanguage(CV.pl), "FIXED");
    expect(pl).toContain("DETECTED RESUME LANGUAGE: POLISH (MANDATORY)");
    expect(pl).toContain("do not call it missing on that ground alone");
    const cz = formatLanguageForPrompt(detectResumeLanguage(CZECH), "FIXED");
    expect(cz).toContain("RESUME LANGUAGE NOT IDENTIFIED (MANDATORY)");
    expect(cz).toContain("in the language the resume itself is written in");
    expect(formatLanguageForPrompt(detectResumeLanguage(TERSE_EN), "FIXED")).toBe("");
  });
  it("a supported language keeps the instruction it had, with no warning", () => {
    const fr = formatLanguageForPrompt(detectResumeLanguage("Responsable marketing avec 8 années d'expérience en développement de marque. Gestion d'une équipe de 6 personnes. Compétences : campagnes, référencement. Formation : Master, mise en place de projets chez Acme."), "FIXED");
    expect(fr).toContain("DETECTED RESUME LANGUAGE: FRENCH (MANDATORY)");
    expect(fr).not.toContain("ground alone");
  });
});

describe("the corpus slice", () => {
  const cases = (slice as { cases: Array<{ id: string; label: string; synthetic: boolean; text: string; main: string }> }).cases;
  it("holds at least 80 texts, half of them ones main got wrong, most of them real", () => {
    expect(cases.length).toBeGreaterThanOrEqual(80);
    expect(cases.filter((c) => c.main !== c.label).length).toBeGreaterThanOrEqual(cases.length / 2);
    expect(cases.filter((c) => !c.synthetic).length).toBeGreaterThanOrEqual(cases.length / 2);
  });
  for (const c of cases) it(`${c.id} → ${c.label}`, () => expect(detectResumeLanguage(c.text).language).toBe(c.label));
});

describe("both scanners", () => {
  const root = resolve(__dirname, "../../supabase/functions");
  it("resume-language.ts is the same file in both forks, byte for byte", () => {
    expect(readFileSync(resolve(root, "free-keyword-scan-stream/resume-language.ts"), "utf8"))
      .toBe(readFileSync(resolve(root, "free-keyword-scan/resume-language.ts"), "utf8"));
  });
  it("the primary sends the notice and builds its hint from the module", () => {
    const src = readFileSync(resolve(root, "free-keyword-scan/index.ts"), "utf8");
    expect(src).toContain("responseData.languageNotice = languageNoticeOf(resumeLanguage);");
    expect(src).toContain("const languageHint = formatLanguageForPrompt(resumeLanguage, FIXED_CHOICES_STAY_ENGLISH);");
  });
  it("the fallback sends the notice and answers an unknown language in the résumé's own", () => {
    const src = readFileSync(resolve(root, "free-keyword-scan-stream/index.ts"), "utf8");
    expect(src).toContain("languageNotice: languageNoticeOf(detectResumeLanguage(resumeText)),");
    expect(src).toContain("'the language the resume itself is written in'");
  });
});
