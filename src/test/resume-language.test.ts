// Regression tests for deterministic resume-language detection. Exists because
// the in-prompt "detect the language and respond in it" instruction demonstrably
// failed in production (a French resume got an English report, 2026-07-09) —
// the language is now detected server-side and injected as a hard instruction.
import { describe, it, expect } from "vitest";
import { detectResumeLanguage } from "../../supabase/functions/free-keyword-scan/resume-language";
import { detectCountryFromResume } from "../../supabase/functions/free-keyword-scan/market-intelligence";

describe("detectResumeLanguage — non-English resumes", () => {
  it("detects French", () => {
    const r = detectResumeLanguage(
      "Responsable marketing avec 8 années d'expérience en développement de marque. Gestion d'une équipe de 6 personnes. Compétences : campagnes, référencement. Formation : Master, mise en place de projets chez Acme.",
    );
    expect(r.language).toBe("fr");
    expect(r.languageName).toBe("French");
  });

  it("detects Spanish", () => {
    const r = detectResumeLanguage(
      "Gerente de marketing con 8 años de experiencia en desarrollo de marca y gestión de equipo. Responsable de campañas para la empresa. Habilidades: ventas, mejora continua. Educación: Licenciatura. Logros: aumenté el trabajo del equipo.",
    );
    expect(r.language).toBe("es");
  });

  it("detects German", () => {
    const r = detectResumeLanguage(
      "Marketingleiter mit 8 Jahre Berufserfahrung und Erfahrung in der Entwicklung von Marken. Verantwortlich für die Leitung und Umsetzung von Projekte. Kenntnisse und Fähigkeiten: Vertrieb. Ausbildung: Master. Während der Zeit im Unternehmen über 40% Wachstum.",
    );
    expect(r.language).toBe("de");
  });

  it("detects Portuguese", () => {
    const r = detectResumeLanguage(
      "Gerente de marketing com 8 anos de experiência em desenvolvimento de marca e gestão de equipe. Responsável por campanhas na empresa. Habilidades: vendas, não desisto. Educação: são muitos projetos, conhecimentos de liderança de equipe.",
    );
    expect(r.language).toBe("pt");
  });

  it("detects Hindi via Devanagari script", () => {
    const r = detectResumeLanguage(
      "मार्केटिंग प्रबंधक — 8 वर्षों का अनुभव। ब्रांड विकास और टीम प्रबंधन में विशेषज्ञता। शिक्षा: स्नातक। कौशल: बिक्री, अभियान प्रबंधन, नेतृत्व।",
    );
    expect(r.language).toBe("hi");
    expect(r.confidence).toBe("high");
  });
});

describe("detectResumeLanguage — English stays English", () => {
  it("detects a plain English resume", () => {
    const r = detectResumeLanguage(
      "Marketing manager with 8 years of experience. Led a team of 6 and managed brand campaigns. Developed content strategy and improved organic traffic. Skills: SEO, analytics. Education: BSc. Responsible for the project roadmap.",
    );
    expect(r.language).toBe("en");
  });

  it("is not fooled by MIT / von Neumann / für-free English text", () => {
    const r = detectResumeLanguage(
      "Software engineer, MIT graduate. Worked with the von Neumann architecture team and led development of distributed systems. Years of experience with the team, managed and improved project delivery skills.",
    );
    expect(r.language).toBe("en");
  });

  it("is not flipped by a couple of borrowed Spanish words", () => {
    const r = detectResumeLanguage(
      "Bilingual account manager with years of experience. Led the Latin America team, managed client relationships in Spanish and English, and improved retention. Skills: Salesforce, negotiation, teamwork, education programs.",
    );
    expect(r.language).toBe("en");
  });
});

describe("resume language as a geo signal", () => {
  it("a French-language resume with no city resolves toward FR", () => {
    const r = detectCountryFromResume(
      "Responsable marketing avec 8 années d'expérience en développement de marque. Gestion d'une équipe de 6 personnes. Compétences : campagnes, référencement. Formation : Master, mise en place de projets chez Acme.",
    );
    expect(r.country).toBe("FR");
  });

  it("a Portuguese resume with São Paulo corroborates BR (not PT)", () => {
    const r = detectCountryFromResume(
      "Gerente de marketing, São Paulo. 8 anos de experiência em desenvolvimento de marca e gestão de equipe. Responsável por campanhas na empresa, conhecimentos de liderança de equipe e educação corporativa.",
    );
    expect(r.country).toBe("BR");
  });

  it("an English resume gains no language-based country", () => {
    const r = detectCountryFromResume(
      "Marketing manager with years of experience. Led a team and managed brand campaigns, developed strategy and improved results. Education: BSc. Skills: analytics.",
    );
    expect(r.country).toBeNull();
  });
});
