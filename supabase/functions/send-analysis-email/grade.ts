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
 * The level is the same (S14X-209): the mail printed the fixed choice ("mid")
 * under a CSS capitalize, so a German buyer read "Mid"; it is the page's
 * label now (analysisResults.enum.experienceLevel, "Mittlere Ebene"), held
 * equal to the locale files by the same test.
 *
 * And a section the analysis could not write (S14X-041) is named in the
 * mail: the posting comparison or the LinkedIn review, each one line in the
 * mail's language and tone (German, Spanish and Dutch informal, French and
 * Hindi formal, as ./copy.ts is).
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
type MailTable = "en" | "de" | "es" | "fr" | "hi" | "nl" | "pt" | "tl";

/** A mail language's table: en-GB reads en's (the locale files agree), anything else English. */
function tableOf<T>(tables: Readonly<Record<MailTable, T>>, language: string): T {
  return tables[(language === "en-GB" ? "en" : language) as MailTable] ?? tables.en;
}

/** The page's labels, per mail language (en-GB reads en's: the locale files agree). */
export const INDUSTRY_LABELS: Readonly<Record<MailTable, IndustryLabels>> = {
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

/** A fixed choice as the page names it, or as the page reads a value that is not one; null when there is none. */
function choiceLabel(table: IndustryLabels, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const key = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : value.trim().replace(/_/g, " ");
}

/** The industry as the page names it in this language, or null when the analysis names none. */
export function industryLabel(language: string, industry: unknown): string | null {
  return choiceLabel(tableOf(INDUSTRY_LABELS, language), industry);
}

/** The page's level labels (analysisResults.enum.experienceLevel), per mail language. */
export const EXPERIENCE_LABELS: Readonly<Record<MailTable, IndustryLabels>> = {
  en: { entry: "Entry", mid: "Mid", senior: "Senior", executive: "Executive" },
  de: { entry: "Einstieg", mid: "Mittlere Ebene", senior: "Senior", executive: "Führungsebene" },
  es: { entry: "inicial", mid: "intermedio", senior: "sénior", executive: "ejecutivo" },
  fr: { entry: "débutant", mid: "intermédiaire", senior: "senior", executive: "dirigeant" },
  hi: { entry: "प्रारंभिक", mid: "मध्य", senior: "वरिष्ठ", executive: "कार्यकारी" },
  nl: { entry: "Starter", mid: "Medior", senior: "Senior", executive: "Directie" },
  pt: { entry: "inicial", mid: "pleno", senior: "sênior", executive: "executivo" },
  tl: { entry: "Baguhan", mid: "Gitna", senior: "Senior", executive: "Ehekutibo" },
};

/** The level as the page names it in this language, or null when the analysis names none. */
export function experienceLabel(language: string, level: unknown): string | null {
  return choiceLabel(tableOf(EXPERIENCE_LABELS, language), level);
}

/** The sections an analysis can go out without: the posting comparison and the LinkedIn review. */
export type MissingSection = "jobDescription" | "linkedIn";

/** One line per section the analysis could not write, per mail language. */
export const SECTION_MISSING_LINES: Readonly<Record<MailTable, Readonly<Record<MissingSection, string>>>> = {
  en: {
    jobDescription: "The comparison with your job posting could not be written this time, so this analysis does not include it.",
    linkedIn: "The review of your LinkedIn profile could not be written this time, so this analysis does not include it.",
  },
  de: {
    jobDescription: "Der Abgleich mit deiner Stellenanzeige konnte diesmal nicht erstellt werden, deshalb fehlt er in dieser Analyse.",
    linkedIn: "Die Auswertung deines LinkedIn-Profils konnte diesmal nicht erstellt werden, deshalb fehlt sie in dieser Analyse.",
  },
  es: {
    jobDescription: "Esta vez no se pudo redactar la comparación con tu oferta de empleo, así que este análisis no la incluye.",
    linkedIn: "Esta vez no se pudo redactar la revisión de tu perfil de LinkedIn, así que este análisis no la incluye.",
  },
  fr: {
    jobDescription: "La comparaison avec votre offre d'emploi n'a pas pu être rédigée cette fois-ci : cette analyse ne la contient donc pas.",
    linkedIn: "L'examen de votre profil LinkedIn n'a pas pu être rédigé cette fois-ci : cette analyse ne le contient donc pas.",
  },
  hi: {
    jobDescription: "इस बार आपकी जॉब पोस्टिंग से तुलना तैयार नहीं हो सकी, इसलिए यह विश्लेषण उसके बिना है।",
    linkedIn: "इस बार आपकी LinkedIn प्रोफ़ाइल की समीक्षा तैयार नहीं हो सकी, इसलिए यह विश्लेषण उसके बिना है।",
  },
  nl: {
    jobDescription: "De vergelijking met je vacature kon deze keer niet worden geschreven, dus deze analyse bevat die niet.",
    linkedIn: "De beoordeling van je LinkedIn-profiel kon deze keer niet worden geschreven, dus deze analyse bevat die niet.",
  },
  pt: {
    jobDescription: "Desta vez não foi possível escrever a comparação com a sua vaga, então esta análise não a inclui.",
    linkedIn: "Desta vez não foi possível escrever a avaliação do seu perfil do LinkedIn, então esta análise não a inclui.",
  },
  tl: {
    jobDescription: "Hindi nagawa ngayon ang paghahambing sa iyong job posting, kaya wala ito sa pagsusuring ito.",
    linkedIn: "Hindi nagawa ngayon ang pagrepaso sa iyong LinkedIn profile, kaya wala ito sa pagsusuring ito.",
  },
};

/**
 * The sections an analysis says it went out without: its missingSections
 * (analyze-resume from this round), or, for an analysis from the function
 * before it, a posting it says it had (hasJobDescription) with no comparison.
 */
export function missingSectionsOf(analysis: { missingSections?: unknown; hasJobDescription?: unknown; jobDescriptionAlignment?: unknown }): MissingSection[] {
  const named = Array.isArray(analysis?.missingSections) ? analysis.missingSections : [];
  const out = (["jobDescription", "linkedIn"] as const).filter((s) => named.includes(s));
  if (!out.includes("jobDescription") && analysis?.hasJobDescription === true && !analysis.jobDescriptionAlignment) out.unshift("jobDescription");
  return out;
}

/** The section lines for a mail language. */
export function sectionMissingLines(language: string, missing: readonly MissingSection[]): string[] {
  const table = tableOf(SECTION_MISSING_LINES, language);
  return missing.map((s) => table[s]);
}

/** The posting match score, 0-100, from the analysis's jobDescriptionAlignment (or an old stored jobMatch); null when there is none. */
export function jobMatchScoreOf(analysis: { jobDescriptionAlignment?: { matchScore?: unknown } | null; jobMatch?: { score?: unknown } | null }): number | null {
  const read = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
  let raw = read(analysis?.jobDescriptionAlignment?.matchScore);
  if (!Number.isFinite(raw)) raw = read(analysis?.jobMatch?.score);
  return Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : null;
}
