// Head-term landing pages (/resume-checker, /ats-resume-test, /resume-score).
// Each renders the REAL scanner (Index with a landing config) — not a doorway
// page: the tool the query asks for is live above the fold. Copy and FAQs are
// unique per query intent; claims follow the site-wide rule of being
// verifiable in one free scan.

export interface ToolLanding {
  slug: string;
  path: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  bullets: string[];
  faqs: Array<{ q: string; a: string }>;
  /** Page language; switches the whole app chrome via i18n. Default "en". */
  lang?: "es";
  /** hreflang pairing: absolute paths of the language siblings. */
  alternates?: { en: string; es: string };
}

export const TOOL_LANDINGS: Record<string, ToolLanding> = {
  "revisar-curriculum": {
    slug: "revisar-curriculum",
    path: "/es/revisar-curriculum",
    lang: "es",
    alternates: { en: "/resume-checker", es: "/es/revisar-curriculum" },
    title: "Revisar Currículum Gratis — Análisis ATS Completo en Español",
    description:
      "Revisa tu currículum gratis en unos 20 segundos: puntaje ATS con auditoría detallada, palabras clave faltantes, viñetas débiles reescritas. Detección nativa en español. Sin registro; tu currículum nunca se guarda.",
    heading: "Un revisor de currículum que muestra su trabajo — también en español",
    intro:
      "Sube o pega tu currículum arriba y recibe el diagnóstico completo, no un adelanto. Nuestro motor detecta currículums en español de forma nativa — términos, títulos profesionales y certificaciones en tu idioma — algo que casi ningún otro escáner ATS ofrece.",
    bullets: [
      "Sin registro y sin correo electrónico para el informe completo",
      "Tu currículum se analiza en memoria y nunca se guarda",
      "Puntaje con auditoría detallada: cada punto rastreable a un hallazgo",
      "Detección nativa en español en 15 industrias, además de 10 idiomas",
      "Funciona con o sin oferta de trabajo (expectativas por ocupación del Departamento de Trabajo de EE. UU.)",
    ],
    faqs: [
      {
        q: "¿Este revisor de currículum es realmente gratis?",
        a: "Sí — el informe de diagnóstico completo es gratis y sin registro: puntaje con auditoría, palabras clave faltantes, viñetas débiles reescritas y verificaciones por sistema ATS (Workday, Greenhouse, Lever, iCIMS). Tienes 7 escaneos al día (15 con una cuenta gratuita).",
      },
      {
        q: "¿Funciona con currículums en español?",
        a: "Sí, de forma nativa. El motor reconoce términos, títulos profesionales y certificaciones en español directamente — no traduce tu documento. Si postulas a empresas con sistemas ATS en inglés, el informe también señala qué términos en inglés suman peso.",
      },
      {
        q: "¿Guardan mi currículum?",
        a: "No. Tu currículum se procesa en memoria para generar el informe y no se almacena. El informe lleva un identificador reproducible para que verifiques que un re-escaneo del mismo archivo produce resultados consistentes.",
      },
      {
        q: "¿Cómo se calcula el puntaje?",
        a: "Un analizador ATS basado en reglas y un análisis de IA corren en paralelo; el informe muestra el puntaje combinado con su banda de modelado y una auditoría punto por punto. Cada cita se verifica contra tu documento real antes de llegar al informe.",
      },
    ],
  },
  "resume-checker": {
    slug: "resume-checker",
    path: "/resume-checker",
    alternates: { en: "/resume-checker", es: "/es/revisar-curriculum" },
    title: "Free Resume Checker — No Sign-Up, Full Report",
    description:
      "Check your resume free in about 20 seconds: ATS score with an audit trail, missing keywords, weak bullets rewritten, per-vendor parsing checks. No sign-up, resume never stored.",
    heading: "A resume checker that shows its work",
    intro:
      "Upload or paste your resume above and you get the complete diagnostic — not a teaser. Every finding quotes your actual document, the score comes with its modeling band, and the report carries a reproducible ID.",
    bullets: [
      "No sign-up and no email required for the full report",
      "Your resume is analyzed in memory and never stored",
      "Score shown with an audit trail — every point traceable to a finding",
      "Works with or without a job description (expectations sourced from the U.S. Department of Labor's O*NET when you don't have one)",
      "58 industries detected, including Spanish-language resumes",
    ],
    faqs: [
      {
        q: "Is this resume checker really free?",
        a: "Yes — the full diagnostic report is free with no sign-up: score with audit trail, missing keywords, weak bullets rewritten, recruiter panel, and per-vendor ATS checks. You get 7 scans a day (15 with a free account). Paid products are separate, optional tools.",
      },
      {
        q: "Do you store my resume?",
        a: "No. Your resume is processed in memory to generate the report and is not saved. The report itself carries a reproducible ID so you can verify a rescan of the same file produces consistent results.",
      },
      {
        q: "How is the score calculated?",
        a: "A rule-based ATS parser and an AI analysis run in parallel; the report shows the blended score with its modeling band and a point-by-point audit trail. Every quoted line is verified against your actual document before it reaches the report.",
      },
      {
        q: "Do I need a job description to check my resume?",
        a: "No. With a job posting, keywords come from the posting itself. Without one, expectations are sourced per-occupation from the U.S. Department of Labor's O*NET database and cited in your report.",
      },
    ],
  },
  "ats-resume-test": {
    slug: "ats-resume-test",
    path: "/ats-resume-test",
    title: "ATS Resume Test — How Workday & Greenhouse Parse You",
    description:
      "Test your resume against ATS parsing free: see exactly what applicant tracking systems extract from your file, which keywords are missing, and per-vendor checks for Workday, Greenhouse, Lever, and iCIMS.",
    heading: "Test how ATS systems actually read your resume",
    intro:
      "The scan above runs your real file through extraction and shows you what an applicant tracking system sees — including the parts that silently disappear. Then it checks the specifics that trip up the major vendors.",
    bullets: [
      "Actual text extraction from your file — see what survives parsing",
      "Per-vendor checks for Workday, Greenhouse, Lever, and iCIMS",
      "Formatting red flags that break parsers (tables, columns, headers)",
      "Keyword gaps against your target job or your occupation's O*NET profile",
      "Free, no sign-up, resume never stored",
    ],
    faqs: [
      {
        q: "How do I test if my resume is ATS-friendly?",
        a: "Upload your resume above. The scan extracts text from your actual file the way parsers do, flags structures that commonly break extraction (tables, multi-column layouts, images), and runs vendor-specific checks for Workday, Greenhouse, Lever, and iCIMS.",
      },
      {
        q: "Which ATS systems does the test cover?",
        a: "The parsing simulation is vendor-agnostic (it shows what text extraction yields from your file), plus dedicated check lists for Workday, Greenhouse, Lever, and iCIMS — the four systems most large employers use. We also publish free guides for each.",
      },
      {
        q: "Do ATS systems really auto-reject resumes?",
        a: "Mostly no — the common failure is quieter: bad parsing means your skills and titles never make it into the database recruiters search. The test shows you exactly what gets extracted so you can fix what's invisible.",
      },
      {
        q: "Is the ATS test free?",
        a: "Yes — the extraction view, vendor checks, keyword analysis, and the full diagnostic report are free with no sign-up. Your resume is never stored.",
      },
    ],
  },
  "resume-score": {
    slug: "resume-score",
    path: "/resume-score",
    title: "Resume Score — Free Score With a Full Audit Trail",
    description:
      "Get your resume score free in about 20 seconds — shown with its modeling band and a point-by-point audit trail, benchmarked against real scans. No sign-up, resume never stored.",
    heading: "A resume score you can actually interrogate",
    intro:
      "Most tools hand you a single number and no way to check it. The scan above shows your score with its modeling band, a findings index explaining every deduction, and where you sit against other resumes scanned here.",
    bullets: [
      "Score with a modeling band — honest about its own precision",
      "Point-by-point audit trail: every deduction tied to a quoted finding",
      "Benchmarked against real scans in your industry where we have enough data",
      "Reproducible report ID — rescan the same file, verify consistency",
      "Free, no sign-up, resume never stored",
    ],
    faqs: [
      {
        q: "What is a good resume score?",
        a: "On our scale, most resumes land in the 55–75 range; above 80 means keywords, structure, and parseability are all solid for your target. But the number matters less than the audit trail — the report shows exactly which findings cost you points and how to fix them.",
      },
      {
        q: "Why does the score show a range?",
        a: "Because any automated score has modeling error, and pretending otherwise is dishonest. We show the band our rule-based parser and AI analysis agree on. Tools that show one exact number have the same uncertainty — they just hide it.",
      },
      {
        q: "Is the resume score the same as an ATS match rate?",
        a: "No. A match rate compares your resume to one job posting. Our score blends parseability, keyword coverage (from your posting or your occupation's O*NET profile), bullet strength, and structure — with each component visible in the audit trail.",
      },
      {
        q: "Is it free?",
        a: "Yes — the score, band, audit trail, and full diagnostic report are free with no sign-up. Your resume is never stored.",
      },
    ],
  },
};
