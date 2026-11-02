/**
 * ONE SCORE, ONE GRADE, IN THE MAIL AND ON THE PAGE IT LINKS TO (S13-101).
 *
 * The mail graded and coloured a score on 80 and 60, so an 82 read
 * "Excellent" in green in the inbox and "Good" on the analysis page the
 * button opens, which grades on 85, 70 and 50
 * (src/components/AnalysisResults.tsx, calculateResumeScore). The mail now
 * reads the page's bands: its top line from 85, its middle line from 70, its
 * last line below 70; and the page's colours: green from 70, amber from 50,
 * red below.
 *
 * And the industry is the analysis's fixed choice ("data_engineering"),
 * printed raw. It is now the label the page shows for it in the mail's
 * language: these tables are the locale files' analysisResults.enum.industry,
 * held equal to them by
 * src/test/one-score-is-one-grade-in-the-analysis-mail-and-on-its-page.test.ts.
 * A value that is not one of the choices reads as the page reads it, its
 * underscores as spaces; none at all is the mail's own default.
 *
 * Import-free, so the Node tests import it.
 */
export type MailGrade = "high" | "mid" | "low";

/** The page's bands, highest first: excellent from 85, good from 70. */
export const MAIL_GRADE_FLOORS: ReadonlyArray<readonly [number, MailGrade]> = [[85, "high"], [70, "mid"]];

export function mailGrade(score: number): MailGrade {
  for (const [floor, grade] of MAIL_GRADE_FLOORS) if (score >= floor) return grade;
  return "low";
}

/** The page's colours: success from 70, warning from 50, destructive below. */
export function mailScoreColor(score: number): string {
  return score >= 70 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444";
}

type IndustryLabels = Readonly<Record<string, string>>;

/** The page's labels, per mail language (en-GB reads en's: the locale files agree). */
export const INDUSTRY_LABELS: Readonly<Record<"en" | "de" | "es" | "fr" | "hi" | "nl" | "pt" | "tl", IndustryLabels>> = {
  en: {
    technology: "Technology",
    data_engineering: "Data Engineering",
    data_science: "Data Science",
    machine_learning: "Machine Learning",
    healthcare: "Healthcare",
    finance: "Finance",
    marketing: "Marketing",
    sales: "Sales",
    engineering: "Engineering",
    education: "Education",
    hr: "HR",
    consulting: "Consulting",
    legal: "Legal",
    retail: "Retail",
    hospitality: "Hospitality",
    manufacturing: "Manufacturing",
    government: "Government",
    product_management: "Product Management",
    creative: "Creative",
    general: "General",
  },
  de: {
    technology: "Technologie",
    data_engineering: "Data Engineering",
    data_science: "Data Science",
    machine_learning: "Maschinelles Lernen",
    healthcare: "Gesundheitswesen",
    finance: "Finanzen",
    marketing: "Marketing",
    sales: "Vertrieb",
    engineering: "Ingenieurwesen",
    education: "Bildung",
    hr: "Personalwesen",
    consulting: "Beratung",
    legal: "Recht",
    retail: "Einzelhandel",
    hospitality: "Gastgewerbe",
    manufacturing: "Fertigung",
    government: "Öffentlicher Dienst",
    product_management: "Produktmanagement",
    creative: "Kreativbranche",
    general: "Allgemein",
  },
  es: {
    technology: "Tecnología",
    data_engineering: "Ingeniería de datos",
    data_science: "Ciencia de datos",
    machine_learning: "Aprendizaje automático",
    healthcare: "Salud",
    finance: "Finanzas",
    marketing: "Marketing",
    sales: "Ventas",
    engineering: "Ingeniería",
    education: "Educación",
    hr: "Recursos humanos",
    consulting: "Consultoría",
    legal: "Legal",
    retail: "Comercio minorista",
    hospitality: "Hostelería",
    manufacturing: "Fabricación",
    government: "Sector público",
    product_management: "Gestión de producto",
    creative: "Sector creativo",
    general: "General",
  },
  fr: {
    technology: "Technologie",
    data_engineering: "Ingénierie des données",
    data_science: "Science des données",
    machine_learning: "Apprentissage automatique",
    healthcare: "Santé",
    finance: "Finance",
    marketing: "Marketing",
    sales: "Ventes",
    engineering: "Ingénierie",
    education: "Éducation",
    hr: "Ressources humaines",
    consulting: "Conseil",
    legal: "Juridique",
    retail: "Commerce de détail",
    hospitality: "Hôtellerie-restauration",
    manufacturing: "Industrie manufacturière",
    government: "Secteur public",
    product_management: "Gestion de produit",
    creative: "Métiers créatifs",
    general: "Général",
  },
  hi: {
    technology: "प्रौद्योगिकी",
    data_engineering: "डेटा इंजीनियरिंग",
    data_science: "डेटा साइंस",
    machine_learning: "मशीन लर्निंग",
    healthcare: "स्वास्थ्य सेवा",
    finance: "वित्त",
    marketing: "मार्केटिंग",
    sales: "बिक्री",
    engineering: "इंजीनियरिंग",
    education: "शिक्षा",
    hr: "मानव संसाधन",
    consulting: "परामर्श",
    legal: "कानूनी",
    retail: "खुदरा",
    hospitality: "आतिथ्य",
    manufacturing: "विनिर्माण",
    government: "सरकारी क्षेत्र",
    product_management: "प्रोडक्ट मैनेजमेंट",
    creative: "रचनात्मक क्षेत्र",
    general: "सामान्य",
  },
  nl: {
    technology: "Technologie",
    data_engineering: "Data-engineering",
    data_science: "Datawetenschap",
    machine_learning: "Machine learning",
    healthcare: "Gezondheidszorg",
    finance: "Financiën",
    marketing: "Marketing",
    sales: "Verkoop",
    engineering: "Techniek",
    education: "Onderwijs",
    hr: "HR",
    consulting: "Consultancy",
    legal: "Juridisch",
    retail: "Detailhandel",
    hospitality: "Horeca",
    manufacturing: "Productie",
    government: "Overheid",
    product_management: "Productmanagement",
    creative: "Creatieve sector",
    general: "Algemeen",
  },
  pt: {
    technology: "Tecnologia",
    data_engineering: "Engenharia de dados",
    data_science: "Ciência de dados",
    machine_learning: "Aprendizado de máquina",
    healthcare: "Saúde",
    finance: "Finanças",
    marketing: "Marketing",
    sales: "Vendas",
    engineering: "Engenharia",
    education: "Educação",
    hr: "Recursos humanos",
    consulting: "Consultoria",
    legal: "Jurídico",
    retail: "Varejo",
    hospitality: "Hotelaria",
    manufacturing: "Manufatura",
    government: "Setor público",
    product_management: "Gestão de produto",
    creative: "Área criativa",
    general: "Geral",
  },
  tl: {
    technology: "Teknolohiya",
    data_engineering: "Data Engineering",
    data_science: "Data Science",
    machine_learning: "Machine Learning",
    healthcare: "Pangangalagang Pangkalusugan",
    finance: "Pananalapi",
    marketing: "Marketing",
    sales: "Pagbebenta",
    engineering: "Inhinyeriya",
    education: "Edukasyon",
    hr: "HR",
    consulting: "Pagkonsulta",
    legal: "Legal",
    retail: "Retail",
    hospitality: "Hospitality",
    manufacturing: "Pagmamanupaktura",
    government: "Gobyerno",
    product_management: "Product Management",
    creative: "Malikhaing Larangan",
    general: "Pangkalahatan",
  },
};

/** The industry as the page names it in this language, or null when the analysis names none. */
export function industryLabel(language: string, industry: unknown): string | null {
  if (typeof industry !== "string" || !industry.trim()) return null;
  const key = industry.trim().toLowerCase();
  const table = INDUSTRY_LABELS[(language === "en-GB" ? "en" : language) as keyof typeof INDUSTRY_LABELS] ?? INDUSTRY_LABELS.en;
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : industry.trim().replace(/_/g, " ");
}
