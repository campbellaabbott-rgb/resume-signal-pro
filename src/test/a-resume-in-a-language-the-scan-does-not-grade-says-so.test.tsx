/**
 * A RÉSUMÉ IN A LANGUAGE THE SCAN DOES NOT GRADE SAYS SO ON THE PAGE
 * (register S13-024, where the engine half meets the page half).
 *
 * The engine (fix/free-scan-wave) now detects Polish, Turkish, Swedish,
 * Cyrillic and the rest and answers languageNotice: {reason, language, name,
 * script, message} when it does not grade the language or cannot name it.
 * The page (fix/free-scan-ui) rendered nothing from it, so a Polish CV still
 * got a report that read as an English reading of the whole document: the
 * item's "the report must SAY so" held only in the JSON. This holds the
 * field from the scanner's response to the banner, in the reader's language.
 *
 * Review fix (2026-11-01). The banner's body said the checks were "built for
 * English, Spanish, French, German, Portuguese, Dutch, Italian, Hindi and
 * Tagalog", but the keyword and section checks look for English terms only;
 * the model writes the report's text in the résumé's language (the prompt's
 * RESPOND rule). It now says that, and lists no languages.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { detectResumeLanguage, languageNoticeOf } from "../../supabase/functions/free-keyword-scan/resume-language";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const report = (extra: Record<string, unknown>) => render(
  <MemoryRouter>
    <FreeKeywordResults
      industry="general"
      atsScoreEstimate={61}
      formatGrade="B"
      formatIssue="Clean single-column layout"
      resumeLength={"good" as never}
      redFlags={[]}
      keywords={[]}
      sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
      onGetFullAnalysis={vi.fn()}
      {...(extra as object)}
    />
  </MemoryRouter>,
);

const POLISH_CV = [
  "Anna Kowalska — Kierownik Projektu",
  "Doświadczenie zawodowe",
  "2019 – obecnie: Kierownik projektu w firmie budowlanej w Warszawie. Odpowiadałam za harmonogram, budżet i zespół dwunastu osób.",
  "2015 – 2019: Specjalista ds. zakupów. Negocjowałam umowy z dostawcami i obniżyłam koszty o 15%.",
  "Wykształcenie: Politechnika Warszawska, inżynier budownictwa.",
  "Umiejętności: zarządzanie projektami, negocjacje, język angielski, prawo jazdy kat. B.",
].join("\n");

describe("the report says when the scan does not grade the résumé's language", () => {
  it("the scanner's own notice for a Polish CV becomes a banner naming the language, before any score", () => {
    const notice = languageNoticeOf(detectResumeLanguage(POLISH_CV));
    expect(notice, "the engine graded a Polish CV as a language it supports").not.toBeNull();
    expect(notice!.reason).toBe("unsupported");
    const { container } = report({ languageNotice: notice });
    const banner = container.querySelector("[data-language-notice]");
    expect(banner, "a Polish CV's notice reached the page and was not shown").not.toBeNull();
    expect(banner!.textContent).toContain(en.freeResults.languageNotice.unsupportedTitle.replace("{{language}}", "Polish"));
    expect(banner!.textContent).toContain(en.freeResults.languageNotice.body);
    const text = container.textContent ?? "";
    expect(text.indexOf(en.freeResults.languageNotice.body)).toBeLessThan(text.indexOf("61"));
  });

  it("a language it could not identify says that, and so does a notice that names no language", () => {
    for (const notice of [
      { reason: "unknown", language: "unknown", name: null, script: "Cyrillic" },
      { reason: "unsupported", language: "", name: null },
    ]) {
      const { container, unmount } = report({ languageNotice: notice });
      expect(container.querySelector("[data-language-notice]")?.textContent, JSON.stringify(notice)).toContain(en.freeResults.languageNotice.unknownTitle);
      unmount();
    }
  });

  it("a graded language, an older response or a shape the scanner never sends shows nothing", () => {
    for (const extra of [{}, { languageNotice: null }, { languageNotice: undefined }, { languageNotice: "pl" }, { languageNotice: { reason: "supported", language: "en" } }]) {
      const { container, unmount } = report(extra);
      expect(container.querySelector("[data-language-notice]"), JSON.stringify(extra)).toBeNull();
      unmount();
    }
    expect(languageNoticeOf(detectResumeLanguage("Registered Nurse with eight years in acute care. Led a ward of 30 beds and trained new staff in patient safety and medication administration."))).toBeNull();
  });
});

describe("the field travels from both scanners to the report under one name", () => {
  it("both scanners answer languageNotice, and Index hands it to the report", () => {
    expect(read("supabase/functions/free-keyword-scan/index.ts")).toMatch(/responseData\.languageNotice = languageNoticeOf\(/);
    expect(read("supabase/functions/free-keyword-scan-stream/index.ts")).toMatch(/languageNotice: languageNoticeOf\(/);
    expect(read("src/pages/Index.tsx")).toMatch(/languageNotice=\{freeKeywordResult\.languageNotice \?\? null\}/);
  });

  it("every locale says it in its own words, and names the language where the scanner gave one", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
      const n = d.freeResults.languageNotice;
      expect(n.unsupportedTitle, file).toContain("{{language}}");
      for (const k of ["unknownTitle", "unsupportedTitle", "body"] as const) {
        expect(typeof n[k] === "string" && n[k].length > 20, `${file} ${k}`).toBe(true);
        if (!file.startsWith("en")) expect(n[k], `${file} ${k} is the English sentence`).not.toBe(en.freeResults.languageNotice[k]);
      }
    }
  });

  it("the body says the checks look for English terms and the report is in the résumé's language, naming no list of languages", () => {
    const body = en.freeResults.languageNotice.body;
    expect(body).toMatch(/written in your resume's language/);
    expect(body).toMatch(/look for English terms/);
    for (const lang of ["Spanish", "French", "German", "Portuguese", "Dutch", "Italian", "Hindi", "Tagalog"]) expect(body).not.toContain(lang);
    expect(read("supabase/functions/free-keyword-scan/index.ts")).toMatch(/RESPOND in the SAME LANGUAGE as the resume/);
    // No locale keeps the old claim that the checks were built for nine languages.
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const b = String(JSON.parse(readFileSync(resolve(dir, file), "utf8")).freeResults.languageNotice.body);
      expect(b, file).not.toMatch(/Tagalog|Tagalo|Tagalogue/i);
      const english: Record<string, string> = { "en.json": "English", "en-GB.json": "English", "de.json": "englisch", "fr.json": "anglais", "es.json": "inglés", "pt.json": "inglês", "nl.json": "Engelse", "hi.json": "अंग्रेज़ी", "tl.json": "English" };
      expect(english[file], `${file} has no expected word for English here`).toBeTruthy();
      expect(b.toLowerCase(), `${file} does not say the checks look for English terms`).toContain(english[file].toLowerCase());
    }
  });

  // Landing check F4 (2026-11-01): the title said the scan did not grade the
  // language at all, over a report that still prints an ATS score, a band and
  // a score card. The server's notice claims less: only the keyword and
  // section checks are built for the languages it lists. The title now says
  // that much, in every locale.
  it("the title claims what the scanner's notice claims: the keyword and section checks, not the whole scan", () => {
    expect(languageNoticeOf(detectResumeLanguage(POLISH_CV))!.message).toMatch(/keyword and section checks are built for/);
    expect(en.freeResults.languageNotice.unsupportedTitle).toMatch(/keyword and section checks are not built for/);
    const dir = resolve(ROOT, "src/i18n/locales");
    // The withdrawn whole-scan claim, as each locale said it, and the checks
    // each locale's body names, which the title now names too.
    const withdrawn: Record<string, RegExp> = {
      "en.json": /does not grade/, "en-GB.json": /does not grade/, "de.json": /nicht bewertet/, "es.json": /no evalúa/,
      "fr.json": /n'évalue pas/, "hi.json": /मूल्यांकन नहीं/, "nl.json": /niet beoordeelt/, "pt.json": /não avalia/, "tl.json": /hindi sinusuri/,
    };
    const checks: Record<string, RegExp> = {
      "en.json": /keyword and section checks/, "en-GB.json": /keyword and section checks/, "de.json": /Schlüsselwort- und Abschnittsprüfungen/,
      "es.json": /palabras clave y de secciones/, "fr.json": /mots-clés et des sections/, "hi.json": /कीवर्ड और सेक्शन/,
      "nl.json": /trefwoorden en secties/, "pt.json": /palavras-chave e de seções/, "tl.json": /keyword at seksyon/,
    };
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(9);
    for (const file of files) {
      const title = String(JSON.parse(readFileSync(resolve(dir, file), "utf8")).freeResults.languageNotice.unsupportedTitle);
      expect(withdrawn[file] && checks[file], `${file} has no expected phrases here`).toBeTruthy();
      expect(title, `${file} still says the scan does not grade the language`).not.toMatch(withdrawn[file]);
      expect(title, `${file} does not name the keyword and section checks`).toMatch(checks[file]);
    }
  });
});
