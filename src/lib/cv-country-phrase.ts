/**
 * A COUNTRY'S NAME AS A SENTENCE NEEDS IT, per language (SEO-034).
 *
 * The CV-standards templates (src/data/cv-standards-content.ts) put the bare
 * country name after a preposition: the bake served "CV Rules in United
 * States", "CV & resume standards in United States" and "Currículo em Brasil".
 * English wants the article for a few names; Portuguese contracts the
 * preposition with it ("no Brasil", "do Brasil"); German does for Switzerland
 * ("in der Schweiz"); French wants it after "vise" and "de". This fills a
 * template the way the template's own `fill` does, but rewrites the phrase
 * around each {name} first. Pure, for both renderers: the bake fills with it,
 * and the React page (src/pages/CvStandards.tsx) can call the same function.
 */
import { fill } from "../data/cv-standards-content";
import type { CvTemplateStrings } from "../data/cv-standards-content";

/** English names that take "the". */
const EN_THE = new Set(["United States", "United Kingdom", "Netherlands", "Philippines", "United Arab Emirates", "Czech Republic", "Bahamas", "Gambia"]);

/** Per locale and country name: the article-bearing forms a template's preposition turns into. */
type Forms = { in: string; of: string; bare: string };
const FORMS: Record<string, Record<string, Forms>> = {
  pt: {
    Brasil: { in: "no Brasil", of: "do Brasil", bare: "o Brasil" },
  },
  de: {
    Schweiz: { in: "in der Schweiz", of: "der Schweiz", bare: "die Schweiz" },
  },
  fr: {
    France: { in: "en France", of: "de la France", bare: "la France" },
    Belgique: { in: "en Belgique", of: "de la Belgique", bare: "la Belgique" },
    Suisse: { in: "en Suisse", of: "de la Suisse", bare: "la Suisse" },
  },
};

/** The preposition-plus-{name} patterns each language's templates use, mapped to the form that replaces them. */
const PATTERNS: Record<string, Array<[RegExp, keyof Forms | ((f: Forms) => string)]>> = {
  pt: [[/\bem \{name\}/g, "in"], [/\bde \{name\}/g, "of"], [/\bmira \{name\}/g, (f) => `mira ${f.bare}`]],
  de: [[/\bin \{name\}/g, "in"], [/\bvon \{name\}/g, (f) => `von ${f.of}`], [/\bauf \{name\}/g, (f) => `auf ${f.bare}`]],
  fr: [[/\ben \{name\}/g, "in"], [/\bde \{name\}/g, "of"], [/\bvise \{name\}/g, (f) => `vise ${f.bare}`]],
};

/**
 * A CV-standards template filled for one country in one language, with the
 * country's name in the form each phrase needs. `name` is the country's name
 * in that language (the English page's COUNTRY_STANDARDS name, a localized
 * page's countryName).
 */
export function cvFill(template: string, vars: { name: string; docTerm?: string }, locale = "en"): string {
  let t = String(template ?? "");
  const name = vars.name;
  if (locale === "en" && EN_THE.has(name)) {
    // "{name}'s norms" on a name ending in s takes the bare apostrophe.
    const the = `the ${name}`;
    t = t.replace(/\{name\}'s/g, /s$/.test(name) ? `${the}'` : `${the}'s`).replace(/\{name\}/g, the);
  } else {
    const forms = FORMS[locale]?.[name];
    if (forms) {
      for (const [re, form] of PATTERNS[locale] ?? []) {
        t = t.replace(re, () => (typeof form === "function" ? form(forms) : forms[form]));
      }
    }
  }
  return fill(t, { ...vars, name, docTerm: vars.docTerm ?? "" });
}

/** The same rules over text already filled with `name`. */
export function countryPhraseFix(locale: string | undefined, text: string, name: string): string {
  return name ? cvFill(text.split(name).join("{name}"), { name }, locale ?? "en") : text;
}

/**
 * THE TWO QUESTIONS A COUNTRY PAGE ANSWERS, FOR THE MARKUP AND THE PAGE ALIKE
 * (SEO-032). The FAQPage block asked "Should a CV in … include a photo?" and
 * "How long should a CV be in …?" on 73 pages that never showed either
 * question. Both renderers (src/pages/CvStandards.tsx and the bake) print
 * these as visible questions with their answers, and the markup is built
 * from the same array.
 */
export function cvStandardsFaqs(
  locale: string | undefined,
  t: CvTemplateStrings,
  facts: { name: string; docTerm: string; photo: keyof CvTemplateStrings["photoNorms"]; photoNote: string; lengthNote: string },
): Array<{ q: string; a: string }> {
  const vars = { name: facts.name, docTerm: facts.docTerm };
  const lng = locale ?? "en";
  return [
    { q: cvFill(t.faqPhoto, vars, lng), a: `${t.photoNorms[facts.photo]}. ${facts.photoNote}` },
    { q: cvFill(t.faqLength, vars, lng), a: facts.lengthNote },
  ];
}
