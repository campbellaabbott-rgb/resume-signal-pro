/**
 * THE SECTION HEADINGS OF A RÉSUMÉ, IN THE RÉSUMÉ'S OWN LANGUAGE
 * (S12-030; S14X-187: C-S14-140).
 *
 * The PDF, the Word file and the preview beside the editor all take their
 * headings from here, so what the person sees is what the employer gets.
 *
 * Before: the exports knew seven Latin-script languages, so a Devanagari or a
 * Tagalog résumé went out under "EXPERIENCE", and the preview headed every
 * résumé in the reader's interface language (a German résumé read
 * "EXPERIENCE" in the preview and "BERUFSERFAHRUNG" in its file).
 *
 * The language, in order:
 *   1. Hindi, when at least half the letters of the résumé's sentences are
 *      Devanagari;
 *   2. Tagalog, when its marker words are frequent and lead every other
 *      language's by the posting detector's own margin;
 *   3. the posting detector's language (en, de, nl, fr, es, pt, it);
 *   4. when none is clear, the reader's interface language, but only when
 *      its headings are written in the script the résumé is written in;
 *   5. English.
 *
 * Plain module with no React and no export libraries, so the page's preview
 * can import it without pulling the exporter into its chunk.
 */
import type { BuilderResume } from "@/types/resume-builder";
import {
  LEAD_RATIO,
  MIN_HITS,
  detectPostingLanguage,
  languageScores,
  type PostingLanguage,
} from "../../supabase/functions/_shared/posting-language";

/** The section headings an export prints. */
export type SectionLabels = { summary: string; experience: string; education: string; skills: string; certifications: string };

export type SectionLabelLanguage = PostingLanguage | "hi" | "tl";

export const SECTION_LABELS: Record<SectionLabelLanguage, SectionLabels> = {
  en: { summary: "Summary", experience: "Experience", education: "Education", skills: "Skills", certifications: "Certifications" },
  de: { summary: "Profil", experience: "Berufserfahrung", education: "Ausbildung", skills: "Kenntnisse", certifications: "Zertifizierungen" },
  nl: { summary: "Profiel", experience: "Werkervaring", education: "Opleiding", skills: "Vaardigheden", certifications: "Certificeringen" },
  fr: { summary: "Profil", experience: "Expérience professionnelle", education: "Formation", skills: "Compétences", certifications: "Certifications" },
  es: { summary: "Perfil", experience: "Experiencia profesional", education: "Formación", skills: "Habilidades", certifications: "Certificaciones" },
  pt: { summary: "Perfil", experience: "Experiência profissional", education: "Formação", skills: "Competências", certifications: "Certificações" },
  it: { summary: "Profilo", experience: "Esperienza professionale", education: "Istruzione", skills: "Competenze", certifications: "Certificazioni" },
  hi: { summary: "सारांश", experience: "कार्य अनुभव", education: "शिक्षा", skills: "कौशल", certifications: "प्रमाणपत्र" },
  tl: { summary: "Buod", experience: "Karanasan sa Trabaho", education: "Edukasyon", skills: "Mga Kasanayan", certifications: "Mga Sertipikasyon" },
};

type Script = "latin" | "devanagari" | "other";
const LABEL_SCRIPT: Record<SectionLabelLanguage, Script> = {
  en: "latin", de: "latin", nl: "latin", fr: "latin", es: "latin", pt: "latin", it: "latin", tl: "latin", hi: "devanagari",
};

// Frequent in Tagalog sentences and not a frequent word of the posting
// detector's languages ("para" is Spanish, "na" Portuguese) or of an English
// résumé ("at", "may"): those are left out.
const TAGALOG_MARKERS = new Set([
  "ang", "ng", "mga", "sa", "ay", "ako", "akong", "isang", "ko", "kami", "namin", "aming", "ito", "nang",
  "karanasan", "taon", "koponan", "trabaho", "pamamahala", "bilang", "gumawa", "nagtrabaho", "pinamahalaan", "naging",
  "kasama", "mula", "hanggang", "ating", "siya", "kanilang", "pagsusuri", "kumpanya",
]);

const DEVANAGARI_LETTER = /(?=\p{L})\p{Script=Devanagari}/u;
const LATIN_LETTER = /(?=\p{L})\p{Script=Latin}/u;

function prose(resume: BuilderResume): string {
  return [
    resume.summary,
    resume.contact?.title,
    ...(resume.experience ?? []).flatMap((e) => [e.title, ...(e.bullets ?? [])]),
    ...(resume.education ?? []).map((e) => e.details),
  ].filter((s): s is string => typeof s === "string" && s.length > 0).join("\n");
}

function allText(resume: BuilderResume): string {
  const c = resume.contact ?? ({} as BuilderResume["contact"]);
  return [
    c.fullName, c.title, c.location, resume.summary,
    ...(resume.experience ?? []).flatMap((e) => [e.company, e.title, e.location, ...(e.bullets ?? [])]),
    ...(resume.education ?? []).flatMap((e) => [e.school, e.degree, e.field, e.details]),
    ...(resume.skills ?? []), ...(resume.certifications ?? []),
  ].filter((s): s is string => typeof s === "string" && s.length > 0).join("\n");
}

function letterCounts(text: string): { total: number; devanagari: number; latin: number } {
  let total = 0, devanagari = 0, latin = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    total++;
    if (DEVANAGARI_LETTER.test(ch)) devanagari++;
    else if (LATIN_LETTER.test(ch)) latin++;
  }
  return { total, devanagari, latin };
}

function dominantScript(text: string): Script | null {
  const n = letterCounts(text);
  if (n.total === 0) return null;
  if (n.devanagari >= n.latin && n.devanagari >= n.total - n.devanagari - n.latin) return "devanagari";
  if (n.latin >= n.total - n.devanagari - n.latin) return "latin";
  return "other";
}

function isTagalog(text: string): boolean {
  const words = String(text).slice(0, 20_000).toLowerCase().split(/[^\p{L}]+/u);
  let hits = 0;
  for (const w of words) if (w && TAGALOG_MARKERS.has(w)) hits++;
  if (hits < MIN_HITS) return false;
  const others = Object.values(languageScores(text));
  return others.every((n) => hits >= n * LEAD_RATIO);
}

/** The heading language for an interface language tag (en-GB → en, fr-CA → fr, fil → tl), or null. */
export function labelLanguageOf(tag: string | null | undefined): SectionLabelLanguage | null {
  const base = String(tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (base === "fil") return "tl";
  return base in SECTION_LABELS ? (base as SectionLabelLanguage) : null;
}

/** The language of a résumé's headings (see the order above). */
export function resumeLabelLanguage(resume: BuilderResume, opts: { uiLanguage?: string | null } = {}): SectionLabelLanguage {
  const text = prose(resume);
  const n = letterCounts(text);
  if (n.total > 0 && n.devanagari / n.total >= 0.5) return "hi";
  if (isTagalog(text)) return "tl";
  const detected = detectPostingLanguage(text);
  if (detected) return detected;
  const ui = labelLanguageOf(opts.uiLanguage);
  if (ui) {
    const script = dominantScript(allText(resume));
    if (script === null || script === LABEL_SCRIPT[ui]) return ui;
  }
  return "en";
}

/**
 * The headings for a résumé, by the language its own sentences are written
 * in; the reader's language when that is not clear and shares the résumé's
 * script; English otherwise.
 */
export function resumeSectionLabels(resume: BuilderResume, opts: { uiLanguage?: string | null } = {}): SectionLabels {
  return SECTION_LABELS[resumeLabelLanguage(resume, opts)];
}
