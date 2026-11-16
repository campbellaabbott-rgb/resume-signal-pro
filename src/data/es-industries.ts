// Spanish industry display names + the Spanish-token filter for the
// /es/industrias pages. Pure data module — also imported by the build-time
// prerenderer, so keep it free of React/browser imports.

import { SPANISH_INDUSTRY_TERMS } from "./es-industry-terms";

export const ES_INDUSTRIES: Record<string, string> = {
  healthcare: "Salud y Enfermería",
  technology: "Tecnología",
  finance: "Finanzas y Contabilidad",
  sales: "Ventas",
  education: "Educación",
  legal: "Derecho",
  hospitality: "Hotelería",
  culinary: "Cocina y Gastronomía",
  logistics: "Logística",
  construction_management: "Construcción",
  skilled_trades: "Oficios Especializados",
  manufacturing: "Manufactura",
  hr: "Recursos Humanos",
  administrative: "Administración",
  retail: "Ventas Minoristas",
};

// Spanish terms are merged into the primary keyword arrays at engine init —
// this filters them back out for display (accented/Spanish-only tokens).
export const isSpanish = (t: string) => /[áéíóúñü]/.test(t) || /\b(de|para|del|al)\b/.test(t);

/**
 * WHAT AN /es/industrias PAGE PRINTS (S14X-214): every Spanish term and title
 * the engine knows for the industry, from the copy of its own table, and the
 * engine's English terms with every Spanish one left out. The accent guess
 * above stays for an industry the copy does not hold.
 */
export function esIndustryTerms(
  slug: string,
  data: { primary: string[]; titles: string[] },
): { esKeywords: string[]; esTitles: string[]; enKeywords: string[] } {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const es = SPANISH_INDUSTRY_TERMS[slug];
  const spanish = new Set([...(es?.primary ?? []), ...(es?.titles ?? [])]);
  return {
    esKeywords: es ? uniq(es.primary) : uniq(data.primary.filter(isSpanish)).slice(0, 20),
    esTitles: es ? uniq(es.titles) : uniq(data.titles.filter(isSpanish)).slice(0, 14),
    enKeywords: uniq(data.primary.filter((t) => !isSpanish(t) && !spanish.has(t))).slice(0, 14),
  };
}

/** A snippet opens with a capital, as a sentence does (SEO-F16). */
export const capitalizeFirst = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("es") + s.slice(1) : s);
