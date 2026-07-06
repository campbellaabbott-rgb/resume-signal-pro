// Spanish industry display names + the Spanish-token filter for the
// /es/industrias pages. Pure data module — also imported by the build-time
// prerenderer, so keep it free of React/browser imports.

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
